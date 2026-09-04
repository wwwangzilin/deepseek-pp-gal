# Inline Agent 空行渲染问题 — 任务交接文档

> 状态：**✅ 已解决（2026-08-06，真实浏览器复现 + 修复 + 验证）**，本文件保留为排查记录。
> 仓库：`zhu1090093659/deepseek-pp`（v1.13.0，WXT/React/TS MV3 浏览器扩展）
> 工作目录：`/Users/zcl/code/deepseek-pp`

---

## 1. 用户报告的现象（原始描述）

1. **最初**（简体中文，用户原话大意）：
   > "在展开 Agent 模式运行后，最后生成的内容为什么每一行文字之间都有空行呢？我感觉渲染有些问题"
2. 随后补充：**step 1/2/3 步骤框里面的内容**也有同样的空行。
3. 用户确认过：**禁用扩展后空行消失** → 空行是 DeepSeek++ 扩展引起的（不是 DeepSeek 页面原生行为）。
4. 最新一轮用户给出**具体出错内容**（最终输出）：

   ```
   五、核心博弈：三大矛盾

   #### 1. 🟢 云计算超级周期 vs. 🔴 天量资本开支
   谷歌云同比增长82%，积压订单$5,140亿，营业利润率35.6%

   但资本开支翻倍至$2,000亿级别，自由现金流转负
   ```

   用户点评："**没有渲染好且依然存在空行**"——即 `#### 1.` 这种 4 级 markdown 标题没有被渲染成标题，且每段之间有空行。
5. 用户最新明确诉求（原话）：
   > "我们能不能直接用它原生的内容渲染呢？我们就改一下 Inline-Agent 的 UI、UX 就行，对于内容渲染还用原生策略"
   
   **解读**：用户希望最终答案 / 步骤正文的**内容渲染行为对齐 DeepSeek 页面原生 markdown 渲染**（标题、列表、段落都按标准 markdown 渲染、紧凑无空行），扩展只负责面板 UI/UX。
6. 用户最新反馈："**还是没有解决～算了，写个任务交接的 Prompt，我让别的 Agent 做**" —— 即本交接文档。

---

## 2. 系统架构（接手前必须理解）—— ⚠️ 2026-08-06 用户纠正后的正确理解

> **重要纠正（用户原话）**："我发现你对 Agent 模式理解错了，Agent 模式就是调用我们提供的额外工具，包括 mcp、web_search 之类的都算。"
>
> 也就是说：**Agent 模式 = DeepSeek++ 的 inline-agent loop 调用扩展提供的工具（mcp、web_search、artifact 等），工具执行结果展示在扩展面板的步骤卡片里**。排查范围**必须包含工具结果的渲染路径**，不能只看模型文本流。

- DeepSeek++ 拦截 DeepSeek 网页（`chat.deepseek.com`）的请求与流（MAIN world 注入 `entrypoints/main-world.content.ts` → `core/interceptor/fetch-hook.ts`）。
- **Agent 模式（扩展的 inline agent）**：用户在 DeepSeek 页面发起提问 → 扩展注入工具 prompt → 模型输出 `<tool_call>...</tool_call>` XML 块（调用 mcp / web_search / artifact 等扩展工具）+ 普通文本，且输出格式习惯"每行/每段之间用 `\n\n` 分隔"。
- 扩展的 loop（`core/inline-agent/pi/loop-adapter.ts`）执行工具调用（mcp、web_search 等），工具**执行结果**通过 `addToolResultToStep` / `addToolResultDetailsToStep` 渲染到步骤卡片里。
- fetch-hook 的 `XmlToolStreamFilter`（`core/interceptor/fetch-hook.ts`）把工具调用 XML 从流向页面的文本中**剥离**，把"干净文本"喂回 DeepSeek 页面，**页面用原生渲染器渲染这段文本**（页面中间区域，即用户所说的"DS 网页上中间区域"）。
- 同时扩展自己还有一个 **Inline-Agent 面板**（`core/inline-agent/`）：挂载在页面消息区（`mountInlineAgentContainer` → `getAssistantResponseHost(message).appendChild(container)`），面板内有 step 1/2/3 步骤卡片（`.dpp-agent-step-body`）和最终答案 div（`[data-dpp-body-text]`），两者都通过 `core/inline-agent/markdown.ts` 的 `renderInlineMarkdown()` 渲染。

**两条渲染路径都要检查**：
- **A. 页面原生渲染**（用户说的"中间区域"）：文本源 = fetch-hook 剥离工具调用后的流文本。
- **B. 扩展面板渲染**：`renderInlineMarkdown()`（步骤正文 `updateStepStreamText`、最终答案 `appendInlineAgentFinalAnswer`）。

---

## 3. 已确认的根因（有测试/模拟证据）

### 3.1 根因 1：工具调用剥离后残留多余空行（已修复）

模型输出格式：`前文\n\n<tool_call>...</tool_call>\n\n后文`。
`XmlToolStreamFilter` 只删 XML 标签 → 残留 `前文\n\n\n\n后文`（4 个连续换行）→ 页面渲染出"每行之间空行"。

**修复**（已在工作区，未提交）：
- `core/interceptor/fetch-hook.ts`：
  - 新增 `stripTailLeadingNewlines` 状态：open 标签前文本以 `\n` 结尾时，close 后 tail 的头部换行折叠；
  - 新增 `lastEmittedTextEndsWithNewline`：跨 SSE 帧（open 在新帧开头、前文已 flush）时折叠；
  - 新增 `emitCollapsedTrailingNewlines()`：所有发出的文本帧统一折叠 `\n{3,}` → `\n\n`（含 EOF flush）；
  - 新增 `cloneParsedWithCollapsedBlankLines()` / `collapseExcessBlankLines()`：**递归处理 BATCH / fragment 结构**，并**保护 ``` 围栏代码块内的空行**；
  - `emitBlocksBeforeOpen` 的完整块与裁剪块都应用折叠。
- `entrypoints/content.ts`：DOM 级清理 `stripToolCallTextNodes()` 同步折叠（含跨文本节点状态 `lastNodeEndsWithNewline`，新增 `collapseRenderedExcessBlankLines()` 带代码块保护）。

**验证**：`tests/xml-tool-stream-filter.test.ts` 新增 3 个回归测试（跨帧 flush 折叠、纯文本折叠+代码块保护、工具调用周围折叠），全绿。

### 3.2 根因 2：渲染器不识别 `####`（4 级标题）且标题层级映射错误（已修复）

旧 `renderInlineMarkdown()`：
```ts
html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');  // 映射错误：### 应为 h3
html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');   // 映射错误：## 应为 h2
html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');    // 映射错误：# 应为 h1
```
→ `#### 1. ...`（4 个 #）**完全不匹配任何规则**，原样输出为文本 → 用户看到"没有渲染好"。

**修复**（已在工作区，未提交）：`core/inline-agent/markdown.ts`
```ts
html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
```
另新增：有序列表 `^\d+\. ` → `<li>`、blockquote `^&gt; ` → `<blockquote>`、CRLF 归一化、`\n{2,}` 折叠（无空行）。
`core/inline-agent/renderer.ts`：`[data-dpp-body-text]` 补齐 h1-h6 / li / blockquote 样式。

**验证**：用户贴的内容现在渲染为
`五、核心博弈：三大矛盾<br><h4>1. 🟢 ...</h4><br>谷歌云...<br>但资本开支...`（无 `####` 原文、无 `<br><br>`）。

---

## 4. 当前工作区状态

```
M core/inline-agent/markdown.ts          ← 标题层级/有序列表/blockquote/CRLF/折叠
M core/inline-agent/renderer.ts          ← data-dpp-body-text 补齐 h1-h6/li/blockquote CSS
M core/interceptor/fetch-hook.ts         ← 流过滤空行折叠（跨帧/BATCH/fragment/代码块保护）
M entrypoints/content.ts                 ← DOM 级剥离折叠 + stripToolCallTextNodes 折叠
M tests/inline-markdown.test.ts          ← 新增标题/列表/blockquote/CRLF 测试
M tests/inline-agent-renderer.test.ts    ← 更新断言
M tests/xml-tool-stream-filter.test.ts   ← 新增 3 个折叠回归测试
```

- `npm run compile`：通过
- 全量 `npx vitest run`：**1661 passed**
- `npm run build:all`：通过，产物 `dist/chrome-mv3/`、`dist/edge-mv3/`、`dist/firefox-mv3/`（`dist/chrome-mv3-dev` 已按用户要求删除）
- `verify:manifest-policy` / `verify:extension-utf8`：通过
- 注意：**以上改动全部未提交**（git status 为 M 状态）

---

## 5. 为什么用户仍说"没有解决"——未验证的假设（接手重点）

⚠️ 关键：前几轮修复都是**代码层推理 + 单测**，**没有在真实浏览器 + 真实 Agent 流上验证过**。用户反复确认"还是没有解决"，说明至少有一条路径漏了。接手后**第一优先级是复现**。

### ⚠️ 假设 E（2026-08-06 用户纠正理解后新增，最可疑）：工具结果的渲染路径从未被折叠

用户纠正："Agent 模式就是调用我们提供的额外工具，包括 mcp、web_search 之类的都算。"

**这条路径完全没检查过空行问题**：

- `core/inline-agent/renderer.ts` 中：
  - `addToolResultToStep()`（@~760）：工具摘要行 `.dpp-agent-tool-summary`，用 **`detail.textContent = summary`** 直接设置；
  - `addToolResultDetailsToStep()`（@~870）→ `appendResultLine()`：工具结果详情 `.dpp-tool-result-line`，用 **`line.textContent = `${key}: ${value}``** 直接设置；
- 对应 CSS：
  - `.dpp-agent-tool-summary { white-space: pre-wrap; }`（@~397）
  - `.dpp-agent-step-tool-result-body { white-space: pre-wrap; }`（@~443）
- **`textContent` + `white-space: pre-wrap` = 原始文本原样渲染**。web_search 的搜索结果（每条结果之间 `\n\n` 分隔）、mcp 返回的多行内容，会**原样显示空行**！这正是"最后一步/最后的输出仍有空行"的极可能来源——**工具结果不是 markdown，是纯文本，`\n\n` 就是空行**。
- 用户"刷新后空行消失"也吻合：实时运行时工具结果以 pre-wrap 原样显示；刷新后从 trace 恢复渲染（`createRestoredInlineAgentContainer`）时……（需验证恢复路径是否同样 pre-wrap，或 trace 里的 summary 已清洗）。

**待验证/修复方向**：
1. 真实跑一次 Agent 模式（触发 web_search / mcp 调用），展开工具结果卡片，确认空行是否来自这里；
2. 若确认：在 `appendResultLine` / `addToolResultToStep` 设置 `textContent` 前，对工具结果文本做**空行折叠**（`\n{2,}` → `\n`，保留单换行；注意工具结果里可能有代码块/JSON，谨慎处理或只折叠连续 3+ 换行），或在 CSS 层面改为紧凑渲染；
3. 同时检查恢复路径 `createRestoredInlineAgentContainer`（`entrypoints/content.ts` @~6360）对工具结果的渲染是否一致。

### 假设 A（最可疑）：用户看到的空行在**页面原生渲染路径**（路径 A），而不在扩展面板（路径 B）

证据链：
- 用户一直说"**DS 网页上中间区域**"、"**最后输出的内容**"；
- 用户最新诉求"**直接用它原生的内容渲染**"——说明用户认为现在渲染的不是"原生的"，即用户看的可能是**页面渲染的流文本**（fetch-hook 剥离后的文本被 DeepSeek 页面渲染器渲染），或者是**扩展面板里插入到页面消息区的 div**（`data-dpp-body-text` 被 append 到 `container.parentNode`，而 container 在 responseHost 内——**这个 div 就在页面消息区里**，可能被页面 CSS 影响！）。

**待验证**：
1. 真实跑一次 Agent 模式，用 DevTools 检查：
   - 页面上"最后输出的内容"的 DOM 结构：是页面原生消息（`.ds-message` 内）还是扩展插入的 `[data-dpp-body-text]` div？
   - 如果是 `[data-dpp-body-text]` div：它的父容器（responseHost `._74c0879` / `.ds-assistant-message-main-content`）的 CSS 是否对其生效？**页面自身的 CSS（如 `.ds-markdown p { margin }`、`white-space: pre-wrap`）可能作用于扩展插入的 div 内部元素**，导致空行/排版异常。
2. 如果空行来自页面 CSS 对扩展注入 div 的影响 → 修复方向：**不要复用页面消息区容器**，或者给 `[data-dpp-body-text]` / `.dpp-agent-step-body` 加更严格的作用域 CSS（`all: initial` 或逐条覆盖 margin/padding/line-height/white-space），或者按用户诉求"用原生渲染"——**把最终答案文本直接交给页面原生渲染器渲染**（不自己 innerHTML，而是复用页面渲染消息的机制？或至少 CSS 完全对齐页面 markdown 样式）。

### 假设 B：真实流里工具调用剥离后仍有 3+ 换行残留（当前折叠没覆盖的形态）

模拟测试覆盖了 `response/content`、`response/fragments`、BATCH 三种事件，但**真实 DeepSeek 流的形态可能与模拟不同**：
- 可能还有 `reasoning_content` / thinking 路径（`isThinkingPatchPath`）——`extractResponseTextFromParsed` **不提取 thinking 文本**，`processFrames` 对 `text === null` 的帧直接透传，**thinking 文本里的工具调用 XML 不会被剥离**，页面会渲染出 XML 甚至空行；
- 可能有多层嵌套 BATCH / fragment 组合；
- 可能模型输出的换行是 `\r\n` + `\n` 混合（已做 CRLF 归一，但 DOM 侧 `stripToolCallTextNodes` 没有 CRLF 归一！）。

**待验证**：
1. 抓真实 Agent 流（fetch 响应），dump 所有 SSE 帧的 parsed 结构，确认事件类型全集；
2. 把真实帧喂给 `XmlToolStreamFilter` 跑一遍，对比剥离后文本是否有 `\n\n\n`；
3. 若 thinking 路径确认有 XML → 需要在 filter 里对 thinking 文本也做剥离/折叠（注意：剥离 thinking 里的工具调用可能影响页面"深度思考"展示，需评估）。

### 假设 C：`appendInlineAgentFinalAnswer` 的 textDiv 是重复渲染

- `appendInlineAgentFinalAnswer(container, ...)` 把 textDiv append 到 `container.parentNode`（即 responseHost，页面消息区）。
- 如果 DeepSeek 页面**自己也渲染了最终答案消息**（`.ds-message` 内），页面上会出现**两份最终答案**（页面原生一份 + 扩展插入一份），用户看到的可能是扩展那份（渲染差）或两份叠加（更乱）。
- **待验证**：真实页面截图确认是否双份；若是 → 按用户诉求"内容渲染用原生策略"，**考虑去掉 textDiv 自渲染，只保留页面原生那份**（但需确认 loop 的 finalText 与页面渲染的文本一致，且页面那份没有工具调用 XML 残留）。

### 假设 D：步骤框（`.dpp-agent-step-body`）CSS 作用域问题

- `.dpp-agent-step-body` 的 CSS 在 `core/inline-agent/renderer.ts` 中定义（h2/h3/h4、p、ul/ol、li、pre、table 等）——但**这些选择器是全局的**（`<style>` 注入 document.head），如果页面自身 CSS 优先级更高或同 class 冲突，可能被覆盖。
- 检查注入样式是否真的生效（DevTools computed style）。

---

## 6. 用户诉求（最终验收标准）

1. **最终输出**（用户贴的那种含 `####` 标题、列表、段落的长文本）渲染效果与 **DeepSeek 页面原生 markdown 渲染一致**：
   - `#### 1. ...` → 渲染为 4 级标题（`<h4>`）；
   - 每行/每段之间**没有多余空行**（段落紧凑，像页面原生消息那样）；
   - 列表、粗体、代码块、表格正常。
2. **step 1/2/3 步骤框正文**同样紧凑无空行、标题正常。
3. 扩展的 UI/UX（指示器右上角、步骤卡片样式等）保持现状，不回归。

---

## 7. 复现步骤（接手者必做）

1. `cd /Users/zcl/code/deepseek-pp && npm install`（如需）
2. `npm run build:chrome` → `dist/chrome-mv3/`
3. Chrome → `chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选择 `dist/chrome-mv3`
4. 打开 `chat.deepseek.com`，发起一次 Agent 模式（深度思考 + 联网搜索）提问，**问题要能触发工具调用 + 长最终输出**（如"分析谷歌财报，列出三大矛盾"之类）
5. 观察：
   - 页面中间区域最终答案：是否有空行、`####` 是否渲染成标题
   - 扩展面板步骤框：是否紧凑
   - DevTools Elements 面板：定位最终答案的 DOM（页面原生 vs `[data-dpp-body-text]`）、查看其父容器与生效 CSS
   - DevTools Network：抓取 SSE 响应，dump 帧结构（`data:` 行 JSON）
6. 用户之前的验证习惯：**重新加载扩展 + 刷新页面**后看效果（内容脚本在页面加载时注入，两步都要做）。

---

## 8. 常用命令

```bash
npm run compile                # tsc --noEmit
npx vitest run <file>          # 单测
npx vitest run                 # 全量（当前 1661 通过）
npm run build:chrome           # 仅 Chrome
npm run build:all              # Chrome + Edge + Firefox
npm run verify:manifest-policy
npm run verify:extension-utf8
```

## 9. 关键代码位置速查

| 关注点 | 文件 |
|---|---|
| 流过滤（剥离工具调用 XML + 空行折叠） | `core/interceptor/fetch-hook.ts`（`XmlToolStreamFilter` 类、`collapseExcessBlankLines`、`cloneParsedWithCollapsedBlankLines`） |
| 面板 markdown 渲染器 | `core/inline-agent/markdown.ts`（`renderInlineMarkdown`） |
| 面板样式 | `core/inline-agent/renderer.ts`（`injectInlineAgentStyles`，`[data-dpp-body-text]`、`.dpp-agent-step-body`、`.dpp-agent-tool-summary`、`.dpp-agent-step-tool-result-body`） |
| **工具结果渲染（⚠️ 未检查空行的路径）** | `core/inline-agent/renderer.ts`（`addToolResultToStep` @~760、`addToolResultDetailsToStep` @~870、`appendResultLine` @~925）——`textContent` + `white-space: pre-wrap` 原样渲染工具结果（web_search/mcp 返回），`\n\n` 会显示为空行 |
| 最终答案插入 | `entrypoints/content.ts`（`appendInlineAgentFinalAnswer` @~4080、`handleAgentLoopComplete` @~4015、恢复路径 `mountRestoredInlineAgentContainer` @~6418） |
| 步骤正文实时渲染 | `entrypoints/content.ts`（`renderInlineAgentStreamChunk` @~3941）、`core/inline-agent/renderer.ts`（`updateStepStreamText` @~696） |
| DOM 级工具调用清理 | `entrypoints/content.ts`（`stripToolCallTextNodes` @~6941、`collapseRenderedExcessBlankLines`） |
| 面板挂载到页面消息区 | `entrypoints/content.ts`（`mountInlineAgentContainer` @~3650、`getAssistantResponseHost` @~6530） |
| Agent 最终文本组装（background loop） | `core/inline-agent/pi/loop-adapter.ts`（`resolvedFinalText`、`finalize()`） |
| 文本归一（strip + normalize） | `core/interceptor/tool-parser.ts`（`stripToolCalls`）、`core/inline-agent/prompt.ts`（`normalizeInlineAgentFinalAnswerText`） |

## 10. 项目规则提醒（AGENTS.md 要点）

- 根因修复优先，改动保持范围最小；保持 `tests/inline-agent-event-protocol-golden.test.ts`（10 契约测试）全绿。
- 验证顺序：定向测试 → `npm run compile` →（涉及 prompt/工具/行为时 `npm run prompt:freeze`）→ `npm run build:all` → `verify:manifest-policy` / `verify:extension-utf8` → `npm run ci:quality`。
- 不新增持久化键；不引入 Android/移动端。
- 完成前：在真实浏览器复现验证，不要只依赖单测。

---

## 11. ✅ 最终根因与修复（2026-08-06，真实浏览器验证）

### 复现方式（本次实际执行的）

- 环境：ego-browser（ego lite Chromium）加载 `/Users/zcl/code/deepseek-pp/dist/chrome-mv3`（unpacked），继承用户登录态。
- 步骤：`chat.deepseek.com` → 专家模式 → 提问"请使用 web_search 工具搜索今天的重要科技新闻，并总结出 3 条要点" → agent loop 真实执行 web_search + web_fetch → 观察步骤框与最终答案 DOM。
- ⚠️ 注意：改代码后必须**重新加载扩展（chrome://extensions → 重新加载）+ 关闭所有旧 tab 后全新打开**，否则 content script 仍是旧版本（本次踩坑：reload 后复用旧 tab，DOM 显示旧渲染，误以为修复无效）。

### 真正根因（假设 A/D 的合体，非假设 E）

- 页面原生路径（路径 A）**本来就没有空行问题**：`.ds-markdown` 原生渲染为 `<p class="ds-markdown-paragraph">` 紧凑段落，上一轮 fetch-hook 折叠修复已足够。
- 空行的真正来源是**扩展面板渲染器 `renderInlineMarkdown`**（路径 B）：
  1. 它把 `\n{2,}` 折叠成 `\n` 后**把每个 `\n` 转成 `<br>`**（`html.replace(/\n/g, '<br>')`）；
  2. 同时又用**裸 `<li>`**（不包 `<ul>/<ol>`）和 `<h1>-<h6>` 等**块级元素**输出；
  3. 结果 HTML 变成 `...</li><br><li>...` / `<br><h4>...</h4><br>...`——`<br>` 与块级元素的行盒叠加 = **双重换行 = 每行之间的视觉空行**（实测同内容旧渲染 175px vs 原生 p 风格 130px）。
  4. 上一轮把"`<br><h4>`"写进测试断言当正确行为，掩盖了该问题。
- 假设 E（工具结果 `textContent`+`pre-wrap`）：实测 web_fetch 结果无 `\n\n`（单行 JSON），且工具结果在折叠详情区，非用户投诉主路径；未改。

### 修复内容

`core/inline-agent/markdown.ts` 重写为**块级感知渲染**（`renderBlockLayout`）：

- 空行 = 块分隔符，**不产生任何输出**（间距由 CSS margin 控制，对齐原生）；
- 标题行 → `<h1>`..`<h6>`；列表项行 → 连续项合并进单个 `<ul>/<ol>`（项间空行不拆列表）；`>` 行 → `<blockquote>`；表格/代码块原样块级输出；
- 普通连续行 → `<p>` 段落（段内单换行保留 `<br>` 软换行）；
- 全程**块级元素之间不再出现 `<br>`**。

CSS（`renderer.ts`）无需改动：`[data-dpp-body-text] p { margin: 3px 0 }`、`ul/ol/li/hN/blockquote` 样式早已就位。

### 验证结果

- 单测：`tests/inline-markdown.test.ts` + `tests/inline-agent-renderer.test.ts` 断言更新为新块级结构（新增 `</p><h4>`、`<ol><li>...` 断言，删除 `<br><h4>` 旧断言）；全量 **1661 passed**。
- `npm run compile`、`npm run build:all`、`verify:manifest-policy`、`verify:extension-utf8` 全部通过。
- **真实浏览器**（专家模式 + web_search agent loop）：
  - 步骤框：`<p>...</p><p>...</p><ol><li>...</li><li>...</li></ol>` — 0 个 `<br>`，紧凑；
  - 最终答案 `[data-dpp-body-text]`：`<p>`/`<h2>`/`<h3>`/`<ol>`/`<blockquote>` 块级结构，与页面原生 `.ds-markdown`（`<p class="ds-markdown-paragraph">`）一致；
  - 用户贴的 `#### 1.` 样例：单测覆盖 → `<h4>`，块间无 `<br>`。
- 未提交内容：`core/inline-agent/markdown.ts`、`tests/inline-markdown.test.ts`、`tests/inline-agent-renderer.test.ts`、本文档。
