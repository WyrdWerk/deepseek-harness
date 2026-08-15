/**
 * The Web command-line provider over a real Loader tree: its ordinary service
 * releases a consumer whose config reads `ctx.webStartup` directly.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply, WEB_STARTUP_SERVICE, type WebStartupValues } from '../src/startup.ts'
import { defaultTailscaleRunner, internals as tailscaleInternals } from '../src/tailscale-trust.ts'

/** What one fixture boot observed. */
interface Observed {
  exits: number[]
  out: string
  readerConfig?: unknown
}

const savedEnv: Record<string, string | undefined> = {}

const disposers: (() => Promise<void>)[] = []

beforeEach(() => {
  savedEnv.DSH_TRUSTED_HOST = process.env.DSH_TRUSTED_HOST
  savedEnv.DSH_TAILSCALE = process.env.DSH_TAILSCALE
  savedEnv.DSH_TAILSCALE_SERVE = process.env.DSH_TAILSCALE_SERVE
  delete process.env.DSH_TRUSTED_HOST
  delete process.env.DSH_TAILSCALE
  delete process.env.DSH_TAILSCALE_SERVE
})

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
  tailscaleInternals.runTailscale = defaultTailscaleRunner
  if (savedEnv.DSH_TRUSTED_HOST === undefined) delete process.env.DSH_TRUSTED_HOST
  else process.env.DSH_TRUSTED_HOST = savedEnv.DSH_TRUSTED_HOST
  if (savedEnv.DSH_TAILSCALE === undefined) delete process.env.DSH_TAILSCALE
  else process.env.DSH_TAILSCALE = savedEnv.DSH_TAILSCALE
  if (savedEnv.DSH_TAILSCALE_SERVE === undefined) delete process.env.DSH_TAILSCALE_SERVE
  else process.env.DSH_TAILSCALE_SERVE = savedEnv.DSH_TAILSCALE_SERVE
})

/**
 * Mount the real provider and a consumer using injection-ordered config.
 * @param args - the invocation's inner arguments.
 * @returns the service value and observed consumer/process effects.
 */
async function bootProvider(args: string[]): Promise<{
  values: WebStartupValues | undefined
  observed: Observed
}> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-web-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'reader.mjs'), `
export function apply(_ctx, config) { globalThis.__webStartupObserved.readerConfig = config }
`)
  // Node imports the fixture row outside Vite's source resolver, so delegate
  // to the source-plane plugin already imported by this test.
  writeFileSync(join(dir, 'provider.mjs'), `
export const name = 'web-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__webStartupApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader',
    `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`,
    `  inject: [${WEB_STARTUP_SERVICE}]`,
    '  config:',
    "    host: !!js ctx.webStartup.host ?? '127.0.0.1'",
    '    port: !!js ctx.webStartup.port ?? 3080',
    '    trustedHosts: !!js ctx.webStartup.trustedHosts',
    '    tailscaleServe: !!js ctx.webStartup.tailscaleServe',
    '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __webStartupApply: typeof apply
    __webStartupObserved: Observed
  }
  globals.__webStartupApply = apply
  globals.__webStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(WEB_STARTUP_SERVICE) as WebStartupValues | undefined,
    observed,
  }
}

describe('web command-line provider', () => {
  it('publishes each flag and releases direct service expressions', async () => {
    const { values, observed } = await bootProvider([
      '--host', '127.0.0.1',
      '--port', '8080',
      '--trusted-host', 'lab.internal', 'lab-2.internal',
      '--trusted-host', '10.0.0.9',
    ])
    expect(values).toEqual({
      host: '127.0.0.1',
      port: 8080,
      trustedHosts: ['lab.internal', 'lab-2.internal', '10.0.0.9'],
      tailscaleServe: false,
    })
    expect(observed.readerConfig).toEqual(values)
    expect(observed.exits).toEqual([])
  })

  it('leaves deployment values to each consumer when flags omit them', async () => {
    const { values, observed } = await bootProvider([])
    expect(values).toEqual({ trustedHosts: [], tailscaleServe: false })
    expect(observed.readerConfig).toEqual({
      host: '127.0.0.1',
      port: 3080,
      trustedHosts: [],
      tailscaleServe: false,
    })
  })

  it('prints its own help and leaves the consumer pending', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.out).toContain('dsh --profile web')
    expect(observed.out).toContain('--trusted-host')
    expect(observed.out).toContain('--tailscale')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rejects a non-numeric port before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--port', 'abc'])
    expect(observed.out).toContain('--port must be a number')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects the intentionally unsupported all-interfaces host before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--host', '0.0.0.0'])
    expect(observed.out).toContain('--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('merges DSH_TRUSTED_HOST without publishing Serve', async () => {
    process.env.DSH_TRUSTED_HOST = 'peer.ts.net, extra.example'
    const { values } = await bootProvider(['--trusted-host', 'lab.internal'])
    expect(values).toEqual({
      trustedHosts: ['lab.internal', 'peer.ts.net', 'extra.example'],
      tailscaleServe: false,
    })
  })

  it('discovers MagicDNS and enables Serve on --tailscale', async () => {
    tailscaleInternals.runTailscale = () => ({
      status: 0,
      stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'node.tailnet.ts.net.' } }),
      stderr: '',
    })
    const { values } = await bootProvider(['--tailscale', '--port', '28950'])
    expect(values).toEqual({
      port: 28950,
      trustedHosts: ['node.tailnet.ts.net'],
      tailscaleServe: true,
    })
  })

  it('enables Serve from DSH_TAILSCALE_SERVE with an explicit host when discovery is empty', async () => {
    process.env.DSH_TAILSCALE_SERVE = '1'
    process.env.DSH_TRUSTED_HOST = 'override.ts.net'
    tailscaleInternals.runTailscale = () => ({ status: 1, stdout: '', stderr: 'offline' })
    const { values } = await bootProvider([])
    expect(values).toEqual({
      trustedHosts: ['override.ts.net'],
      tailscaleServe: true,
    })
  })

  it('rejects --tailscale when no MagicDNS name or override is available', async () => {
    tailscaleInternals.runTailscale = () => ({
      status: 0,
      stdout: JSON.stringify({ BackendState: 'Stopped' }),
      stderr: '',
    })
    const { values, observed } = await bootProvider(['--tailscale'])
    expect(observed.out).toContain('--tailscale requires a running Tailscale node')
    expect(values).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})
