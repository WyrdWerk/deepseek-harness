/**
 * Tailscale MagicDNS discovery and `tailscale serve` publish for `dsh web`.
 * The `/api` fence still requires a named authority; this module supplies the
 * current node's MagicDNS name (or `DSH_TRUSTED_HOST`) so a second machine can
 * plug in its own tailnet without hardcoding a hostname.
 * @module @deepseek-ai/dsh-web-app/tailscale-trust
 */

import { spawnSync } from 'node:child_process'

/** Result of one `tailscale` subprocess. */
export interface TailscaleCommandResult {
  /** Process exit status, or `null` when it did not start. */
  status: number | null
  /** UTF-8 stdout. */
  stdout: string
  /** UTF-8 stderr. */
  stderr: string
  /** Spawn failure (missing binary, timeout), absent on a completed process. */
  error?: Error
}

/**
 * Run `tailscale` with the given argv. Tests replace {@link internals.runTailscale}
 * or pass `spawn` to exercise this mapper without a real binary.
 * @param args - arguments after the `tailscale` binary name.
 * @param spawn - `spawnSync` implementation; production uses `node:child_process`.
 * @returns status and captured stdio; never throws.
 */
export function defaultTailscaleRunner(
  args: readonly string[],
  spawn: typeof spawnSync = spawnSync,
): TailscaleCommandResult {
  const result = spawn('tailscale', args, {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    ...result.error !== undefined && { error: result.error },
  }
}

/** Test hook: production always uses {@link defaultTailscaleRunner}. */
export const internals: { runTailscale: (args: readonly string[]) => TailscaleCommandResult } = {
  runTailscale: defaultTailscaleRunner,
}

/**
 * Split `DSH_TRUSTED_HOST` on commas or whitespace into bare authorities.
 * @param value - the environment value, or undefined when unset.
 * @returns trimmed non-empty entries in written order.
 */
export function parseTrustedHostEnv(value: string | undefined): string[] {
  if (value === undefined) return []
  return value.split(/[,\s]+/u).filter(entry => entry !== '')
}

/**
 * Deduplicate authorities case-insensitively, keeping the first spelling.
 * @param entries - authorities in precedence order.
 * @returns unique entries.
 */
export function uniqueAuthorities(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of entries) {
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/**
 * Read this node's MagicDNS hostname from `tailscale status --json`.
 * Skipped when `DSH_TAILSCALE=0`, when the binary is missing, or when the
 * backend is not `Running`. Trailing dots on `Self.DNSName` are stripped.
 * @param env - process environment (injectable for tests).
 * @returns a lowercase hostname, or undefined when none is available.
 */
export function discoverTailscaleDnsName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DSH_TAILSCALE === '0') return undefined
  const result = internals.runTailscale(['status', '--json'])
  if (result.error !== undefined || result.status !== 0) return undefined
  let parsed: { BackendState?: unknown; Self?: { DNSName?: unknown } }
  try {
    parsed = JSON.parse(result.stdout) as { BackendState?: unknown; Self?: { DNSName?: unknown } }
  } catch {
    return undefined
  }
  if (parsed.BackendState !== 'Running') return undefined
  const raw = parsed.Self?.DNSName
  if (typeof raw !== 'string') return undefined
  const name = raw.replace(/\.+$/u, '').toLowerCase()
  return name === '' ? undefined : name
}

/**
 * Compose invocation trusted-host authorities: CLI flags, then `DSH_TRUSTED_HOST`,
 * then the discovered MagicDNS name when `discover` is true.
 * @param options - flag list, environment, and whether to query Tailscale.
 * @returns unique authorities in that precedence.
 */
export function collectTrustedHosts(options: {
  flags: readonly string[]
  env?: NodeJS.ProcessEnv
  discover: boolean
}): string[] {
  const env = options.env ?? process.env
  const discovered = options.discover ? discoverTailscaleDnsName(env) : undefined
  return uniqueAuthorities([
    ...options.flags,
    ...parseTrustedHostEnv(env.DSH_TRUSTED_HOST),
    ...discovered === undefined ? [] : [discovered],
  ])
}

/**
 * HTTPS URL Tailscale Serve uses for a MagicDNS (or override) authority.
 * Port 443 omits the suffix; any other port is explicit.
 * @param authority - `host` or `host:port` trusted-host entry.
 * @param port - the loopback listen port published through Serve.
 * @returns `https://host` or `https://host:port`.
 */
export function formatTailnetUrl(authority: string, port: number): string {
  const idx = authority.indexOf(':')
  const hostname = idx === -1 ? authority : authority.slice(0, idx)
  return port === 443 ? `https://${hostname}` : `https://${hostname}:${String(port)}`
}

/**
 * Publish the loopback bind through `tailscale serve --bg --https=<port>`.
 * Replaces only that HTTPS port; other Serve rules are left in place.
 * @param bindHost - the webserver bind host (loopback).
 * @param port - the bound listen port.
 * @throws when the `tailscale` subprocess fails or does not start.
 */
export function publishTailscaleServe(bindHost: string, port: number): void {
  const target = `http://${bindHost}:${String(port)}`
  const result = internals.runTailscale(['serve', '--bg', `--https=${String(port)}`, target])
  if (result.error !== undefined || result.status !== 0) {
    const detail = result.stderr.trim() !== ''
      ? result.stderr.trim()
      : result.error?.message ?? `exit ${String(result.status)}`
    throw new Error(`web-app: tailscale serve failed for ${target}: ${detail}`)
  }
}
