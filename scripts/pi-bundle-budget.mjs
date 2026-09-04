#!/usr/bin/env node
// Pi bundle budget guardrail (A0-T2, Issue #511).
//
// Three gates, all fail-closed (exit 1 on any violation):
//
//  1. Real-build red lines: every chrome-mv3 JS bundle (background.js and the
//     content-scripts/* entries) must stay within the shared red-line budget
//     declared by scripts/bundled-skill-package-policy.json
//     (backgroundRawBytesMax / backgroundGzipBytesMax, i.e. 820,000 / 240,000).
//
//  2. Pi dist `node:` gate: inside the installed pi-agent-core dist, Node
//     builtin imports are only legal in harness/env/nodejs.js (the Node-only
//     execution env), and that file may only be imported by dist/node.js (the
//     "./node" entry). The "." entry graph is therefore browser-clean by
//     construction.
//
//  3. Narrow-entry probes: probe bundles importing the A3 usage surface are
//     built with the same pipeline as the extension (vite build, i.e.
//     rolldown + esbuild minify, WXT 0.20.26 / vite 8.0.10) and must stay
//     under their calibrated budgets and contain no `node:` builtin imports
//     and no provider-SDK markers (AWS/Anthropic/Google/Mistral/OpenAI
//     clients must not enter the bundle). Two probes (Issue A1-T3):
//       - pi-only: { agentLoop, setDefaultStreamFn } from the "." entry.
//       - adapter: additionally imports the real DS-web adapter
//         (createDeepSeekStreamFn + createDeepSeekTurnSubmitter), whose graph
//         includes the DS++ core modules (stream codec, streaming tool
//         parsers) that the extension content bundle already ships.
//
// Budget calibration (measured on 2026-08-05, Node v25.8.1, this lockfile):
//   - rolldown pi-only probe (minified): 173,657 raw / 52,525 gzip
//   - rolldown adapter probe (minified): 305,638 raw / 96,539 gzip (includes
//     DS++ core modules already present in the content bundle; the probe
//     double-counts them and is therefore conservative)
//   - rolldown full-A3 probe (minified): 380,350 raw / 126,700 gzip (adapter
//     + loop adapter + runAgentLoop surface; calibrated 2026-08-05 after the
//     A3 loop swap)
//   - rolldown provider probe (minified): 383,593 raw / 128,037 gzip
//     (full-A3 + createDeepSeekWebProvider; the createProvider/models.js
//     dependency surface adds only ~2.7K raw / ~1.2K gzip — no heavy SDK
//     tree enters; calibrated 2026-08-05, B1-T4)
//   - rolldown provider probe + official API (minified): 389,437 raw /
//     129,808 gzip (B1 provider surface + createDeepSeekApiProvider; the
//     official-api client adds only ~5.9K raw / ~1.7K gzip — no OpenAI SDK
//     tree enters; calibrated 2026-08-05, B2-T4)
//   - rolldown provider probe + pi-importer (minified): 422,082 raw /
//     144,652 gzip (B2 surface + parsePiSkillMarkdown/readPiSkillFrontmatter;
//     the SKILL.md parser is co-located in the 968-line local-importer
//     module, hence the ~32.6K raw increment — no pi harness/FileSystem/Shell
//     dependency enters; calibrated 2026-08-05, B3-T4)
//   - esbuild pi-only probe (minified): 213,749 raw / 59,616 gzip (more
//     conservative retention; kept for reference)
//   - Budgets allow ~13-32% raw / ~14-37% gzip headroom over the measured
//     graphs (tightest on the full-A3 probe) for bundler/engine drift and
//     upstream upgrades. A wide-entry regression (index.js `export *`
//     pulling pi-ai's provider catalog and the heavy SDK tree) measures
//     ~950,000 raw / ~260,000+ gzip and blows these budgets by a wide
//     margin.
//
// The real background today (720,903 raw / 208,719 gzip) plus the pi-only
// probe increment (173,657 / 52,525) would exceed the red lines (~894,560 /
// ~261,244), so the A3 integration must plan bundle mitigation (dynamic chunk
// for the loop engine or background slimming); this script is the guardrail
// that keeps both sides honest meanwhile.

import { gzipSync } from 'node:zlib';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(
  resolve(rootDir, 'scripts/bundled-skill-package-policy.json'),
  'utf8',
));
const RED_LINE_RAW = policy.budget.backgroundRawBytesMax;
const RED_LINE_GZIP = policy.budget.backgroundGzipBytesMax;

// Calibrated probe budgets (see header comment).
const PI_PROBE_RAW_MAX = 230_000;
const PI_PROBE_GZIP_MAX = 72_000;
const ADAPTER_PROBE_RAW_MAX = 430_000;
const ADAPTER_PROBE_GZIP_MAX = 145_000;
const PROVIDER_PROBE_RAW_MAX = 450_000;
const PROVIDER_PROBE_GZIP_MAX = 152_000;

const PI_CORE_DIR = resolve(rootDir, 'node_modules/@earendil-works/pi-agent-core');

// Node builtin imports appear as `from "node:..."` / `require("node:...")`
// (with optional whitespace after from/require). `node: null` object fields
// must not match, so the prefix is anchored to the import keyword.
const NODE_BUILTIN_IMPORT_RE = /(?:from\s+|require\(\s*)["']node:/g;

const BROWSER_ARG_INDEX = process.argv.indexOf('--browser');
const requestedBrowser = BROWSER_ARG_INDEX >= 0 ? process.argv[BROWSER_ARG_INDEX + 1] : 'chrome';
if (!requestedBrowser) {
  throw new Error('Usage: pi-bundle-budget.mjs [--browser chrome|edge|firefox]');
}
const buildDir = resolve(rootDir, 'dist', `${requestedBrowser}-mv3`);

const failures = [];
const report = {
  browser: requestedBrowser,
  redLine: { raw: RED_LINE_RAW, gzip: RED_LINE_GZIP },
  piProbeBudget: { raw: PI_PROBE_RAW_MAX, gzip: PI_PROBE_GZIP_MAX },
  adapterProbeBudget: { raw: ADAPTER_PROBE_RAW_MAX, gzip: ADAPTER_PROBE_GZIP_MAX },
  providerProbeBudget: { raw: PROVIDER_PROBE_RAW_MAX, gzip: PROVIDER_PROBE_GZIP_MAX },
  bundles: {},
  piDistNodeGate: null,
  piProbe: null,
  adapterProbe: null,
  providerProbe: null,
};

// ---------------------------------------------------------------------------
// Gate 1: real-build red lines.
// ---------------------------------------------------------------------------
if (!existsSync(buildDir)) {
  failures.push(`${requestedBrowser}-mv3 build output is missing at ${buildDir}; run the browser build first`);
} else {
  const bundles = [];
  const backgroundPath = join(buildDir, 'background.js');
  if (existsSync(backgroundPath)) bundles.push('background.js');
  const contentDir = join(buildDir, 'content-scripts');
  if (existsSync(contentDir)) {
    for (const file of readdirSync(contentDir).sort()) {
      if (file.endsWith('.js')) bundles.push(`content-scripts/${file}`);
    }
  }
  if (bundles.length === 0) {
    failures.push(`${requestedBrowser}-mv3 build has no background.js or content-scripts to measure`);
  }
  for (const bundle of bundles) {
    const content = readFileSync(join(buildDir, bundle));
    const gzip = gzipSync(content, { level: 9 }).byteLength;
    report.bundles[bundle] = { raw: content.byteLength, gzip };
    if (content.byteLength > RED_LINE_RAW || gzip > RED_LINE_GZIP) {
      failures.push(
        `${bundle} exceeds red line: raw ${content.byteLength}/${RED_LINE_RAW}, `
        + `gzip ${gzip}/${RED_LINE_GZIP}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Gate 2: pi dist `node:` gate (static, no bundler).
// ---------------------------------------------------------------------------
if (!existsSync(PI_CORE_DIR)) {
  failures.push('pi-agent-core is not installed; run `npm ci` first');
} else {
  const distDir = join(PI_CORE_DIR, 'dist');
  const nodeImportingFiles = [];
  const envNodejsImporters = [];
  for (const file of walkFiles(distDir)) {
    if (!file.endsWith('.js')) continue;
    const source = readFileSync(file, 'utf8');
    if (NODE_BUILTIN_IMPORT_RE.test(source)) {
      nodeImportingFiles.push(relativeTo(distDir, file));
    }
    if (source.includes('harness/env/nodejs')) {
      envNodejsImporters.push(relativeTo(distDir, file));
    }
  }
  const nodeImportingFilesOutsideEnv = nodeImportingFiles.filter(
    (file) => file !== 'harness/env/nodejs.js',
  );
  if (nodeImportingFilesOutsideEnv.length > 0) {
    failures.push(`pi-agent-core dist has node: imports outside harness/env/nodejs.js: ${nodeImportingFilesOutsideEnv.join(', ')}`);
  }
  if (envNodejsImporters.some((file) => file !== 'node.js')) {
    failures.push(`harness/env/nodejs.js is imported outside the ./node entry: ${envNodejsImporters.join(', ')}`);
  }
  report.piDistNodeGate = {
    nodeImportingFiles,
    envNodejsImporters,
    pass: nodeImportingFilesOutsideEnv.length === 0
      && envNodejsImporters.every((file) => file === 'node.js'),
  };
}

// ---------------------------------------------------------------------------
// Gate 3: narrow-entry probes (same pipeline as the extension build).
// ---------------------------------------------------------------------------
if (failures.length === 0) {
  const probes = [
    {
      key: 'piProbe',
      label: 'pi probe',
      rawMax: PI_PROBE_RAW_MAX,
      gzipMax: PI_PROBE_GZIP_MAX,
      entry: [
        "import { agentLoop, setDefaultStreamFn } from '@earendil-works/pi-agent-core';",
        "console.log('pi-budget-probe', typeof agentLoop, typeof setDefaultStreamFn);",
        '',
      ].join('\n'),
    },
    {
      key: 'adapterProbe',
      label: 'adapter probe',
      rawMax: ADAPTER_PROBE_RAW_MAX,
      gzipMax: ADAPTER_PROBE_GZIP_MAX,
      entry: [
        "import { agentLoop, setDefaultStreamFn } from '@earendil-works/pi-agent-core';",
        "import { createDeepSeekStreamFn, createDeepSeekTurnSubmitter } from '../../core/inline-agent/pi/deepseek-stream-fn';",
        "import { runPiInlineAgentLoop } from '../../core/inline-agent/pi/loop-adapter';",
        "console.log('pi-budget-probe', typeof agentLoop, typeof setDefaultStreamFn, typeof createDeepSeekStreamFn, typeof createDeepSeekTurnSubmitter, typeof runPiInlineAgentLoop);",
        '',
      ].join('\n'),
    },
    {
      key: 'providerProbe',
      label: 'provider probe',
      rawMax: PROVIDER_PROBE_RAW_MAX,
      gzipMax: PROVIDER_PROBE_GZIP_MAX,
      entry: [
        "import { agentLoop, setDefaultStreamFn } from '@earendil-works/pi-agent-core';",
        "import { createDeepSeekStreamFn, createDeepSeekTurnSubmitter } from '../../core/inline-agent/pi/deepseek-stream-fn';",
        "import { runPiInlineAgentLoop } from '../../core/inline-agent/pi/loop-adapter';",
        "import { createDeepSeekWebProvider, createDeepSeekWebModels } from '../../core/inline-agent/pi/deepseek-web-provider';",
        "import { createDeepSeekApiProvider } from '../../core/inline-agent/pi/official-api-provider';",
        "import { parsePiSkillMarkdown, readPiSkillFrontmatter } from '../../core/skill/pi-importer';",
        "console.log('pi-budget-probe', typeof agentLoop, typeof setDefaultStreamFn, typeof createDeepSeekStreamFn, typeof createDeepSeekTurnSubmitter, typeof runPiInlineAgentLoop, typeof createDeepSeekWebProvider, typeof createDeepSeekWebModels, typeof createDeepSeekApiProvider, typeof parsePiSkillMarkdown, typeof readPiSkillFrontmatter);",
        '',
      ].join('\n'),
    },
  ];

  for (const probeSpec of probes) {
    try {
      const probe = await runPiProbe(probeSpec.entry);
      report[probeSpec.key] = {
        raw: probe.raw,
        gzip: probe.gzip,
        nodeImports: probe.nodeImports,
        sdkMarkers: probe.sdkMarkers,
      };
      if (probe.raw > probeSpec.rawMax || probe.gzip > probeSpec.gzipMax) {
        failures.push(
          `${probeSpec.label} exceeds budget: raw ${probe.raw}/${probeSpec.rawMax}, `
          + `gzip ${probe.gzip}/${probeSpec.gzipMax}`,
        );
      }
      if (probe.nodeImports > 0) {
        failures.push(`${probeSpec.label} output contains ${probe.nodeImports} node: builtin import(s)`);
      }
      if (probe.sdkMarkers > 0) {
        failures.push(
          `${probeSpec.label} output contains ${probe.sdkMarkers} provider-SDK marker(s); heavy SDK tree leaked in`,
        );
      }
    } catch (error) {
      failures.push(`${probeSpec.label} build failed: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.error('Pi bundle budget check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Pi bundle budget check passed');

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

function relativeTo(baseDir, file) {
  return file.slice(baseDir.length + 1).replaceAll('\\', '/');
}

async function runPiProbe(entrySource) {
  // The probe entry lives under dist/ (gitignored). It uses a side-effect
  // form (console.log) because rolldown tree-shakes a pure function export
  // out of the entry chunk, which would otherwise under-report the graph.
  const probeDir = join(rootDir, 'dist', '.pi-budget-probe');
  mkdirSync(probeDir, { recursive: true });
  const entryPath = join(probeDir, 'entry.mjs');
  writeFileSync(entryPath, entrySource);

  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    root: probeDir,
    logLevel: 'silent',
    build: {
      outDir: 'out',
      emptyOutDir: true,
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: {
        input: { probe: entryPath },
        output: { format: 'es', entryFileNames: '[name].js' },
      },
    },
  });
  const chunk = result.output.find((item) => item.type === 'chunk');
  if (!chunk) throw new Error('probe build produced no chunk');
  const code = chunk.code;
  return {
    raw: code.length,
    gzip: gzipSync(code, { level: 9 }).byteLength,
    nodeImports: countMatches(code, NODE_BUILTIN_IMPORT_RE),
    sdkMarkers: countMatches(
      code,
      /@anthropic-ai|@aws-sdk|@google\/genai|@mistralai|BedrockRuntime|OpenAI\(/g,
    ),
  };
}

function countMatches(source, regex) {
  let count = 0;
  for (const _ of source.matchAll(regex)) count += 1;
  return count;
}
