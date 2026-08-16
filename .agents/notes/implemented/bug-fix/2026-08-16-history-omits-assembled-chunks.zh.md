# Agent Note: History RPC omits assembled assistant chunks

Status: implemented

[English](2026-08-16-history-omits-assembled-chunks.md) | 中文

## Problem

`session.history` 按追加来源消息分页，但会序列化该 seq 区间内的每一条原始事件，包括 `assistant/chunk` 的 token 带。因此，一次长达 50 条消息的 GLM／code-mode 尾页会带上数万条分片。2026-08-16，已附加的 tokenwatch fork 会话 `session-0cc24403-6fd3-494a-aa3b-8309584df2ba` 对 `session.history({ maxMessages: 50 })` 返回 84,954 条事件（其中 84,568 条为 `assistant/chunk`），JSON 正文 15,944,912 字节；Agent 工作区会话 `session-079ca56a-55e2-4803-8823-57e16d5b3448` 返回 23,823 条事件（23,484 条分片）、5,134,552 字节。回环接口分别在 0.21s 与 0.07s 内完成这些 POST。浏览器一元载体对 `session.history` 施加 30 秒 `AbortSignal.timeout`（`packages/host/apiproxy/src/fetch/client.ts` 中的 `DEFAULT_TIMEOUT_MS`）。手机经 Tailscale Serve 若无法在该时限内完成下载、`JSON.parse` 与 schema 解析，就会显示 `Failed to load history: The operation was aborted. (internal)`——即 `transportError` 包装中止，错误码 `internal`。同一宿主上较小的会话仍可打开。提高超时仍会迫使移动端堆上解析数兆字节。

Chat 与 Trajectory 已经从 `assistant/message` 的内容折叠已完成的 Assistant 行（`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts` 与 `packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts` 中的 `toAssistantBlocks`）。中断和进行中的步骤没有这样的消息，仍需要分片。从持久化日志中删除分片曾被[拒绝](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md)，因为快照回放与失败流的部分输出依赖它们；本决策只改 GUI 历史传输。

## Decision

在按消息边界分页之后，`dsh-host-apiproxy` 的 `historyPage` 会移除同一页上已经拥有追加来源 `assistant/message` 的 `(turn, step)` 所对应的 `assistant/chunk` 事件。进行中和中断的步骤保留分片。`hasMore` 与 seq 切点仍基于未过滤区间，因此压缩连续性不变。`subagent.history` 使用同一个辅助函数。持久化、mux 实时帧和会话导出仍携带完整 token 带。仅由被省略分片派生的历史首 token 时间在重新打开时缺席；实时流仍从 mux 分片计算该时间。

## Alternatives considered

**提高 30 秒一元超时。** 拒绝，因为测得的单页载荷是 16 MiB JSON。较慢的 tailnet 仍要支付下载与解析成本，且移动 Safari 可以独立于客户端计时器中止。

**在 `maxMessages` 之外再按事件数或字节数封顶。** 暂缓：字节上限仍可能切在一条 tool result 中间，事件上限会在去掉冗余分片这一低成本收益之前就缩短可见转录。若非分片事件单独就超过移动端预算（这些日志里的 `request/header` 每条约 86 KiB），再考虑。

**停止持久化 `assistant/chunk`。** 此前已拒绝：ACP 快照、llm-replay 以及中断的部分输出需要持久化 tape。本变更不重开该决策。

**用 `sourceEventSeqs` 而不是 `(turn, step)` 来省略。** 拒绝，因为重试步骤中失败尝试留下的分片不会被最终消息引用；一旦存在追加来源消息，`(turn, step)` 也会丢掉那些分片。

## Consequences

重新打开已完成的转录不再下载 token 带。中断与正在流式传输的步骤仍从分片渲染。单元测试固定省略与保留，Chat assembler 用例固定在没有任何 chunk 事件时仍能从 `assistant/message` 结算。此次网关重建之后，对 `session-0cc24403-6fd3-494a-aa3b-8309584df2ba` 的分离态 `session.history({ maxMessages: 50 })` 在回环上 0.06s 内返回 387 条事件、1,467,289 字节、零条 `assistant/chunk`；该会话磁盘上经 zstd 解码的 JSONL 仍有 1,124 条事件，其中 449 条分片（3,375,658 字节）。重启后无法复测原先附加态的 15,944,912 字节：那个进程内存里未压缩的 token 带已经消失。重启后的页面仍证明省略作用于剩余的持久化分片。页面残留体积主要来自 `tool/code-dispatch*` 行，而不是 token 带。
