/**
 * MagicDNS discovery, env overrides, Serve publish, and tailnet URL formatting.
 */

import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectTrustedHosts,
  defaultTailscaleRunner,
  discoverTailscaleDnsName,
  formatTailnetUrl,
  internals,
  parseTrustedHostEnv,
  publishTailscaleServe,
  uniqueAuthorities,
} from '../src/tailscale-trust.ts'

afterEach(() => {
  internals.runTailscale = defaultTailscaleRunner
})

describe('defaultTailscaleRunner', () => {
  it('maps spawnSync stdio and a spawn error', () => {
    const ok = defaultTailscaleRunner(['status', '--json'], (() => ({
      status: 0,
      stdout: 'ready',
      stderr: '',
    })) as unknown as typeof spawnSync)
    expect(ok).toEqual({ status: 0, stdout: 'ready', stderr: '' })
    const missing = defaultTailscaleRunner(['status'], (() => ({
      status: null,
      stdout: 'x',
      stderr: 'y',
      error: new Error('ENOENT'),
    })) as unknown as typeof spawnSync)
    expect(missing.status).toBeNull()
    expect(missing.stdout).toBe('x')
    expect(missing.stderr).toBe('y')
    expect(missing.error).toBeInstanceOf(Error)
  })

  it('uses spawnSync when callers omit spawn', () => {
    const result = defaultTailscaleRunner(['--version'])
    expect(typeof result.stdout).toBe('string')
    expect(typeof result.stderr).toBe('string')
  })
})

describe('parseTrustedHostEnv', () => {
  it('returns nothing when unset or only separators', () => {
    expect(parseTrustedHostEnv(undefined)).toEqual([])
    expect(parseTrustedHostEnv('')).toEqual([])
    expect(parseTrustedHostEnv('  ,  ')).toEqual([])
  })

  it('splits on commas and whitespace', () => {
    expect(parseTrustedHostEnv('a.ts.net, b.example  c.ts.net')).toEqual([
      'a.ts.net',
      'b.example',
      'c.ts.net',
    ])
  })
})

describe('uniqueAuthorities', () => {
  it('keeps the first spelling and drops later case variants', () => {
    expect(uniqueAuthorities(['Node.Ts.Net', 'node.ts.net', 'other'])).toEqual(['Node.Ts.Net', 'other'])
  })
})

describe('discoverTailscaleDnsName', () => {
  it('returns undefined when DSH_TAILSCALE=0 without running the CLI', () => {
    let called = 0
    internals.runTailscale = () => {
      called += 1
      return { status: 0, stdout: '{}', stderr: '' }
    }
    expect(discoverTailscaleDnsName({ DSH_TAILSCALE: '0' })).toBeUndefined()
    expect(called).toBe(0)
  })

  it('returns undefined when the binary is missing or exits nonzero', () => {
    internals.runTailscale = () => ({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') })
    expect(discoverTailscaleDnsName({})).toBeUndefined()
    internals.runTailscale = () => ({ status: 1, stdout: '', stderr: 'offline' })
    expect(discoverTailscaleDnsName({})).toBeUndefined()
  })

  it('returns undefined on invalid JSON, a non-running backend, or a missing name', () => {
    internals.runTailscale = () => ({ status: 0, stdout: '{', stderr: '' })
    expect(discoverTailscaleDnsName({})).toBeUndefined()
    internals.runTailscale = () => ({
      status: 0,
      stdout: JSON.stringify({ BackendState: 'Starting', Self: { DNSName: 'n.ts.net.' } }),
      stderr: '',
    })
    expect(discoverTailscaleDnsName({})).toBeUndefined()
    internals.runTailscale = () => ({
      status: 0,
      stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 1 } }),
      stderr: '',
    })
    expect(discoverTailscaleDnsName({})).toBeUndefined()
    internals.runTailscale = () => ({
      status: 0,
      stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: '...' } }),
      stderr: '',
    })
    expect(discoverTailscaleDnsName({})).toBeUndefined()
  })

  it('strips trailing dots and lowercases a running MagicDNS name', () => {
    internals.runTailscale = () => ({
      status: 0,
      stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'Lucky-Fox.Tail3ca34c.ts.net.' } }),
      stderr: '',
    })
    expect(discoverTailscaleDnsName({})).toBe('lucky-fox.tail3ca34c.ts.net')
  })
})

describe('collectTrustedHosts', () => {
  it('orders flags, then env, then discovery, and deduplicates', () => {
    internals.runTailscale = () => ({
      status: 0,
      stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'node.ts.net.' } }),
      stderr: '',
    })
    expect(collectTrustedHosts({
      flags: ['lab.internal', 'node.ts.net'],
      env: { DSH_TRUSTED_HOST: 'node.ts.net extra.example' },
      discover: true,
    })).toEqual(['lab.internal', 'node.ts.net', 'extra.example'])
  })

  it('omits discovery when discover is false', () => {
    internals.runTailscale = () => {
      throw new Error('must not query Tailscale')
    }
    expect(collectTrustedHosts({
      flags: [],
      env: { DSH_TRUSTED_HOST: 'peer.ts.net' },
      discover: false,
    })).toEqual(['peer.ts.net'])
  })
})

describe('formatTailnetUrl', () => {
  it('omits port 443 and keeps other ports, using the hostname of a host:port entry', () => {
    expect(formatTailnetUrl('node.ts.net', 443)).toBe('https://node.ts.net')
    expect(formatTailnetUrl('node.ts.net:28950', 28950)).toBe('https://node.ts.net:28950')
  })
})

describe('publishTailscaleServe', () => {
  it('invokes serve --bg for the bound loopback port', () => {
    const calls: string[][] = []
    internals.runTailscale = (args) => {
      calls.push([...args])
      return { status: 0, stdout: '', stderr: '' }
    }
    publishTailscaleServe('127.0.0.1', 28950)
    expect(calls).toEqual([['serve', '--bg', '--https=28950', 'http://127.0.0.1:28950']])
  })

  it('fails loud with stderr, else the spawn error, else the exit status', () => {
    internals.runTailscale = () => ({ status: 1, stdout: '', stderr: ' https already taken \n' })
    expect(() => {
      publishTailscaleServe('127.0.0.1', 443)
    }).toThrow('https already taken')
    internals.runTailscale = () => ({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') })
    expect(() => {
      publishTailscaleServe('127.0.0.1', 80)
    }).toThrow('ENOENT')
    internals.runTailscale = () => ({ status: 2, stdout: '', stderr: '' })
    expect(() => {
      publishTailscaleServe('127.0.0.1', 80)
    }).toThrow('exit 2')
  })
})
