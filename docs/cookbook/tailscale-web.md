# Cookbook: Tailscale Serve for `dsh web`

English | [中文](tailscale-web.zh.md)

Publish the Web GUI on your own tailnet without hardcoding a hostname. The `/api` browser-trust fence still requires a named authority; `--tailscale` discovers this node's MagicDNS name (or you set `DSH_TRUSTED_HOST`) and publishes the loopback bind through `tailscale serve`. Rationale: [Tailscale web Serve Agent Note](../../.agents/notes/implemented/feature/2026-08-15-tailscale-web-serve.md). The fence itself is the [browser-trust Agent Note](../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md).

## Prerequisites

1. Tailscale is installed and `tailscale status` shows `BackendState: Running`.
2. HTTPS certificates are enabled on the tailnet (Serve's Let's Encrypt path).
3. The harness is built (`pnpm run build` from the checkout, or an installed `dsh`).
4. You will bind loopback only. `dsh web --host 0.0.0.0` is a usage error.

## Plug in this node

Pick a listen port that is free on the node. Additional apps on the same node cannot share HTTPS port 443; give each app its own port ([multi-port Serve](https://tailscale.com/kb/1247/funnel-serve-use-cases)).

1. Snapshot Serve so you can diff afterwards: `tailscale serve status --json > /tmp/serve-before.json`.
2. Start the GUI: `node apps/cli/lib/bin.js web --host 127.0.0.1 --port 28950 --tailscale` (from a built checkout) or `dsh web --port 28950 --tailscale`.
3. Confirm the URL line names both loopback and tailnet, for example `dsh web: http://127.0.0.1:28950 (tailnet: https://<node>.<tailnet>.ts.net:28950)`.
4. Confirm the fence accepts the MagicDNS Host: `curl -sS -o /dev/null -w "%{http_code}\n" -H "Host: <node>.<tailnet>.ts.net" http://127.0.0.1:28950/` must print `200`.
5. Confirm the tailnet URL: `curl -sS -o /dev/null -w "%{http_code}\n" https://<node>.<tailnet>.ts.net:28950/` must print `200` with a valid certificate.
6. Diff Serve: `tailscale serve status --json` must add only the HTTPS rule for that port, targeting `http://127.0.0.1:28950`.

`--tailscale` is equivalent to `DSH_TAILSCALE_SERVE=1` in the process environment (a supervisor can set the env without a flag).

## Plug in another hostname

When this process cannot run `tailscale status` (restricted `PATH`, container without the CLI) or you want a name that is not the node's MagicDNS hostname, set the authority explicitly and skip discovery:

```sh
export DSH_TRUSTED_HOST=my-node.tailnet.ts.net
export DSH_TAILSCALE=0
dsh web --port 28950 --trusted-host my-node.tailnet.ts.net
tailscale serve --bg --https=28950 http://127.0.0.1:28950
```

`DSH_TRUSTED_HOST` is comma- or whitespace-separated `host` or `host:port` entries, merged after `--trusted-host` flags. `DSH_TAILSCALE=0` disables MagicDNS discovery even when `--tailscale` / `DSH_TAILSCALE_SERVE=1` would otherwise query the CLI; you must then supply `--trusted-host` or `DSH_TRUSTED_HOST` or startup exits with a usage error.

Both halves are required: a Serve rule without a matching trusted host yields `/api` 403 from the browser; a trusted host without Serve is only reachable on loopback.

## Remove the rule

`tailscale serve --https=28950 off` removes that port's rule. `tailscale serve reset` removes every rule on the node — do not use it on a shared host.
