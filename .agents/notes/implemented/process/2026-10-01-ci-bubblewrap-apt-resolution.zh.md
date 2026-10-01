# Agent Note: CI 的 bubblewrap 通过 apt 元数据解析版本,不固定池内 URL

Status: implemented

[English](2026-10-01-ci-bubblewrap-apt-resolution.md) | 中文

## 问题

`scripts/prepare-ci-bubblewrap.sh` 从手工固定的 `archive.ubuntu.com` URL 下载 `bubblewrap_0.9.0-1ubuntu0.1_amd64.deb`,并用手工记录的 SHA256 校验。Ubuntu 的安全更新以 `0.9.0-1ubuntu0.3` 取代了该构建,而池内只保留当前版本,固定的 URL 因此开始返回 404。自 2026-09-11 起,`no-telemetry-compat` 分支的每次计划 E2E 运行都在 bubblewrap 步骤以 curl exit 22 失败——发生在 API 密钥预检之前,整套测试没有产生任何信号。固定文件名的设计还有第二种腐烂方式:`ubuntu-latest` 标签自 2026-10-19 起迁移到 Ubuntu 26,届时按 noble 固定的 `.deb` 将是错误的发行版。

## 决策

脚本通过 apt 解析当前的 bubblewrap 候选版本并解包该负载:`sudo apt-get update --quiet` 刷新 runner 镜像的包索引,`apt-get download bubblewrap` 把候选 `.deb` 下载到解包目录,`dpkg-deb --extract` 解包,随后删除下载的文件。最初的决定保持不变——下载过程不运行包事务——完整性校验改由 apt 承担:镜像的密钥环验证 `InRelease` 签名,apt 对照已签名的 `Packages` 索引校验 `.deb` 的 SHA256。Linux x86_64 守卫、`kernel.apparmor_restrict_unprivileged_userns` 开关、`GITHUB_PATH` 条目和 `bwrap` 功能探针均未改动。当 `apt-get download` 没有产出 `.deb` 时,脚本以 `::error::` 注解失败,并指明 runner 的 apt 源是排查对象。

## 验证

脚本在 Linux x86_64 主机上运行:apt 解析到发行版候选版本,清理后解包目录只剩 `usr/bin`,`--version` 与 `--ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true` 探针均通过。另行核对已签名的 `noble-updates` 索引:候选版本是 `0.9.0-1ubuntu0.3`,正是取代旧版并使固定 URL 失效的那次更新。每个拉取请求都会运行此脚本的 `ci.yml` 车道是长期回归检查;未新增门禁。

## 曾考虑的替代方案

- **重新固定到 `0.9.0-1ubuntu0.3` 并更新 SHA256。** 改动最小,但重新引入失效模式:下一次安全更新取代会再次打断所有车道,而在没有活跃拉取请求的分支上,故障只会在每夜的运行中暴露。
- **在脚本内解析 `Packages.gz` 并用 `gpgv` 校验。** 用 shell 重造 apt 已有的索引校验,没有额外保证,还保留一份按发行版维护的逻辑副本。
- **用 `apt-get install bubblewrap` 安装。** 被最初的决定否决(包事务会扫描镜像的完整 dpkg 数据库并运行 post-install 钩子);仅下载的方式避开这笔开销。

## 后果

- 每个 runner 发行版获得各自当前的候选版本:今天是托管的 24.04,标签迁移后是 Ubuntu 26,自托管故障转移虚拟机走自己的源。
- 固定的版本和哈希常量消失;被篡改的 `.deb` 现在会被 apt 的签名或哈希校验拒绝,而不是匹配脚本里的常量。
- 各车道为 bubblewrap 准备步骤多付出一次 `apt-get update`——仅刷新元数据,不改动任何包。
