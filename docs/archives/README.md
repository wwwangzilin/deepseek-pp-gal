## Archived Spec-Driven Work

### audit-remediation

- Description: Full remediation of `audit-report-deepseek-pp-2026-06-05.html`, covering privileged-boundary hardening, runtime schema validation, MCP response limits, release ref integrity, regression tests, and bundle cleanup.
- Date range: 2026-06-05 - 2026-06-05
- Tracking mode: LOCAL_ONLY
- Archived progress: [MASTER.md](audit-remediation/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`

### deepseek-automation

- Description: Browser-local Codex-style automations for DeepSeek++ with run-now sessions and scheduled continuation in the same automation chat.
- Date range: 2026-05-21 - 2026-05-21
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](deepseek-automation/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`

### deepseek-mcp-support

- Description: MCP tool platform rollout covering browser HTTP/SSE/Streamable HTTP transports, local bridge/native messaging, automatic tool execution, sidepanel management, and verification.
- Date range: 2026-05-21 - 2026-05-22
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](deepseek-mcp-support/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`

### edge-firefox-browser-support

- Description: Chrome, Edge, and Firefox MV3 packaging support for DeepSeek++ with browser-aware manifest generation, Firefox sidebar compatibility, and cross-browser build/zip commands.
- Date range: 2026-05-25 - 2026-05-25
- Tracking mode: LOCAL_ONLY
- Archived progress: [MASTER.md](edge-firefox-browser-support/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`

### token-speed-indicator

- Description: Live token output speed indicator for the DeepSeek prompt input box during streaming assistant responses.
- Date range: 2026-05-27 - 2026-05-27
- Tracking mode: LOCAL_ONLY
- Archived progress: [MASTER.md](token-speed-indicator/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`

### officecli-productization

- Description: Built-in `/officecli` skill, safe OfficeCLI MCP provider, sidepanel quick-start, root/write policy enforcement, smoke coverage, and operator documentation.
- Date range: 2026-05-27 - 2026-05-27
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](officecli-productization/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`

### deepseek-official-conversation-export

- Description: Official DeepSeek conversation export with raw/sanitized modes, JSON/Markdown defaults, print-ready HTML, metadata-first attachments, background RPC, and sidepanel download UX.
- Date range: 2026-06-06 - 2026-06-06
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](deepseek-official-conversation-export/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestones: #21-#25
- GitHub issues: #111-#130

### multilingual-english-runtime-support

- Description: First-class multilingual support for DeepSeek++, covering English/Simplified Chinese UI, model-facing prompt behavior, manifest localization, persisted-data boundaries, and release-readiness validation.
- Date range: 2026-06-10 - 2026-06-10
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](multilingual-english-runtime-support/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestones: #26-#30
- GitHub issues: #134-#149

### better-deepseek-capability-adoption

- Description: Better DeepSeek capability adoption for DeepSeek++, covering project context, artifact delivery, Android WebView baseline, interactive agent tools, saved items, prompt controls, history organization, API playground, product polish, validation, and public docs.
- Date range: 2026-06-11 - 2026-06-11
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](better-deepseek-capability-adoption/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestones: #31-#36
- GitHub issues: #152-#181

### browser-control-parity

- Description: Gemini-Nexus parity browser control in DeepSeek++ with Chromium CDP, Accessibility Tree UID snapshots, controlled tabs/groups, browser action tools, sidepanel controls, and validation.
- Date range: 2026-06-14 - 2026-07-01
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](browser-control-parity/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestones: #37-#42
- GitHub issues: #189-#207

### deepseek-pp-reliability-compatibility-refactor

- Description: PC-only reliability, compatibility, maintainability, and measured-performance refactor across Background, Content, Side Panel, sync/persistence, automation, floating chat, and Shell Host; Android/mobile support was retired.
- Date range: 2026-07-13 - 2026-07-14
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](deepseek-pp-reliability-compatibility-refactor/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestones: #43-#48
- GitHub issues: #311-#336, #345, #351-#380
- Final batch PR: #394

### pc-runtime-hardening-wave-2

- Description: PC-only runtime hardening Wave 2 covering MCP decoding/resource budgets, strict request decoding, tool-stream terminal states, platform truth, Shell catalog/version truth, Side Panel first-chat budget and compatibility closure.
- Date range: 2026-07-14 - 2026-07-14
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](pc-runtime-hardening-wave-2/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestones: #49-#50
- GitHub issues: #395-#401
- Final batch PR: #402

### mcp-capability-plane

- Description: Bounded, on-demand MCP capability projection without weakening real tool authorization or execution (CP.1-CP.5): core capability contracts, runtime surfaces and controls, Side Panel controls, compatibility inventory and validation.
- Date range: 2026-07-16 - 2026-07-16
- Tracking mode: LOCAL_ONLY
- Archived progress: [MASTER.md](mcp-capability-plane/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub issue: #407

### pi-agent-core-integration

- Description: Step A of embedding @earendil-works/pi-agent-core as the inline agent loop engine: AGENT_* event protocol golden, DS-web StreamFn adapter, tool bridge with real authorization integration, pi runAgentLoop swap (L3-reviewed), budgets/guardrails, validation closure and governance sync.
- Date range: 2026-07-31 - 2026-08-05
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](pi-agent-core-integration/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestones: #51-#52
- GitHub issues: #511-#515
- Batch PRs: #516-#520

### pi-agent-core-step-b1

- Description: Step B1 of the pi-agent-core integration: register the deepseek-web backend as a first-class pi-ai provider (`Provider<'deepseek-web'>` via `createProvider`, custom `Api` extension point), contract-first port + tests, provider probe bundle guardrail, loop wiring with golden byte-parity.
- Date range: 2026-08-05 - 2026-08-05
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](pi-agent-core-step-b1/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestone: #53
- GitHub issue: #526
- Batch PRs: #523-#525, #527, #529

### pi-agent-core-step-b2

- Description: Step B2 of the pi-agent-core integration: official DeepSeek API as a second model backend (`Provider<'deepseek-api'>`), OpenAI-compatible messages + reasoning, dual-backend single authority (`modelBackend`), per-backend chain authority with fail-closed checks.
- Date range: 2026-08-05 - 2026-08-05
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](pi-agent-core-step-b2/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestone: #54
- GitHub issue: #530
- Batch PRs: #531-#534

### pi-agent-core-step-b3

- Description: Step B3 of the pi-agent-core integration: pi/agentskills.io SKILL.md ecosystem import through the existing local-import pipeline, contract-hardened SKILL.md parser, zero pi-runtime-dependency bridge, pi prompt templates never enter the wire.
- Date range: 2026-08-05 - 2026-08-05
- Tracking mode: GITHUB_STANDARD
- Archived progress: [MASTER.md](pi-agent-core-step-b3/progress/MASTER.md)
- GitHub repository: `zhu1090093659/deepseek-pp`
- GitHub milestone: #55
- GitHub issue: #535
- Batch PRs: #536-#539
