# Cookbook: 为 `dsh web` 配置 Tailscale Serve

[English](tailscale-web.md) | 中文

把 Web GUI 发布到你自己的 tailnet（尾部网络），无需写死主机名。`/api` 浏览器信任栅栏仍然要求具名 authority；`--tailscale` 会发现本节点的 MagicDNS 名称（或你设置 `DSH_TRUSTED_HOST`），并通过 `tailscale serve` 发布回环绑定。理由见 [Tailscale web Serve Agent Note](../../.agents/notes/implemented/feature/2026-08-15-tailscale-web-serve.md)。栅栏本身见[浏览器信任 Agent Note](../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md)。

## 前提条件

1. 已安装 Tailscale，且 `tailscale status` 显示 `BackendState: Running`。
2. 该 tailnet 已启用 HTTPS 证书（Serve 的 Let's Encrypt 路径）。
3. Harness 已构建（在检出目录运行 `pnpm run build`，或使用已安装的 `dsh`）。
4. 只绑定回环地址。`dsh web --host 0.0.0.0` 是用法错误。

## 接入本节点

选择本节点上空闲的监听端口。同一节点上的其他应用不能共用 HTTPS 443 端口；给每个应用单独的端口（[多端口 Serve](https://tailscale.com/kb/1247/funnel-serve-use-cases)）。

1. 先快照 Serve，以便事后对比：`tailscale serve status --json > /tmp/serve-before.json`。
2. 启动 GUI：在已构建的检出中运行 `node apps/cli/lib/bin.js web --host 127.0.0.1 --port 28950 --tailscale`，或运行 `dsh web --port 28950 --tailscale`。
3. 确认 URL 行同时给出回环与 tailnet，例如 `dsh web: http://127.0.0.1:28950 (tailnet: https://<node>.<tailnet>.ts.net:28950)`。
4. 确认栅栏接受 MagicDNS 的 Host：`curl -sS -o /dev/null -w "%{http_code}\n" -H "Host: <node>.<tailnet>.ts.net" http://127.0.0.1:28950/` 必须打印 `200`。
5. 确认 tailnet URL：`curl -sS -o /dev/null -w "%{http_code}\n" https://<node>.<tailnet>.ts.net:28950/` 必须打印 `200`，且证书有效。
6. 对比 Serve：`tailscale serve status --json` 必须只新增该端口的 HTTPS 规则，目标为 `http://127.0.0.1:28950`。

`--tailscale` 等价于进程环境中的 `DSH_TAILSCALE_SERVE=1`（监督进程可以只设环境变量、不传 flag）。

## 接入其他主机名

当本进程无法运行 `tailscale status`（受限的 `PATH`、没有 CLI 的容器）或你想使用并非本节点 MagicDNS 主机名的名称时，显式设置 authority 并跳过发现：

```sh
export DSH_TRUSTED_HOST=my-node.tailnet.ts.net
export DSH_TAILSCALE=0
dsh web --port 28950 --trusted-host my-node.tailnet.ts.net
tailscale serve --bg --https=28950 http://127.0.0.1:28950
```

`DSH_TRUSTED_HOST` 是以逗号或空白分隔的 `host` 或 `host:port` 条目，会合并在 `--trusted-host` flag 之后。即使 `--tailscale` / `DSH_TAILSCALE_SERVE=1` 本会查询 CLI，`DSH_TAILSCALE=0` 也会禁用 MagicDNS 发现；此时必须提供 `--trusted-host` 或 `DSH_TRUSTED_HOST`，否则启动会以用法错误退出。

两半都需要：只有 Serve 规则、没有匹配的 trusted host 时，浏览器访问 `/api` 会得到 403；只有 trusted host、没有 Serve 时，仅回环可到达。

## 删除规则

`tailscale serve --https=28950 off` 删除该端口的规则。`tailscale serve reset` 会删除本节点上的全部规则——不要在共享主机上使用。
