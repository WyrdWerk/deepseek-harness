# @deepseek-ai/dsh-client-ui-sticky-disclosure

English | [中文](README.zh.md)

Web conversation overlay: when an expanded disclosure (Think row, tool card, command card) scrolls out through the top of `[data-conversation-scroll]`, a chip on that edge collapses it; a collapse-all control and a localStorage hotkey collapse every expanded transcript section. The host apply is empty. The browser half observes the published `data-disclosure-row` / `data-open` attributes from `dsh-client-ui-primitives` and the conversation scrollport from `dsh-client-ui-conversation`. It registers no extra HTTP routes.

The default hotkey is Ctrl+Alt+C (⌘⌥C on macOS). The gear control captures a new combination that includes Ctrl, Meta, or Alt; Escape is reserved for dialogs. The spec stays in `localStorage` under `dsh-client-ui-sticky-disclosure:hotkey` and never reaches the host.

Copy is bilingual under the `stickyDisclosure` locale namespace. The overlay sits at z-index 15–16, below application dialogs.

The architecture (pin off-screen headers, collapse-all, local hotkey) follows the behavior of the community plugin [dsh-sticky-disclosure](https://github.com/Han-1413141/dsh-sticky-disclosure) (MIT). This package is first-party source, not a vendored copy.

## Model Experience

None, as the overlay only clicks existing disclosure toggles in the browser; it never enters the Session log, the model context, or telemetry.

#### KV Cache effect

None; collapsing a disclosure does not change request tokens.

## Known Limitations and Deferred Work

- **DOM contract, not a slot** — pinning reads `data-disclosure-row` / `data-open` / `data-conversation-scroll`. A primitives or conversation markup change can hide the chips without a type error.
- **Origin-local hotkey** — the shortcut is not a host settings namespace, so it does not sync across browsers or appear on the Plugins configuration page.
- **Composer excluded** — disclosures inside `[data-composer-seat]` are never pinned or batch-collapsed.
