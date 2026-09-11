<p align="center">
  <img src="assets/readme-header.png" width="860" alt="DeepSeek++ GAL">
</p>

<h1 align="center">DeepSeek++ GAL</h1>

<p align="center">
  <strong>DeepSeek 网页版 AI Agent 工作台 × GAL 酒馆角色扮演舞台</strong>
</p>

<p align="center">
  <a href="https://github.com/wwwangzilin/deepseek-pp-gal/releases"><img alt="Release" src="https://img.shields.io/github/v/release/wwwangzilin/deepseek-pp-gal?style=flat-square&label=release"></a>
  <a href="https://github.com/wwwangzilin/deepseek-pp-gal/actions/workflows/release.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/wwwangzilin/deepseek-pp-gal/release.yml?style=flat-square&label=release-ci"></a>
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-2563eb?style=flat-square"></a>
  <a href="https://github.com/zhu1090093659/deepseek-pp"><img alt="Upstream" src="https://img.shields.io/badge/based%20on-DeepSeek++%20v1.14.0-4f46e5?style=flat-square"></a>
</p>

<p align="center">
  <a href="README_EN.md">English README</a> ·
  <a href="#gal-酒馆">GAL 酒馆</a> ·
  <a href="#角色模式">角色模式</a> ·
  <a href="#功能速览">功能速览</a> ·
  <a href="#安装">安装</a> ·
  <a href="#开发">开发</a>
</p>

DeepSeek++ GAL 是基于 [DeepSeek++](https://github.com/zhu1090093659/deepseek-pp)（v1.14.0）的衍生版浏览器扩展：完整保留 DeepSeek++ 的 AI Agent 工作台能力（长期记忆、Skill、MCP、工具调用、自动化等），并叠加了一层 **GAL 酒馆角色扮演舞台**——在 DeepSeek 网页版里像玩 Galgame 一样和角色对话。

- **默认保持 DeepSeek 原版界面**，需要角色扮演时再一键切换到 GAL 舞台，互不打扰；
- 支持 Chrome / Edge / Firefox（桌面端）。

## ✨ 产品定位

如果你想要一个 DeepSeek 网页版的 agent 工作台，DeepSeek++ GAL 直接可用；如果你还想要「角色扮演」体验，这是目前最顺滑的打开方式：

| 需求 | GAL 版提供 |
|------|-----------|
| DeepSeek 网页版 Agent 工作台 | 长期记忆 / Skill / MCP / 工具调用 / 自动化 / 项目上下文 / 对话导出，全部继承 |
| GAL 式角色扮演 | 立绘舞台 + 打字机对话 + 角色卡系统 + 开场白/场景/示例对话 |
| 角色记忆不串味 | 每个角色的记忆独立归属与注入（DSH 式角色模式） |
| 想用原版界面 | 默认就是原版，右下角一键开关，选择持久记忆 |

## 🎭 GAL 酒馆

在 `chat.deepseek.com` 页面右下角点 **「🎭 GAL 酒馆」** 即可进入角色扮演舞台（该选择会被记住；点舞台右上角 **「⏻ 关闭 GAL」** 随时回到原版界面）。

- **角色卡**：内置「DeepSeek娘」「雪璃」等预设。每个角色可配置立绘、颜色、角色设定、性格、场景、示例对话、开场白和附加系统指令。
- **🎭 选模式**：新对话开始前自动弹出模式选择器，像 DSH 选角色一样一键载入角色与相关记忆。
- **打字机与分页**：回复以打字机逐字呈现，超长内容自动分页，点击继续阅读；思考过程独立显示，不混进台词。
- **自动存卡**：直接对 AI 说「你扮演 XX…」这类设定请求，GAL 会识别并询问是否保存为可复用模式。

## 🧠 角色模式（记忆跟着角色走）

每个角色有**独立记忆空间**：

- 记忆分两类：**全局记忆**（所有角色共享，如通用偏好与常识）与**角色记忆**（只属于某个角色，仅该角色激活时注入对话）。
- 和角色聊天时，AI 自动沉淀的记忆会**归属当前角色**；换一个角色，上一角色的记忆完全不会串进来。
- 角色卡面板的 **「🧠 记忆」** 按钮可管理当前角色的记忆：查看、手动添加、设为全局、删除。
- 切换角色时 GAL 会自动开启新会话，旧角色的对话历史不会泄漏给新角色（会话级隔离）。

## 👥 群组（角色联动）

把几个角色编成一个**群组**：群组成员共享同一个项目作为共同上下文（项目记忆 + 群组设定），谁说过的、发生过的事，其他人都"听得见"。

- 侧边栏「角色 → 群组」建群并选成员；系统自动创建共享项目
- GAL 舞台顶栏「👥 群组」进入群组，**勾选本轮发言者**（或「全选依次发言」）→ 成员按顺序各自以自己的人格发言；不勾选就是单角色私聊
- 群聊时成员立绘**并排同框**，当前发言者高亮

## ❤️ 好感度 & 更多

- **好感度**：每个角色 0-100，随对话自然增长；人格注入带关系分档，语气随亲密度变化，舞台名牌显示 ❤️
- **AI 自己建角色**：对话里说「你扮演 XX…」，模型会用 `gal_character_upsert` 工具直接建卡/更新卡
- **角色卡导入导出**：兼容 SillyTavern PNG 卡，可直接吃现成角色卡生态
- **角色日记**：角色记忆 + 群聊事件合成时间线回看
- **剧情存档**：舞台存档/读档剧情点
- **角色主动消息**：空闲时角色会主动找你说话（默认关闭，可设置）

## ⚡ 功能速览

继承自 DeepSeek++ v1.14.0（详见上游 [README](https://github.com/zhu1090093659/deepseek-pp)）：

- Agentic 记忆：自动保存、筛选并按相关度注入长期记忆，跨对话复用
- Side Panel 侧边栏对话（中/英），项目上下文 + artifact
- Skill 技能体系（内置 10 个 + 可导入），记忆、角色扮演、文档协作等
- 类原生工具调用：联网搜索、网页读取、Python / Shell 沙箱执行、浏览器控制等
- 系统提示词预设、保存项、对话导出（Markdown / HTML / PDF / 压缩包）
- MCP 服务接入、定时自动化任务、云端同步（Google Drive / OneDrive / WebDAV）
- 浮窗宠物与界面主题

> 本 fork 面向 GAL 角色扮演场景；涉及 Native Host 的本地文件读写、浏览器控制等能力与上游一致，按需安装对应宿主。

## 📦 安装

**方式一：Release 包（推荐）**

1. 在 [Releases](https://github.com/wwwangzilin/deepseek-pp-gal/releases) 下载对应浏览器的最新 zip；
2. 解压到本地目录；
3. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启右上角「开发者模式」；
4. 点「加载已解压的扩展程序」，选择解压目录。

**方式二：从源码构建**

```bash
npm ci
npm run build:chrome      # 产物在 dist/chrome-mv3
# 或 npm run dev          # 开发模式（自动重载）
```

然后按方式一加载 `dist/chrome-mv3`。

## 🛠 开发

```bash
npm run compile            # 类型检查
npm test                   # 单测
npm run prompt:freeze      # prompt 字节冻结校验
npm run ci:quality         # 完整质量门禁（提交前建议本地先过）
npm run build:all          # chrome + edge + firefox
npm run zip:chrome         # 打包 zip
```

发布流程：修改版本号（`package.json` 与 `packages/shell-host/package.json` 保持一致）→ 推送 → 打 `v*.*.*` tag 推送，GitHub Actions 会自动完成构建并发布 Release（本 fork 不发布上游 npm 包）。

## 📜 版本历史

- **v1.16.0**：角色体系全面并入 DeepSeek++（独立角色页/独立存储/记忆隔离/AI 自建角色/PNG 角色卡/角色日记）、群组联动（共享项目上下文 + 多角色依次发言 + 多立绘同框）、好感度、剧情存档、角色主动消息、工具调用界面优化。详见 [docs/releases/1.16.0.md](docs/releases/1.16.0.md)。
- **v1.15.0**：GAL 酒馆舞台 + DSH 式角色模式（角色记忆隔离/自动沉淀）+ 默认原版界面一键开关，详见 [docs/releases/1.15.0.md](docs/releases/1.15.0.md)。
- v1.14.0 及更早：上游 DeepSeek++ 版本历史，见 [docs/releases/](docs/releases/)。

## 🤝 致谢

- 上游 [DeepSeek++](https://github.com/zhu1090093659/deepseek-pp)（Apache-2.0）：全部 Agent 工作台能力与工程底座
- [deepseek-gal-tavern](https://github.com/wwwangzilin/deepseek-gal-tavern)：GAL 舞台交互原型参考
- 开源社区立绘素材（GAL 舞台使用，仅随扩展本地分发）

## License

<a name="license">Apache-2.0</a>（与上游一致）。GAL 舞台与角色模式为本 fork 增量，同样以 Apache-2.0 开源。
