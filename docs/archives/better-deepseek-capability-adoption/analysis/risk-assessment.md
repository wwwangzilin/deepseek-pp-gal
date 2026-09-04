# Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:--|:--|:--|:--|
| **S** Single Purpose | 🟡 | Core modules are mostly focused, but `entrypoints/content.ts`, `core/interceptor/fetch-hook.ts`, `SettingsPage.tsx`, and `McpPage.tsx` are already large convergence points. | High |
| **U** Unidirectional Flow | 🟡 | Runtime generally flows MAIN world -> content -> core -> background, but mutable hook state and broad content responsibilities make feature additions risky. | High |
| **P** Ports over Implementation | 🟡 | ToolDescriptor/MCP/export schemas are good ports. Android, bridge messages, project-file context, saved items, and sandbox execution do not exist as contracts yet. | High |
| **E** Environment-Agnostic | 🔴 | Current product is WebExtension-first. Native messaging, sidePanel, downloads, storage, and DOM assumptions are not Android-ready. | Critical |
| **R** Replaceable Parts | 🟡 | Tool providers and MCP transports are replaceable; platform/runtime/UI entrypoints are not yet cleanly replaceable for Android or sandboxed artifacts. | High |

**Overall Health**: 0/5 fully healthy for this transformation target — refactoring needed before large feature porting.

## S.U.P.E.R Violation Hotspots

1. `entrypoints/content.ts`: too many DOM/runtime responsibilities; Android and new inline cards will make it harder to reason about.
2. `core/interceptor/fetch-hook.ts`: critical and large; new output tags or stream behavior must be added through explicit contracts.
3. `entrypoints/sidepanel/pages/SettingsPage.tsx` and `McpPage.tsx`: large UI pages; new settings should not be appended indefinitely.
4. Platform APIs: WebExtension APIs are assumed directly in runtime, storage, sidepanel, native messaging, and downloads.
5. Model-facing tool syntax: DeepSeek++ has one XML/JSON ToolDescriptor path; Better DeepSeek has BDS tags. Supporting both naively would create a second source of truth.

## Better DeepSeek Gap Matrix

| Capability | Better DeepSeek evidence | DeepSeek++ status | Priority | Recommended mapping |
|:--|:--|:--|:--|:--|
| Android WebView app | `android/`, `build:android`, Android bridge/polyfills/tests | Not supported | P0 | Add platform abstraction + Android host; keep browser extension path unchanged |
| Advanced attach menu: folder upload, GitHub repo import, web fetch | `src/content/ui/AttachMenu.svelte`, `files/github-reader.js`, `folder-reader.js` | Partial: web fetch exists; GitHub Skill import exists, not repo context; no folder/project upload | P0 | Build Project Context feature with file/GitHub/web sources and explicit persisted schemas |
| Project mode + local RAG | `project-manager.js`, `rag-engine.js`, Projects UI | Not supported | P0 | Add Projects/ProjectFiles store, BM25-style retrieval, prompt injection budget controls |
| Generated files + LONG_WORK zip | `BDS:create_file`, `BDS:LONG_WORK`, `files/long-work.js` | Not supported | P0 | Add artifact tool provider and content cards; use existing tool parser/contracts, not BDS tags |
| Rich inline cards: HTML/visualizer/PPTX/Excel/DOCX | parser/tool cards/sandbox | Partial via OfficeCLI skill/Shell; no browser-side generated artifact cards | P1 | Start with file/artifact cards, then optionally office/browser sandbox |
| Browser sandbox code runner | `AUTO:CODE_RUNNER`, `CodeRunner`, sandbox iframe | Partial: Shell/Python native host exists, but no browser sandbox or Android-compatible runner | P1 | Add user-approved sandbox local tool with strict output and no silent auto-exec |
| Voice STT/TTS | README and settings | Not supported | P1 | Add optional Web Speech API surface for browser; Android bridge later |
| Saved items/bookmarks/snippets | `SavedItems.svelte`, snippets | Not supported | P1 | Add saved item/snippet store and prompt insertion UX |
| Chat tags/filtering/history search | sidebar injectors/tag modules | Not supported | P1 | Requires DeepSeek sidebar DOM adapter; keep separate from official export |
| Memory import from another AI | memory import prompts and UI | Partial: memory import/export JSON exists; no cross-AI import workflow | P1 | Add import assistant flow that creates typed DeepSeek++ memories |
| Skill creator tool | `BDS:skill_create`, Skill card | Partial: custom/GitHub skills exist; no AI-created skill capture card | P1 | Add structured `skill_create` local tool writing to existing Skill registry after user review |
| Prompt injection controls | always/first/every X, disable prompt/memory, force language | Partial: presets and fixed reinjection interval; no user-configurable cadence/disable memory | P1 | Extend preset/settings contracts; preserve prompt-freeze |
| Export images/specific messages | Better export UI | Partial: official full/current export to HTML/Markdown/PDF | P2 | Add message-level and image artifact after export UX redesign |
| API playground | `api-playground/*` | Not supported | P2 | Sidepanel developer tool; use stored API key boundary |
| Server status checker | `status-monitor.js`, status banner | Not supported | P2 | Optional operational UI, not core agentic capability |
| Announcement/what's-new | remote config/banner/modal | Not supported | P2 | Avoid remote announcements by default unless product policy is agreed |
| Custom CSS/theme presets | custom CSS settings | Not supported | P2 | Low strategic value; may conflict with stable DeepSeek DOM |
| Native navigation patch/code block downloads | README/changelog | Not supported | P2 | Small UX tasks after higher-value agent features |

## Priority Recommendation

The best sequence is not to copy Better DeepSeek feature-by-feature. DeepSeek++ already has a stronger agentic spine through ToolDescriptor, MCP, Shell, automation, export, and i18n. The highest return is to add missing user-facing workflows on top of those contracts:

1. **P0 Android and platform ports**: create the seams needed for WebView, storage, downloads, file picking, asset URLs, and runtime injection.
2. **P0 project context ingestion**: folder/GitHub/web sources, persisted projects/files, retrieval, prompt budget integration.
3. **P0 generated artifact delivery**: model-created files, multi-file project zip, download cards, and artifact persistence.
4. **P1 sandbox and interaction upgrades**: code runner, skill creator, memory import, saved snippets, voice.
5. **P2 polish/secondary surfaces**: API playground, image export, status/what's-new, custom CSS, navigation/codeblock UX.

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:--|:--|:--|:--|:--|
| Android work spreads WebView conditionals through browser runtime | High | High | Critical | Add `core/platform` contracts first; browser and Android implementations behind adapters |
| Parallel BDS tag syntax competes with ToolDescriptor XML/JSON syntax | High | Medium | High | Normalize new tools into current invocation catalog; support aliases only through descriptor metadata |
| Generated artifact/code-runner features introduce unsafe execution/download paths | High | Medium | High | Require explicit user approval, sandbox isolation, size limits, MIME allowlists, and tests |
| Project context injection bloats prompts and conflicts with memory/preset/Skill order | High | High | High | Add retrieval budget, ordering contract, and prompt-freeze tests |
| GitHub/folder import stores secrets or huge files in sync | High | Medium | High | Explicit schema: source metadata syncable, file contents opt-in, tokens excluded |
| Android validation is overstated without local SDK/emulator | Medium | High | High | Separate web-bundle tests, Kotlin unit tests, Gradle assemble, and emulator smoke; report missing toolchain honestly |
| DeepSeek DOM changes break attach/menu/sidebar injections | Medium | High | Medium | Keep DOM adapters narrow and covered by fixtures/e2e |
| UI pages become unmaintainable | Medium | Medium | Medium | Add focused feature pages/components; avoid adding everything to Settings |

## High-Severity Risks

### Android Platform Boundary

Android is valuable, but it is not just another WXT target. Better DeepSeek has a native Kotlin WebView host, a JavaScript bridge, Android file/folder pickers, native downloads, WebViewAssetLoader, cookie handling, theme/status-bar sync, and tests. DeepSeek++ must first define platform ports for storage, runtime messages, downloads, file picking, asset URLs, and injected bundles. Without that, Android support would become a fork of the extension runtime.

### Tool Syntax and Prompt Contract

Better DeepSeek relies on many `<BDS:...>` tags. DeepSeek++ already has model-facing ToolDescriptor prompts, XML-like tool tags with JSON payloads, prompt-freeze validation, MCP descriptors, and tool-card rendering. Adding raw BDS tags would duplicate parsing, validation, execution policy, and UI rendering. The safer plan is to expose new features as DeepSeek++ local tools and optional aliases only where compatibility is intentional.

### Generated Artifacts and Code Execution

Client-side PPTX/Excel/DOCX generation and browser code execution are high-value but high-risk. They execute user/model-provided code in a browser context and create downloadable artifacts. These must be designed with explicit approval, sandboxing, output limits, MIME/path validation, and no silent success paths.

### Project Context and RAG

Project files, folder imports, GitHub repo fetch, and RAG search are likely to become a major differentiator. They also introduce storage size, sync, privacy, prompt budget, and ordering concerns. This should be a first-class `Project Context` module, not a side effect of the existing Skill import UI.

## Technical Debt

- Large content/interceptor files make new DOM cards and platform behavior risky.
- Runtime bridge messages lack schema validation.
- Prompt augmentation order is implicit and will need an explicit contract once project context joins memory/preset/Skill/tool instructions.
- Current export is strong for official data but not for message-level/saved-item workflows.
- No Android or e2e browser harness exists.

## Testing Risks

- Android needs at least four layers: pure TypeScript platform-adapter tests, Android bridge unit tests, Gradle assemble, and emulator/WebView smoke. Missing local SDK/Gradle must be reported as a validation gap.
- Prompt/tool changes must update `prompt:freeze` intentionally.
- File ingestion and RAG require fixtures for binary filtering, size limits, `.gitignore`, branch fallback, private repo token errors, and prompt budget behavior.
- Artifact/code-runner features require sandbox tests and user-approval tests before release.

## Project Governance Risks

- `AGENTS.md` is auto-generated; durable future-agent rules should go through the sync source/native memory instead of hand-editing the generated file.
- This run uses Codex native memory as the durable surface; no repo-local fallback memory is selected.
- Previous spec artifacts were complete but unarchived at session start; they were archived before this new run to avoid competing `docs/analysis`, `docs/plan`, and `docs/progress` truth sources.

## Compatibility Concerns

- Browser stores may reject remote-code-like behavior if sandbox generation is not packaged and documented carefully.
- Android WebView cannot rely on extension APIs, native messaging, sidePanel, or desktop downloads.
- WebDAV sync must not copy GitHub tokens, API keys, local file contents, or Android-only transient data unless explicitly designed.
- Existing users' memories, skills, presets, MCP servers, automations, and exports must migrate without schema loss.
