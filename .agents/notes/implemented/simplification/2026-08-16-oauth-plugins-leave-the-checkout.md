# Agent Note: Codex and Grok OAuth leave the checkout

Status: implemented

English | [中文](2026-08-16-oauth-plugins-leave-the-checkout.zh.md)

## Problem

`@deepseek-ai/dsh-llm-oauth` borrowed tokens from `~/.pi/agent/auth.json` and `~/.codex/auth.json` and had no first-party login. Official DeepSeek Harness did not add replacement LLM-OAuth packages; it only has Codex as a *subagent* backend (`dsh-subagent-codex`). Community [`dsh-codex`](https://github.com/Yan-Zero/dsh-codex) and fork-local `dsh-grok` own their credential files and device-code login, but both register `/plugins/*/auth/*` on `ctx.webServer` outside the `/api` Host fence.

Composing those bundles into `dsh-web-app` would fail the community-plugin Host-fence rule used for chat-import. Leaving `dsh-llm-oauth` in the tree would keep two OAuth stacks.

## Decision

Delete `packages/llm/llm-oauth` and its `dsh-base` row. ChatGPT OAuth is `dsh-codex@0.2.3` and Grok is `dsh-grok`, both installed on the web profile (`dsh plugin --profile web add` / `link:` to the staging mirror), not as checkout workspace members. Their routes stay loopback-trusted. The in-tree advisor is also gone (same loader id `advisor` as the profile plugin); reviewer config lives on the home overlay. See [FORK.md](../../../../FORK.md).

## Alternatives considered

**SHA-pin `dsh-codex` and copy `dsh-grok` into `third-party/` / `packages/` and mount them from `dsh-web-app`.** Rejected: both register HTTP outside `/api`. The same rule that kept chat-import out applies. Profile bundles already load them on this host without double-mounting.

**Keep `dsh-llm-oauth` beside the profile plugins.** Rejected: borrowed credentials and no login UI; two routes for the same subscriptions.

**First-party rewrite of login through `/api`.** Deferred: a Host-fenced OAuth settings RPC is a product; the profile plugins already sign in.

## Consequences

A clone of this fork does not include Codex/Grok OAuth or the reviewer until the operator installs the profile plugins (`dsh-codex@0.2.3`, staging-mirror `dsh-grok`, `dsh-advisor@0.2.0`). `dsh-web-app` no longer reads pi or Codex CLI auth files. [FORK.md](../../../../FORK.md) records the split and the install commands.
