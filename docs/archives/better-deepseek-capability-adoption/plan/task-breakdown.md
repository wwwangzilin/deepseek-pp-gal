# Task Breakdown

## Overview

- **Task definition**: Incorporate the high-value Better DeepSeek capabilities that DeepSeek++ does not currently support, with Android WebView support explicitly in scope.
- **Total Phases**: 6
- **Total Tasks**: 25
- **Estimated Total Effort**: XL
- **Tracking Mode**: `GITHUB_STANDARD`
- **Confirmed Direction**: User delegated prioritization and explicitly called out Android as valuable. Execution still requires the Phase 5 confirmation checkpoint before implementation starts.

## S.U.P.E.R Design Constraints

- **S (Single Purpose)**: Do not add more responsibilities to `entrypoints/content.ts`, `core/interceptor/fetch-hook.ts`, `SettingsPage.tsx`, or `McpPage.tsx` without extracting focused modules first.
- **U (Unidirectional Flow)**: Keep flow as platform adapter -> runtime contract -> core service -> UI renderer. Android-specific behavior must not import browser-only concrete implementations.
- **P (Ports over Implementation)**: Define TypeScript contracts and schemas before implementing project context, artifacts, Android bridge, saved items, voice, and sandbox execution.
- **E (Environment-Agnostic)**: Browser extension, Android WebView, and native messaging are separate platform capabilities. Unsupported combinations must be explicit, visible, and tested.
- **R (Replaceable Parts)**: New capabilities should be replaceable through providers/adapters: project sources, artifact writers, platform services, sandbox runners, and voice engines.

## Testing and Governance Constraints

- Feature work must add or update automated tests.
- Prompt/tool behavior changes must update `prompt:freeze` intentionally.
- Persisted data changes must update schema tests and WebDAV sync boundary tests.
- Android validation must distinguish TypeScript unit tests, Gradle/Kotlin tests, APK build, and emulator/WebView smoke. Do not report Android as validated when the required toolchain is missing.
- Durable implementation rules go to the resolved native memory surface; future-agent rules must be reflected through the canonical instruction sync source, not by hand-editing generated `AGENTS.md`.

## Phase 1: Foundation Contracts and Seams

**Goal**: Establish the architectural ports needed before adding Better-style capabilities.
**Prerequisite**: Phase 1 analysis documents complete.
**S.U.P.E.R Focus**: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T1.1 | Define platform service contracts for storage, runtime messaging, downloads, file picking, asset URLs, and environment capabilities | P0 | M | - | A | P,E,R | Unit tests for browser adapter and capability detection | Record platform capability invariant if accepted | Contracts live under a focused module; browser implementation preserves existing behavior; unsupported capabilities are explicit |
| T1.2 | Add runtime bridge message schemas for MAIN/content/background/platform communication | P0 | M | - | B | P,U | Unit tests for schema accept/reject cases | Record bridge schema convention | Bridge messages are typed and validated; existing request augmentation and tool restore paths still compile and test |
| T1.3 | Define prompt context ordering contract for preset, Skill, memory, project context, and tool instructions | P0 | M | - | C | P,U | Request augmentation tests plus prompt-freeze update | Record prompt ordering invariant | Project context can be inserted later without changing memory/Skill semantics; prompt-freeze catches model-facing drift |
| T1.4 | Extract content card renderer registry from the large content entrypoint | P0 | M | T1.2 | D | S,R | Tests for renderer registration and existing tool block rendering | None unless renderer convention becomes durable | Existing tool cards, export action, and inline agent traces keep behavior; new cards can register without editing unrelated content logic |
| T1.5 | Add minimal browser e2e fixture harness for DOM injections | P1 | M | T1.2,T1.4 | E | P,E | Playwright or equivalent fixture test for content injection against mock DeepSeek DOM | Record e2e command if adopted | Test harness exercises at least one content script card and one request augmentation path |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T1.1 | M | Medium | `core/platform/*`, `core/browser/*` |
| B | T1.2 | M | Medium | `core/messaging.ts`, `entrypoints/*` |
| C | T1.3 | M | Medium | `core/prompt/*`, `core/interceptor/request-augmentation.ts`, tests |
| D | T1.4 | M | High | `entrypoints/content.ts`, `core/ui/*` |
| E | T1.5 | M | Low | `tests/e2e/*`, fixtures |

## Phase 2: P0 Project Context and Artifact Delivery

**Goal**: Add the highest-value Better DeepSeek workflows that directly improve agentic work: repository/folder context, RAG, and downloadable generated outputs.
**Prerequisite**: Phase 1 contracts complete.
**S.U.P.E.R Focus**: S, P, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T2.1 | Add Project and ProjectFile schemas, stores, migrations, and sync boundary rules | P0 | M | T1.1,T1.3 | A | P,E | Store/schema/sync tests | Record project sync boundary | Project metadata and files have explicit schemas; secrets/local file contents are not synced silently |
| T2.2 | Add GitHub repo, web page, and local folder source readers for project context | P0 | L | T2.1 | A | S,P,E | Fixture tests for GitHub URLs, branch fallback, binary filtering, size limits, `.gitignore`, and errors | Record source-reader limits | Public/private GitHub and folder flows produce normalized project files with bounded size and clear failures |
| T2.3 | Add project RAG retrieval and prompt injection budget integration | P0 | M | T1.3,T2.1 | B | P,U,R | Retrieval ranking tests and request augmentation tests | Record prompt budget behavior | Relevant project chunks inject after Skill/preset ordering contract without starving memory/tool instructions |
| T2.4 | Add Projects UI and attach menu for active project/files | P0 | L | T2.1,T2.2,T2.3 | C | S,R | Component/store tests and e2e fixture coverage if harness exists | None | Users can create projects, import sources, select active files, and see injection status |
| T2.5 | Add generated artifact local tool provider for single-file outputs | P0 | M | T1.2,T1.4 | D | P,R | Tool parser/runtime tests and content card tests | Record artifact safety limits | Model can request a downloadable file through the existing ToolDescriptor path; file names, MIME, and size are validated |
| T2.6 | Add multi-file project bundle workflow equivalent to LONG_WORK | P0 | L | T2.5 | D | S,P,R | Bundle tests, card restore tests, prompt-freeze update | Record artifact bundle contract | Multiple generated files are collected into a zip with visible progress and no raw technical tag leakage |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T2.1, T2.2 | L | Medium | `core/project/*`, source readers, sync tests |
| B | T2.3 | M | Medium | `core/prompt/*`, `core/project/rag*`, tests |
| C | T2.4 | L | Medium | `entrypoints/sidepanel/pages/*`, new components |
| D | T2.5, T2.6 | L | High | `core/tool/*`, card renderer registry, content cards |

## Phase 3: Android WebView Baseline

**Goal**: Make DeepSeek++ run as an Android WebView app with explicit capability boundaries.
**Prerequisite**: Phase 1 platform ports complete. Phase 2 may run partly in parallel, but Android feature parity work depends on stable adapters.
**S.U.P.E.R Focus**: E, P, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T3.1 | Add Android web-bundle build target and asset staging | P0 | M | T1.1 | A | E,R | Build script tests or smoke script; compile/build target | Record Android build commands | `npm run build:android` produces staged JS/CSS/assets without changing browser builds |
| T3.2 | Add Kotlin WebView host, asset loader, cookie/login handling, and injection lifecycle | P0 | L | T3.1 | A | E,P | Gradle assemble where toolchain exists; Kotlin unit tests for pure helpers | Record validation caveats | WebView loads DeepSeek, injects bundled scripts, preserves cookies, and handles back navigation |
| T3.3 | Implement Android bridge for storage, downloads, file/folder picking, theme, and locale | P0 | L | T1.1,T3.2 | B | P,E,R | Kotlin unit tests + TypeScript adapter tests | Record bridge security invariant | Android platform adapter passes existing storage/runtime tests; downloads and pickers have clear user-visible errors |
| T3.4 | Add Android capability gating for native messaging, Shell, sidePanel-only UI, and unsupported browser APIs | P0 | M | T3.3 | C | E,R | Capability matrix tests | Record unsupported-capability rule | Android does not show false-ready controls for Shell/native messaging; unsupported features fail loudly and visibly |
| T3.5 | Add Android test/CI documentation and smoke commands | P1 | M | T3.1,T3.2,T3.3,T3.4 | D | P,E | Documented commands plus best available local validation | Record Android validation matrix | README/developer docs state toolchain, commands, outputs, and what was actually validated |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T3.1, T3.2 | L | Medium | `android/*`, build scripts |
| B | T3.3 | L | Medium | `android/*`, `core/platform/*` |
| C | T3.4 | M | Medium | capability stores/UI |
| D | T3.5 | M | Low | docs, scripts |

## Phase 4: P1 Interactive Agent Tools

**Goal**: Add the next tier of Better DeepSeek capabilities that improve day-to-day interaction but depend on the P0 contracts.
**Prerequisite**: Phase 1 complete; individual tasks may depend on Phase 2/3 outputs.
**S.U.P.E.R Focus**: S, P, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T4.1 | Add user-approved browser sandbox code runner for JS/TS/Python where available | P1 | L | T1.1,T1.4,T2.5 | A | P,E | Sandbox tests, approval tests, output-limit tests | Record no-silent-exec invariant | Code never runs without user action; output returns to the chat through a typed tool result |
| T4.2 | Add optional voice input and response read-aloud | P1 | M | T1.1 | B | S,E | Adapter tests with unsupported browser fallback | None | Users can enable STT/TTS where platform supports it; unsupported platforms show explicit state |
| T4.3 | Add AI-assisted Skill creator tool with review-before-save | P1 | M | T1.2,T2.5 | C | P,U | Tool/runtime/Skill registry tests | Record review-before-save rule if accepted | Model-created skills enter existing custom Skill registry only after user review and name validation |
| T4.4 | Add memory import from another AI workflow | P1 | M | T1.3 | C | P,U | Parser/schema/memory store tests | Record import format if durable | Imported profile text is converted into typed memories with preview, dedupe, and no automatic prompt mutation |
| T4.5 | Add saved items, bookmarks, and snippets with prompt insertion | P1 | M | T1.1 | D | S,P | Store/component tests and sync boundary tests | Record saved-item sync rule | Users can save messages/snippets, search them, and insert snippets into the prompt without mutating original chats |
| T4.6 | Add prompt injection controls: disable memory/system prompt, preset cadence, force response language | P1 | M | T1.3 | E | P,U | Request augmentation tests and prompt-freeze update | Record prompt-control semantics | Controls are explicit, persisted, localized, and reflected in model-facing prompt tests |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T4.1 | L | High | sandbox, tool runtime, renderer cards |
| B | T4.2 | M | Low | `core/voice/*`, settings UI |
| C | T4.3, T4.4 | M | Medium | `core/skill/*`, `core/memory/*`, tool provider |
| D | T4.5 | M | Medium | `core/saved-items/*`, sidepanel UI |
| E | T4.6 | M | Medium | prompt/settings/i18n tests |

## Phase 5: P2 Organization, Export, and Product Surfaces

**Goal**: Add lower-priority Better DeepSeek features once the core agentic and Android work is stable.
**Prerequisite**: P0 phases complete.
**S.U.P.E.R Focus**: S, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T5.1 | Add chat tags, filtering, and history search adapters for DeepSeek sidebar | P2 | L | T1.5 | A | S,E | DOM fixture/e2e tests | Record DOM adapter assumptions | Tags/search are isolated from official export and fail visibly if DeepSeek DOM changes |
| T5.2 | Extend export to message-level, saved-item, and image outputs | P2 | M | T4.5 | B | P,R | Export schema/artifact tests | None | Existing official export remains compatible; new formats are optional and clearly labeled |
| T5.3 | Add API playground behind explicit developer/user setting | P2 | M | T1.1 | C | S,P | API key boundary tests and UI tests | Record API key storage rule if needed | Playground uses existing API key boundaries and never leaks keys into sync/export |
| T5.4 | Add small UX polish: code block downloads, native navigation patch, local what's-new panel | P2 | M | T1.5 | D | S,E | DOM fixture tests | None | UX patches are optional, reversible, and covered by selectors/fixtures |
| T5.5 | Decide custom CSS/theme preset policy; implement only if compatible with store/product posture | P2 | S | T1.5 | E | P,E | Not applicable if decision doc only; if implemented, add settings tests | Record policy decision | A documented go/no-go decision exists; no remote CSS or unbounded injection is introduced |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T5.1 | L | High | DeepSeek DOM adapters |
| B | T5.2 | M | Medium | export modules, saved items |
| C | T5.3 | M | Low | sidepanel API playground |
| D | T5.4 | M | Medium | content DOM utilities |
| E | T5.5 | S | Low | docs/settings |

## Phase 6: Hardening, Documentation, and Release Readiness

**Goal**: Validate the full feature set, update public docs without leaking implementation details, and prepare a release-quality branch.
**Prerequisite**: Selected feature phases complete.
**S.U.P.E.R Focus**: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T6.1 | Run and fix full validation matrix across compile, tests, prompt freeze, browser builds, smoke checks, and Android best-available checks | P0 | L | T2.*,T3.*,T4.*,T5.* | A | P,E | Full validation matrix | Record any new release gate | Validation results are documented with exact pass/fail/blocked states |
| T6.2 | Update README, README_EN, store-facing docs, and Android install/developer docs | P1 | M | T6.1 | B | S,P | Docs leakage checks and markdown/diff checks | Record public positioning if durable | Public docs describe user-visible features only and do not expose internal endpoints/protocol details |
| T6.3 | Final progress reconciliation and archive preparation | P1 | S | T6.1,T6.2 | C | P | GitHub issue/milestone status check | None | MASTER.md, issues, milestones, and archive notes are consistent before release/merge |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T6.1 | L | High | whole repo |
| B | T6.2 | M | Low | README/docs/store |
| C | T6.3 | S | Low | progress/archive docs |
