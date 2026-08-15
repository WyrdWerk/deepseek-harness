# Agent Note: 为 `dsh web` 发现 Tailscale Serve

Status: implemented

[English](2026-08-15-tailscale-web-serve.md) | 中文

## 问题

Web GUI 绑定回环地址，`/api` 栅栏会拒绝任何非回环 `Host`，除非它匹配 `trustedHosts`。Tailscale Serve 是预期的远程路径：浏览器访问 `https://<node>.<tailnet>.ts.net:<port>/`，而进程监听 `127.0.0.1`。这同时需要一条 Serve 规则，以及栅栏上的节点 MagicDNS 名称。MagicDNS 名称按节点而异，不得写死在仓库里，否则第二台机器无法接入自己的 tailnet。

## 决策

`dsh web --tailscale`（或 `DSH_TAILSCALE_SERVE=1`）在启动时做三件事：当 `DSH_TAILSCALE` 不是 `0` 时查询 `tailscale status --json` 的 `Self.DNSName`，将该名称与 `--trusted-host` 和 `DSH_TRUSTED_HOST` 合并进 `webStartup.trustedHosts`，并在监听之后仅针对已绑定端口运行 `tailscale serve --bg --https=<port> http://<bind>:<port>`。发现失败且没有覆盖值时视为用法错误。`DSH_TRUSTED_HOST` 用于接入其他主机名，或用于无法运行 Tailscale CLI 的进程。Serve 是显式开启的；普通的 `dsh web` 不会改写 Serve 规则，也不会查询 Tailscale。[浏览器信任栅栏](../architecture/2026-07-28-api-browser-trust-boundary.md) 不变：本功能只提供 authority 和反向代理。步骤见 [Tailscale 实操手册（cookbook）](../../../../docs/cookbook/tailscale-web.md)。

## 考虑过的替代方案

**把首次部署的 MagicDNS 名称写死在 CLI 默认值或入库 patch 中。** 否决：该名称属于机器本地；fork 或第二台节点在有人改源码之前会一直 403。

**每次 `dsh web` 都发现 MagicDNS。** 否决：单元测试和 e2e 启动会带上测试主机碰巧所在的 Tailscale 节点，而且从未打算暴露到 tailnet 的笔记本 GUI 仍会放宽 Host 栅栏。

**只提供包装脚本、不加 CLI flag。** 否决：脚本无法在运行中的进程内更新 `ctx.webStartup.trustedHosts`；操作者仍须手工把主机名抄进 `--trusted-host`。

**默认走 `tailscale funnel`（公网）。** 否决：Serve 仅限 tailnet；Funnel 是另一种安全姿态，仍由操作者在本 flag 之外自行发起。

## 后果

任何 Tailscale 节点在构建后都可以运行 `dsh web --tailscale --port <free>`；当请求了 Serve 时，打印的 URL 行包含 tailnet HTTPS URL。共享主机在新端口上首次使用 `--tailscale` 之前必须快照 Serve，因为该 flag 会替换该端口的 HTTPS 规则。测试注入 `internals.runTailscale`，除可能调用 `tailscale --version` 的映射单元外，不调用真实 CLI。
