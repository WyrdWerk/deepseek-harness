# Agent Note: FORK.md is the workbench inventory

Status: implemented

[English](2026-08-17-fork-workbench-inventory.md) | 中文

## 问题

fork 规则要求每个偏离上游的提交都更新 `FORK.md`，但该文件当时只是一张提交表。插件实际在三层架子上（检出钉住、按 profile 安装、home overlay），没有任何一份文档列出每个插件、上游链接和安装方式。作为设计吸收的社区工作（粘性标题、未通过审计的参考）很容易丢失。一次空的 `rg` 搜索曾被当成「没有文档」；本机并未安装 `rg`。

## 决策

[FORK.md](../../../../FORK.md) 是完整的当前状态清单：工作台 profile、三层安装架子、每一个已组装 / 仅 profile / 仍排除的插件及其上游链接和安装方式、已吸收的学习，以及按提交的变更表。README 横幅指向该文件，不再声称树内 OAuth 或树内 advisor。钉住与审计文件只覆盖第一层树。仅 profile 的插件不进入 `dsh-web-app`，但必须写在 `FORK.md`。home 的 `AGENTS.md` 指向 `FORK.md`，避免后续会话重新发现这些架子。

## 备选方案

**`FORK.md` 只保留提交表，把清单放到 `docs/`。** 否决：fork 规则已经把 `FORK.md` 定为偏离契约；第二个家会漂移。

**只记录检出树里已组装的插件。** 否决：活 GUI 上的 Codex、Grok、advisor 和 roster-manager 会对下一个 agent 隐形。

**从 profile 的 `package.json` 生成清单。** 否决：那些文件是机器本地的，不得拷进隐私 fork；带公开链接的手维护清单才是耐久记录。

## 影响

后续 agent 先从 `FORK.md` 回答「我们跑了哪些插件」。加插件却不在 `FORK.md` 加行是流程错误。`rg` 不存在不能当作文档缺失的证据；应搜索清单文件以及钉住/审计那一对。
