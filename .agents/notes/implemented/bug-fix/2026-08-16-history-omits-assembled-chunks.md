# Agent Note: History RPC omits assembled assistant chunks

Status: implemented

English | [中文](2026-08-16-history-omits-assembled-chunks.zh.md)

## Problem

`session.history` pages on append-origin messages but serializes every raw event in that seq range, including the `assistant/chunk` token tape. A 50-message tail for a long GLM/code-mode turn therefore ships tens of thousands of chunk rows. On 2026-08-16 the attached tokenwatch fork session `session-0cc24403-6fd3-494a-aa3b-8309584df2ba` answered `session.history({ maxMessages: 50 })` with 84,954 events (84,568 `assistant/chunk`) and a 15,944,912-byte JSON body; the Agent-workspace session `session-079ca56a-55e2-4803-8823-57e16d5b3448` answered with 23,823 events (23,484 chunks) and 5,134,552 bytes. Loopback completed those posts in 0.21s and 0.07s. The browser unary carrier applies a 30-second `AbortSignal.timeout` (`DEFAULT_TIMEOUT_MS` in `packages/host/apiproxy/src/fetch/client.ts`) to `session.history`. A phone over Tailscale Serve that cannot finish download plus `JSON.parse` plus schema parse inside that budget surfaces `Failed to load history: The operation was aborted. (internal)` — `transportError` wrapping the abort, code `internal`. Smaller sessions on the same host opened. Raising the timeout would still force a multi-megabyte parse on a mobile heap.

Chat and Trajectory already fold a settled Assistant row from `assistant/message` content (`toAssistantBlocks` in `packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts` and `packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts`). Interrupted and in-flight steps have no such message and still need their chunks. Dropping chunks from the durable log was [rejected](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md) because snapshot replay and partial failed streams depend on them; this decision changes only the GUI history wire.

## Decision

After message-boundary pagination, `historyPage` in `dsh-host-apiproxy` removes `assistant/chunk` events whose `(turn, step)` already has an append-origin `assistant/message` on that page. In-flight and interrupted steps keep their chunks. `hasMore` and the seq cut stay on the unfiltered range, so compaction contiguity is unchanged. `subagent.history` uses the same helper. Persistence, mux live frames, and session export still carry the full tape. Historical first-token timing that was derived only from omitted chunks is absent on reopen; live streams still compute it from mux chunks.

## Alternatives considered

**Raise the 30-second unary timeout.** Rejected because the measured payload is 16 MiB of JSON for one page. A slower tailnet still pays download and parse cost, and mobile Safari can abort independently of the client timer.

**Cap the page by event count or bytes in addition to `maxMessages`.** Deferred: a byte cap can still cut inside a tool result, and an event cap would shrink the visible transcript before the cheap win of dropping redundant chunks. Revisit if non-chunk events alone exceed a mobile budget (`request/header` rows in these logs were ~86 KiB each).

**Stop persisting `assistant/chunk`.** Rejected earlier: ACP snapshots, llm-replay, and interrupted partials need the durable tape. This change does not reopen that decision.

**Elide using `sourceEventSeqs` instead of `(turn, step)`.** Rejected because a retried step's failed attempt leaves chunks that are not cited by the winning message; `(turn, step)` drops those as well once an append-origin message exists.

## Consequences

Reopening a settled transcript no longer downloads the token tape. Interrupted and streaming steps still render from chunks. Unit tests pin elision plus retention, and a Chat assembler case pins settlement from `assistant/message` without any chunk events. After this gateway rebuild, a detached `session.history({ maxMessages: 50 })` for `session-0cc24403-6fd3-494a-aa3b-8309584df2ba` returned 387 events and 1,467,289 bytes with zero `assistant/chunk` rows in 0.06s on loopback; the on-disk zstd-decoded JSONL for that session still has 1,124 events including 449 chunks (3,375,658 bytes). The 15,944,912-byte attached measurement cannot be repeated after restart: that process's in-memory uncompressed tape is gone. The post-restart page still proves elision against the remaining durable chunks. Residual page weight is mostly `tool/code-dispatch*` rows, not the token tape.
