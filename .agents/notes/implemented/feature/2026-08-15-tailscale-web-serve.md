# Agent Note: Tailscale Serve discovery for `dsh web`

Status: implemented

English | [中文](2026-08-15-tailscale-web-serve.zh.md)

## Problem

The Web GUI binds loopback and the `/api` fence refuses any non-loopback `Host` unless it matches `trustedHosts`. Tailscale Serve is the intended remote path: the browser talks to `https://<node>.<tailnet>.ts.net:<port>/` while the process listens on `127.0.0.1`. That requires both a Serve rule and the node's MagicDNS name on the fence. The MagicDNS name is per-node and must not be hardcoded in the repository, or a second machine cannot plug in its own tailnet.

## Decision

`dsh web --tailscale` (or `DSH_TAILSCALE_SERVE=1`) does three things at startup: it queries `tailscale status --json` for `Self.DNSName` when `DSH_TAILSCALE` is not `0`, it merges that name with `--trusted-host` and `DSH_TRUSTED_HOST` into `webStartup.trustedHosts`, and after listen it runs `tailscale serve --bg --https=<port> http://<bind>:<port>` for the bound port only. Missing discovery with no override is a usage error. `DSH_TRUSTED_HOST` is the plug-in for another hostname or a process that cannot run the Tailscale CLI. Serve is opt-in; a plain `dsh web` does not mutate Serve rules and does not query Tailscale. The [browser-trust fence](../architecture/2026-07-28-api-browser-trust-boundary.md) is unchanged: this feature only supplies authorities and the reverse proxy. Procedure: [Tailscale cookbook](../../../../docs/cookbook/tailscale-web.md).

## Alternatives considered

**Hardcode the first deployment's MagicDNS name in the CLI default or a checked-in patch.** Rejected because that name is machine-local; a fork or second node would 403 until someone edited source.

**Always discover MagicDNS on every `dsh web`.** Rejected because unit and e2e boots would pick up whatever Tailscale node the test host happens to be, and a laptop GUI that never intended tailnet exposure would still widen the Host fence.

**A wrapper script only, with no CLI flag.** Rejected because a script cannot update `ctx.webStartup.trustedHosts` inside the running process; operators would still have to copy a hostname into `--trusted-host` by hand.

**`tailscale funnel` (public internet) as the default publish path.** Rejected: Serve is tailnet-only; Funnel is a different security posture and stays operator-initiated outside this flag.

## Consequences

Any Tailscale node can run `dsh web --tailscale --port <free>` after a build; the printed URL line includes the tailnet HTTPS URL when Serve is requested. Shared hosts must snapshot Serve before the first `--tailscale` on a new port, because the flag replaces that port's HTTPS rule. Tests inject `internals.runTailscale` and never call the real CLI except for a mapper unit that may invoke `tailscale --version`.
