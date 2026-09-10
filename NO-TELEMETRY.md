# No-telemetry, plugin-compatible local fork

This branch (`no-telemetry-compat`) is a local fork of DeepSeek Harness that
disables telemetry **without deleting stock packages**. Keeping package names,
APIs, row ids, and composition shapes intact is what lets the rest of the
stock DSH plugin ecosystem keep working.

The strict package-deleting branch is preserved separately as
`no-telemetry-strict`; it is not the recommended runtime because third-party
plugins may depend on stock package names.

## What is disabled or changed

| Area | Change |
|---|---|
| `session-telemetry-otel` row | Kept with the original row id, but `disabled: true` and `mode: DISABLED`. The upstream launcher's `DSH_TELEMETRY_DISABLED` hard-disable still applies after user layers. |
| `session-log-deepseek` row | Kept, but `disabled: true`; the launcher also hard-disables it whenever `DSH_TELEMETRY_DISABLED` is set. |
| `plugin-package-inventory-deepseek` row | Kept, but `disabled: true`; the launcher also hard-disables it with the same switch. |
| DeepSeek request headers | `x-deepseek-harness-user-id` and `x-deepseek-harness-session-id` are no longer sent. The `resolveUserId` adapter option remains as a deprecated no-op for API/test compatibility. |
| Feedback acknowledgement | The `/feedback` acknowledgement no longer prints the anonymous install id. |
| Model-facing web search | `tool-web.search` is `false` in the base and in the `standard`, `cordis`, and `ptc` presets. |
| Search provider row | `web-search-deepseek` remains available for plugins, but the model does not get `web_search`. |
| Git hooks | The root `postinstall` lefthook installer, `lefthook.yml`, and the `lefthook` devDependency are removed. |

The anonymous-user-id package remains present for plugin compatibility, but the
core harness no longer attaches its value to provider requests or OTel
resources.

## Local tool integration

- **GitHub:** `/usr/bin/gh` is authenticated as the authenticated GitHub account with `gist`,
  `read:org`, `repo`, and `workflow` scopes. DSH uses it through the shell.
- **Search/external apps:** Composio 0.4.1 lives at `~/.composio/composio`.
  Because `$HOME` is read-only, its config/auth state is mirrored to
  `$HOME/projects/composio-home/.composio`.
- `$HOME/projects/.composio-bin/composio` redirects Composio to that writable home
  and sets `COMPOSIO_DISABLE_TELEMETRY=1` and `DO_NOT_TRACK=1`.
- `$DSH_HOME/AGENTS.md` tells DSH agents to use `gh` for GitHub and
  `composio` for searches/external-app actions, with `--dry-run`/approval
  guidance for side effects.

## Updating from upstream

Run:

```bash
$HOME/projects/audit-deepseek-harness/update-upstream.sh
```

The updater fetches `origin/master`, rebases the local branch, stops on
conflicts, then reinstalls, rebuilds, and runs:

```bash
$HOME/projects/audit-deepseek-harness/verify-no-telemetry.sh
```

A stock-DSH skill with the same procedure is installed at:

```text
$DSH_HOME/skills/dsh-upstream-sync/SKILL.md
```

It is user-invocable as `/dsh-upstream-sync` and model-invocable when the
user asks to update or sync upstream.

## Update policy

- Keep stock package names and APIs. Prefer disabled rows, `enabled: false`,
  or a hard-disable switch over deleting a package.
- Never force-push or rewrite upstream history.
- On conflict, preserve the invariants in this file and in the skill.
- If upstream adds a new telemetry egress path, add it to the disable list in
  `apps/cli/src/profile-boot.ts`, to the base composition, and to
  `verify-no-telemetry.sh`.
- Re-run the full build and verification after every update.

## Remaining caveats

- The upstream telemetry packages remain installed as code, because plugins may
  depend on them. The OTel exporter row is hard-disabled before it can mount,
  and the other two rows are disabled and hard-disabled.
- `@earendil-works/pi-telemetry` remains as a transitive dependency of the
  stock `llm-pi-ai` adapter. It is a vendor-neutral contracts/no-op package with
  no exporter or network path; DSH does not pass it a telemetry context.
- `gh`'s `repo` and `workflow` scopes are broad. Any DSH shell command can act
  as the authenticated GitHub account; keep approval prompts on.
- Composio still calls the Composio API for searches/actions; that is inherent
  to using it. Its local telemetry/update-check writes are disabled.
- DSH remains experimental and explicitly not a security boundary. Read
  upstream `SAFETY.md`.
