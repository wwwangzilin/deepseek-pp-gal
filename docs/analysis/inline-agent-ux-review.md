# Inline Agent 运行面板 UI/UX 把关报告

- 日期：2026-08-05
- 范围：DeepSeek++ 在 DeepSeek 网页（chat.deepseek.com）以 Agent 方式运行时注入的面板 UI/UX
- 方法：3 个独立 subagent 并行审查 —— ① 现状代码级 UI/UX 审计；② Claude Code Desktop 等 8 类竞品设计语言调研；③ 自家 sidepanel 设计系统 + DeepSeek 页面视觉规范三方对照。关键论断均已在代码中复核。
- 状态：**已全部完成并通过验收**。P0 批次合入（PR [#542](https://github.com/zhu1090093659/deepseek-pp/pull/542)，Issue #541 已关闭）；P1 批次合入（PR [#545](https://github.com/zhu1090093659/deepseek-pp/pull/545)，Issue #544 已关闭）。手动浏览器冒烟：用户以本地构建（dist/chrome-mv3）在 ego-lite 中加载扩展，于 chat.deepseek.com 专家模式实测，目视确认无问题。

## 1. 现状架构

| 文件 | 职责 |
| --- | --- |
| `core/inline-agent/renderer.ts` | 注入样式 + 全部 DOM 构建（step 卡片、tool 条目、结果 details、footer、右上角 running indicator） |
| `core/ui/injected-theme.ts` | 注入 UI 的 `--dpp-ui-*` CSS 变量（oklch 色板，与 sidepanel `--ds-*` 同源） |
| `core/inline-agent/markdown.ts` | 流式 markdown 渲染（XSS 转义 + 协议白名单） |
| `entrypoints/content.ts` | 生命周期：启动/挂载/事件处理（stream、step complete、loop complete/error）、刷新后 trace 恢复 |
| `core/inline-agent/step-control.ts` | 步骤超时（120s）与请求节流（2.5-6.5s 随机延时） |
| `core/i18n/resources/zh-CN/content.ts` | agent 文案（91-110 行） |

## 2. 总体判断

底子不差：oklch 冷调蓝双主题、状态双通道编码（边框色 + 圆点）、rAF 节流、刷新恢复渲染都是刻意做过的。问题集中在三个 P0 级"状态说谎/交互劫持"，加上 9-11px 小字号 + unicode 图标的插件感细节。与 Claude Code Desktop 的差距在**默认折叠的信息密度管理**和**克制、低频、带数字的状态反馈**。

## 3. P0 发现（必须改）

1. **工具执行时状态说谎**：`AGENT_TOOL_DETECTED` 在 `content.ts:3846-3847` 是空分支，`executing_tools` 的 ⚙ 样式（`renderer.ts:71-77,134-137`）在实况流程是死代码，只有刷新恢复才可见。面板在跑工具时仍显示闪烁 ●"streaming..."。
2. **流式刷新劫持滚动**：每个 chunk `body.innerHTML` 全量重渲染（`renderer.ts:591-592`）+ 无条件滚到底（`:596-603`）。用户上滚被拽回、选区销毁；长步骤每帧全量正则重解析会卡。
3. **停止/预算用尽被包装成"完成"**：停止走 `isError=false` → 绿色 ■ + "已停止"（`content.ts:3730`）；预算用尽文案说"已暂停"但 footer 仍绿"Agent 完成"（`renderer.ts:430-433`）。

## 4. P1 发现

### 视觉
- unicode 字符当图标：●⚙✓✗▼▸■（`renderer.ts:127,135,139,143,375-380,411,431-436,533,653`），macOS 上 ⚙ 渲染成 emoji，跨平台锯齿。→ 内联 SVG。
- 字号整体比宿主小一档：9px chevron（`:163,343`）、10px dot（`:123`）、11px 按钮/标签（`:173,189,338`）。→ 12px 起，正文 14px。
- 对比度不达标：`--dpp-ui-text-subtle` oklch(0.70) 白底约 2.4:1（`injected-theme.ts:19,42`）。
- 圆角 4/5/6px 混用（`renderer.ts:49,94,364,175`），header 5px vs step 6px 右上角锯齿；`--dpp-ui-shadow/panel-shadow` 定义了但未消费（`injected-theme.ts:32-33`），`renderer.ts:408` 硬编码 rgba 阴影；`--dpp-ui-danger` == `--dpp-ui-error`（`:27,31`）。

### 交互
- 右上角 fixed 指示器 z-index 2147483647（`renderer.ts:393-408`）盖 DeepSeek 顶栏控件，无 role/aria-live，每 chunk 重写文本。
- 挂载到首个 step 之间 2.5-6.5s 随机延时（`step-control.ts:50-52`）无"启动中"反馈；授权缺失（`content.ts:3571`）/宿主找不到（`:3608`）静默 return。
- 步骤完成 800ms 后无条件自动折叠（`content.ts:3952-3954`），覆盖用户手动展开。
- footer "Agent 完成（N 步，M 次工具调用）"夹在步骤和最终答案之间（`content.ts:3969-3972,4012-4023`）；"工具调用"label（`content.ts:482`）定义了但从未渲染。

### 无障碍与健壮性
- 全面板零 aria-live。
- 刷新后恢复的 streaming 步骤永久跳动 ●"streaming..." 且无停止按钮（`content.ts:6283,6290`）。
- 截断不一致：tool summary 600 字符静默截断（`renderer.ts:6,664`），details 有 `[truncated]` 标记（`:745-751`）。
- 折叠 transition 未纳入 reduced-motion（`:208,282`）；`aria-controls` 只声明 body（`:516`），折叠同时隐藏的 tools/results 未声明；markdown 列表生成裸 `<li>`（`markdown.ts:25-26`）。

### 设计系统（三方对照）
- 色板天然同源：sidepanel `--ds-blue` #4D6BFE ≈ DeepSeek focus ring #4d6bfe，同冷调 oklch 264，同"1px 边框 + inset 高光"哲学。**不需要换 token**。
- 分歧在圆角与字号：DeepSeek 页面 8/10/12/16px 圆角、16px 正文；sidepanel editorial 0px 卡 + 6px 控件；注入族内部分裂（tool-card 12px vs inline agent 6px vs skill 8px）。
- **暗色模式不同步（最大融入缺口）**：DeepSeek 用 `body[data-ds-dark-theme]` 切主题，注入族靠 `prefers-color-scheme` + `body.dpp-theme-dark` 兜底。用户手动切主题而系统色相反时，面板与页面反色。
- `--dpp-ui-*` 挂在 body 且无映射注释，与 sidepanel `:root` 定义靠手抄同步，有漂移风险。

## 5. 竞品参考（Claude Code Desktop 等）

Claude Code 值得学的三条信息架构纪律：
1. **工具调用默认折叠成一行**（名称 + 状态图标），点击展开 —— 参考 [Claude Code Desktop docs](https://code.claude.com/docs/en/desktop)、[Agent View](https://code.claude.com/docs/en/agent-view)。
2. **状态靠图标颜色 + 动画，不靠文字闪烁**（黄=等输入/红=错/绿=成）。
3. **低频行摘要 + 数字**：耗时/token 计数、摘要低频更新（≤15s 一次），不做假进度条。

跨产品共识（Cursor [agent overview](https://docs.cursor.com/agent/overview)、GitHub Copilot [manage agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)、OpenAI Codex [docs](https://developers.openai.com/codex/)、Devin [docs](https://docs.devin.ai/)）：垂直步进流、当前步高亮、停止/继续/重试放输入框旁、强调色只给当前步与错误、**折叠是默认态**、层级 14px 标题/13px 正文/12px 元信息、圆角 8-12px。

注入式组件**不学**：全局快捷键（⌘K 与 DeepSeek 冲突）、toast 体系、接管宿主滚动/焦点/布局、模仿宿主品牌色。确认一律内联、不阻塞输入流；面板默认收起、运行时展开。

## 6. 改造路线图

### 批次 P0（GitHub Issue #<P0>，独立分支 + PR）
1. `executing_tools` 状态真实生效（接上 `AGENT_TOOL_DETECTED`，实况显示"执行工具中"）。
2. 流式渲染不劫持滚动：用户上滚时不强制滚底（检测 scrollTop 位置后再滚），逐步做增量更新。
3. 停止/预算用中性"已暂停"态，弃用绿色完成样式；footer 语义对齐。

### 批次 P1（后续独立 Issue）
- 视觉：unicode 图标 → 内联 SVG；字号 9/10/11px → 12px 起、正文 14px；圆角统一 12px 卡 + 6px 控件；对比度修正；消除未消费 token 与重复规则。
- 交互：运行指示器改右下浮动入口/内嵌（去掉 max z-index）；补"启动中"反馈与静默失败提示；取消 800ms 无条件自动折叠（改为尊重用户手动展开）。
- 无障碍：aria-live（role=status）；恢复态 streaming 步骤不再冻结；截断标记统一；reduced-motion 覆盖折叠 transition。
- 设计系统：暗色模式跟随 `body[data-ds-dark-theme]`；`injected-theme.ts` 补 `--ds-* ↔ --dpp-ui-*` 映射注释表。

## 7. 验证链（每批次按 AGENTS.md 执行）

定向测试（含 `tests/inline-agent-event-protocol-golden.test.ts` 等契约基线）→ `npm run compile` → `npm run prompt:freeze`（涉及文案/行为变更时）→ 受影响浏览器 `npm run build:all` → `npm run verify:manifest-policy` / `verify:extension-utf8`（清单/产物变更时）→ `npm run ci:quality`。
