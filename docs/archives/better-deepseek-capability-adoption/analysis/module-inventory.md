# Module Inventory

## Summary Table

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:--|:--|:--|--:|--:|:--|:--|
| Browser entrypoints | Extension lifecycle, content/main/background scripts | WXT, DOM, chrome APIs, core modules | 3 | ~2,000+ | Critical | S🟡 U🟡 P🟡 E🔴 R🟡 |
| Sidepanel UI | Management UI for settings, tools, memory, skills, MCP, automation, chat | React, core stores, i18n | 25 | 6,562 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Interceptor | Fetch/SSE parsing, request augmentation, tool-call extraction | DeepSeek request shape, prompt/tool contracts | 6 | 1,879 | Critical | S🟡 U🟡 P🟡 E🔴 R🟡 |
| Prompt + memory | Prompt assembly, memory selection/injection, prompt visibility | i18n, token estimator, memory store | 5 | 456 | Medium | S🟢 U🟢 P🟡 E🟢 R🟡 |
| Tool runtime | Local tool schema, invocation parsing, execution history | memory, web, MCP descriptors | 9 | 1,682 | High | S🟢 U🟢 P🟡 E🟡 R🟢 |
| MCP + shell | External tool discovery/execution and native shell bridge | browser messaging, native host, MCP transports | 12 | 1,685 | High | S🟡 U🟢 P🟢 E🟡 R🟢 |
| Skill system | Builtin/custom/remote Skill registry, parser, GitHub import | chrome storage, GitHub API, i18n | 5 | 1,869 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Export | Conversation export normalization, artifacts, attachment metadata | DeepSeek official API, content UI | 11 | 1,697 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| Automation | Scheduled DeepSeek task execution | alarms, DeepSeek API, prompt/tool stack | 7 | 1,891 | High | S🟡 U🟢 P🟡 E🟡 R🟡 |
| i18n | Locale resources, preference storage, translation helpers | chrome storage, manifest locales | 5 | 400+ | Medium | S🟢 U🟢 P🟡 E🟢 R🟢 |
| Sync | WebDAV config/schema/client | browser storage, WebDAV | 3 | 387 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| Pet/theme/token UI | Visual feedback and token speed | content DOM, storage, i18n | 8 | 400+ | Medium | S🟢 U🟡 P🟡 E🟡 R🟡 |
| Tests/scripts | Build, release, i18n, smoke, policy verification | npm, WXT, Vitest, gh/actionlint optional | 30+ | n/a | Medium | S🟢 U🟢 P🟡 E🟡 R🟢 |

> S.U.P.E.R score uses green = healthy, yellow = partial, red = violation.

## Module Details

### Browser Entrypoints

- **Path**: `entrypoints/content.ts`, `entrypoints/main-world.content.ts`, `entrypoints/background.ts`
- **Responsibility**: Coordinate extension runtime across DeepSeek page, MAIN world fetch hook, content DOM, and background APIs.
- **Public API**: WXT `defineContentScript`, runtime message handlers, MAIN/content bridge protocol.
- **Internal Dependencies**: most `core/*` modules.
- **External Dependencies**: WXT, browser/chrome APIs, DeepSeek DOM and request shape.
- **Complexity Rating**: Critical.
- **Transformation Notes**: Android cannot use MV3 APIs directly; this module needs a platform port layer rather than Android conditionals scattered through content/background logic.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. `entrypoints/content.ts` owns export, pet, token speed, tool rendering, inline agent restore, theme sync, and bridge state.
  - **U**: Partial. Content depends on core, but DOM/runtime concerns are mixed in one large entrypoint.
  - **P**: Partial. MAIN/content bridge has message shapes, but they are not formal schemas.
  - **E**: Violation. Assumes WebExtension APIs and desktop browser extension environment.
  - **R**: Partial. Browser targets are replaceable through WXT; Android is not.

### Sidepanel UI

- **Path**: `entrypoints/sidepanel/`
- **Responsibility**: User-facing configuration and management surfaces.
- **Public API**: React pages/components and runtime messages.
- **Internal Dependencies**: core stores, i18n resources, skill import, MCP store.
- **External Dependencies**: React, Tailwind, browser APIs.
- **Complexity Rating**: High.
- **Transformation Notes**: New features should avoid making `SettingsPage.tsx` and `McpPage.tsx` larger. Add focused pages/components for Projects, Saved Items, Voice, and Android status.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Several pages are already large; new drawers should be separated by capability.
  - **U**: Partial. UI generally calls stores, but some pages combine persistence, validation, and layout.
  - **P**: Partial. Store contracts exist, but feature-specific schemas should be explicit.
  - **E**: Partial. Browser extension APIs are assumed in UI flows.
  - **R**: Partial. UI components are replaceable if backed by core contracts; large pages have higher replacement cost.

### Interceptor

- **Path**: `core/interceptor/`
- **Responsibility**: Patch fetch, parse streaming responses, augment outgoing prompts, parse tool calls, restore tool blocks.
- **Public API**: `installFetchHook`, `augmentRequestBody`, `extractToolCalls`, token speed and response completion payloads.
- **Internal Dependencies**: prompt, skill, tool descriptors, DeepSeek PoW.
- **External Dependencies**: DeepSeek request/response shape, browser fetch/SSE behavior.
- **Complexity Rating**: Critical.
- **Transformation Notes**: New Better-style tags should be normalized into existing tool-call contracts instead of adding a second parser family in parallel.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Fetch hook is very large and mixes request/response/token/tool restore details.
  - **U**: Partial. Request flow is mostly one-directional, but hook state is mutable and broad.
  - **P**: Partial. Tool descriptors are typed; bridge messages and DeepSeek body shapes need stronger schemas.
  - **E**: Violation. Hard browser/DeepSeek assumptions; Android needs an injected-script adapter.
  - **R**: Partial. Replacement cost is high because many features converge here.

### Prompt + Memory

- **Path**: `core/prompt/`, `core/memory/`
- **Responsibility**: Build augmented prompts and select relevant memories.
- **Public API**: `buildPromptAugmentation`, `selectMemories`, memory store helpers.
- **Internal Dependencies**: i18n, token estimator, constants.
- **External Dependencies**: browser storage for persistence.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Better DeepSeek's token-overlap memory and imported-memory workflow are natural upgrades if added behind the selector/store contract.
- **S.U.P.E.R Assessment**:
  - **S**: Healthy. Prompt and memory selector responsibilities are fairly focused.
  - **U**: Healthy. Prompt assembly consumes stores/descriptors rather than writing them.
  - **P**: Partial. Memory objects are typed, but import/export schemas can be stricter.
  - **E**: Healthy for pure selection; storage access remains browser-bound in store.
  - **R**: Partial. Selector can be swapped; persisted memory schema changes need migration.

### Tool Runtime

- **Path**: `core/tool/`
- **Responsibility**: Local tool descriptors, invocation parsing, execution history, web/memory tools.
- **Public API**: `ToolDescriptor`, `ToolProvider`, `createToolInvocationCatalog`, `executeWebSearchToolCall`.
- **Internal Dependencies**: i18n, memory, web settings.
- **External Dependencies**: fetch and host permissions for web tools.
- **Complexity Rating**: High.
- **Transformation Notes**: Generated files, project context, code runner, voice, and GitHub fetch should be represented as ToolDescriptor-compatible local providers where the model-facing behavior needs tool calls.
- **S.U.P.E.R Assessment**:
  - **S**: Healthy. Core contracts are focused.
  - **U**: Healthy. Providers conform to descriptors.
  - **P**: Partial. JSON schemas exist but are not runtime-validated everywhere.
  - **E**: Partial. Web tools rely on browser permissions and HTML parsing.
  - **R**: Healthy. Provider model supports replacement.

### MCP + Shell

- **Path**: `core/mcp/`, `core/shell/`, `packages/shell-host/`
- **Responsibility**: Discover and execute MCP tools across browser, remote, native messaging, and shell host.
- **Public API**: MCP client/store/transports, shell contracts and policy.
- **Internal Dependencies**: tool contracts, browser APIs, native messaging.
- **External Dependencies**: MCP servers, native messaging manifests, local shell.
- **Complexity Rating**: High.
- **Transformation Notes**: Browser-side code runner should not bypass shell policy accidentally. Android cannot use native messaging, so shell-dependent tools must degrade explicitly.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. MCP store and UI touch broad concerns.
  - **U**: Healthy. Transports are relatively clean adapters.
  - **P**: Healthy. MCP and shell contracts are explicit.
  - **E**: Partial. Native messaging is desktop-only.
  - **R**: Healthy. Transports are replaceable.

### Skill System

- **Path**: `core/skill/`, `entrypoints/sidepanel/components/GitHubSkillImportPanel.tsx`
- **Responsibility**: Builtin, custom, and GitHub-imported skills.
- **Public API**: `getAllSkills`, `saveSkill`, GitHub importer, parser.
- **Internal Dependencies**: types, i18n, chrome storage.
- **External Dependencies**: GitHub API.
- **Complexity Rating**: High.
- **Transformation Notes**: Better DeepSeek's AI-created Skill card maps well to current custom Skill creation, but should be implemented as a structured import/create flow rather than a raw BDS tag clone.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Registry handles custom and remote source bookkeeping.
  - **U**: Partial. UI/import/runtime have separate entry points but share storage contracts.
  - **P**: Partial. Skill source contracts exist; import payloads should remain schema-guarded.
  - **E**: Partial. GitHub import requires network and browser storage.
  - **R**: Partial. Builtin/custom/remote are replaceable, but name/source migration is sensitive.

### Export

- **Path**: `core/export/`
- **Responsibility**: Export official DeepSeek conversations to structured data and artifacts.
- **Public API**: `runConversationExport`, `buildConversationExportArtifacts`, export schemas.
- **Internal Dependencies**: DeepSeek official API normalization, artifact builders.
- **External Dependencies**: DeepSeek web session and file metadata endpoints.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Better DeepSeek supports image export and specific-message export; current DeepSeek++ has stronger official-session export but lacks image output and saved-item/message-level workflows.
- **S.U.P.E.R Assessment**:
  - **S**: Healthy. Normalization/artifact responsibilities are separated.
  - **U**: Healthy. Transport is injected.
  - **P**: Healthy. Export schema is explicit.
  - **E**: Partial. Official endpoint assumptions are web-specific.
  - **R**: Healthy. Transport and artifact builders are replaceable.

### Automation

- **Path**: `core/automation/`
- **Responsibility**: Create, schedule, run, and track repeat DeepSeek tasks.
- **Public API**: automation store, scheduler, runner, message contracts.
- **Internal Dependencies**: DeepSeek API, prompt/tool runtime.
- **External Dependencies**: browser alarms and DeepSeek sessions.
- **Complexity Rating**: High.
- **Transformation Notes**: Better DeepSeek's server status/announcement/what's-new features are adjacent operational surfaces, not core automation dependencies.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Scheduling, running, and state are split but tightly coupled.
  - **U**: Healthy. Runner consumes store/config and emits status.
  - **P**: Partial. Automation types exist; persisted migrations should stay explicit.
  - **E**: Partial. Alarms are extension-specific.
  - **R**: Partial. Replacing scheduler or platform requires adapter work.

### i18n

- **Path**: `core/i18n/`, `public/_locales/`
- **Responsibility**: Runtime and manifest localization.
- **Public API**: `translate`, locale store/provider.
- **Internal Dependencies**: resources.
- **External Dependencies**: browser language and storage.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Better DeepSeek has more languages; DeepSeek++ currently has stronger bilingual model-facing coverage but fewer locales.
- **S.U.P.E.R Assessment**:
  - **S**: Healthy.
  - **U**: Healthy.
  - **P**: Partial. Key parity is tested; resource schema remains TypeScript-based.
  - **E**: Healthy.
  - **R**: Healthy.

### Sync

- **Path**: `core/sync/`
- **Responsibility**: WebDAV configuration, schema boundaries, client operations.
- **Public API**: sync schema and WebDAV client.
- **Internal Dependencies**: browser storage consumers.
- **External Dependencies**: WebDAV server.
- **Complexity Rating**: Medium.
- **Transformation Notes**: New persisted data types must explicitly decide whether they sync and whether secrets are excluded.
- **S.U.P.E.R Assessment**:
  - **S**: Healthy.
  - **U**: Healthy.
  - **P**: Healthy.
  - **E**: Partial. External server config is runtime-dependent.
  - **R**: Healthy.

### Pet, Theme, Token UI

- **Path**: `core/pet/`, `core/theme/`, `core/token/`, content DOM sections.
- **Responsibility**: Runtime visual feedback and token-speed indicator.
- **Public API**: config stores, estimator, localized lines.
- **Internal Dependencies**: content DOM, i18n, storage.
- **External Dependencies**: DeepSeek DOM and page theme.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Android theme/status-bar handling can reuse a theme reporting contract, but native bridge should own platform side effects.
- **S.U.P.E.R Assessment**:
  - **S**: Healthy in core files.
  - **U**: Partial because content entrypoint owns many DOM effects.
  - **P**: Partial. Config types exist; DOM contract is implicit.
  - **E**: Partial. Desktop DOM placement assumptions.
  - **R**: Partial. Visual implementation is replaceable if state contracts remain stable.

### Tests and Scripts

- **Path**: `tests/`, `scripts/`, `.github/workflows/`
- **Responsibility**: Validation, release gates, smoke checks.
- **Public API**: npm scripts.
- **Internal Dependencies**: project modules.
- **External Dependencies**: actionlint, WXT, Vitest, native host, npm registry for release closure.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Android and e2e browser support require new test layers; do not call a server/build successful without a real smoke action.
- **S.U.P.E.R Assessment**:
  - **S**: Healthy.
  - **U**: Healthy.
  - **P**: Partial. Some smoke outputs are convention-based.
  - **E**: Partial. Several checks depend on local tools.
  - **R**: Healthy.
