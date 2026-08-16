# @deepseek-ai/dsh-client-ui-sticky-disclosure

[English](README.md) | 中文

Web 会话浮层：当已展开的折叠块（Think 行、工具卡片、命令卡片）从 `[data-conversation-scroll]` 顶部滑出时，该边缘上的 chip 可以收起它；「全部收起」控件和 localStorage 快捷键会收起转录区里每一个已展开的区块。宿主 apply 为空。浏览器半侧观察 `dsh-client-ui-primitives` 发布的 `data-disclosure-row` / `data-open` 属性，以及 `dsh-client-ui-conversation` 的会话滚动区。它不注册额外 HTTP 路由。

默认快捷键是 Ctrl+Alt+C（macOS 上为 ⌘⌥C）。齿轮控件捕获包含 Ctrl、Meta 或 Alt 的新组合；Escape 留给对话框。规格保存在 `localStorage` 的 `dsh-client-ui-sticky-disclosure:hotkey` 下，永远不会到达宿主。

文案在 `stickyDisclosure` locale 命名空间下双语提供。浮层 z-index 为 15–16，低于应用对话框。

架构（钉住滑出屏幕的标题、全部收起、本地快捷键）遵循社区插件 [dsh-sticky-disclosure](https://github.com/Han-1413141/dsh-sticky-disclosure)（MIT）的行为。本包是第一方源码，不是 vendored 副本。

## 模型体验

无。该浮层只在浏览器里点击已有的折叠开关；不进入 Session 日志、模型上下文或遥测。

#### KV Cache 影响

无；收起折叠块不改变请求 token。

## 已知限制与暂缓事项

- **DOM 约定，不是 slot** — 钉住读取 `data-disclosure-row` / `data-open` / `data-conversation-scroll`。primitives 或会话标记的改动可以在没有类型错误的情况下让 chip 消失。
- **源站本地快捷键** — 该快捷键不是宿主 settings 命名空间，因此不会跨浏览器同步，也不会出现在插件配置页。
- **排除 composer** — `[data-composer-seat]` 内的折叠块既不会被钉住，也不会被批量收起。
