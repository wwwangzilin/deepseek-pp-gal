// Local-skill activation scoring (implicit branch).
// Customized after the scoring paradigm in core/mcp/capability-projection.ts:
// reuses normalizeSearchText / tokenize, drops the pinned dimension (no pinning
// concept), and adds an "applicable / not-applicable scenario" adjustment
// (description-led).
// Enabled only for local indexed skills; does not affect builtin / bundled / imported-github.
//
// Design source: .workbuddy/memory/local-skill-scoring-spec.md (§3 weight table,
// §3.4 scenarioAdjustment, §3.5 threshold dual-gate).
//
// R5 fix (PR #457 third review): P1-B / P1-C / A2 / A4 changes:
//  - scenarioAdjustment: fixed +300 replaced by F0-A coverage-driven dynamic bonus (>=0.6 => round(cov*100), capped at +100).
//  - selectImplicitSkill: weak-query down-weighting (query composed of <=2 common two-char words => down-weight, not zeroed; exact-name hit +800 still wins, A4 fix).
//  - Two-char queries no longer get the description whole-string +400 (only when the normalized whole query length >= 3).
//  - scoreLocalSkill baseline purification: scoringText contains only description + applicable block, excluding notApplicable positive scoring.
//  - extractScenarioBlock keeps a negative lookbehind on the Chinese negation character (prevents an applicable-scenario
//    heading being substring-matched inside a not-applicable-scenario heading); heading no longer adds a negative-ahead guard (A2 fix: restores negative-block extraction and the -1000 suppression).

import { normalizeSearchText, tokenize } from '../mcp/capability-projection';

export interface LocalSkillIndex {
  name: string;
  description: string;
  skillDir: string;
  instructions?: string;
}

// Threshold dual-gate: minimum activation score + significant lead gap (prevents "two weak skills competing for activation").
const ACTIVATION_THRESHOLD = 100;
const MIN_LEAD_GAP = 50;

// Common two-char weak/generic terms (down-weight, not block; A4 fix): when a query is composed solely of
// these low-specificity words, treat as weakly shared and down-weight (not zero out); an exact-name hit (+800)
// still wins activation (e.g. a two-char word that is itself a Skill name should still activate).
// Note: specific scenario words (e.g. "weekly report", "report generation") must NOT be listed here, or they
// would wrongly suppress genuinely applicable hits.
const GENERIC_TWO_CHAR_TERMS = new Set<string>([
  '财务', '新闻', '报告', '报表', '分析', '数据', '文件', '信息', '内容', '总结', '查询', '搜索', '处理', '管理', '生成', '编写', '检查', '说明',
]);

// CJK-friendly tokenization: ASCII letters/digits/underscore/hyphen are kept as-is;
// contiguous CJK segments are split into 2-grams for whole-string matching.
// Fixes the original tokenizer treating a whole Chinese sentence as one token, which
// made the bidirectional match for the applicable-scenario bonus always fail.
export function tokenizeFlexible(value: string): string[] {
  const norm = normalizeSearchText(value);
  const base = tokenize(norm);
  const result = new Set(base);
  const cjk = norm.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjk) {
    if (seg.length === 1) {
      result.add(seg);
      continue;
    }
    for (let i = 0; i + 2 <= seg.length; i++) result.add(seg.slice(i, i + 2));
  }
  return [...result];
}

// Generic-query marker (A4 fix): when the normalized query is composed of <=2 common two-char words => treat as
// weakly shared and down-weight (not block). An exact-name hit (+800) is unaffected and still wins activation.
function isGenericQuery(queryNorm: string): boolean {
  const words = queryNorm.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;
  return words.every((w) => GENERIC_TWO_CHAR_TERMS.has(w));
}

// Scenario-block coverage (F0-A, P1-B): shared 2-gram count / total query 2-gram count.
// Replaces the fixed +300; only grants a bonus when >=60% of the query's 2-grams also appear in the applicable-scenario text.
function scenarioCoverage(applicableText: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const textTerms = new Set(tokenizeFlexible(applicableText));
  const hits = queryTerms.filter((t) => textTerms.has(t)).length;
  return hits / queryTerms.length;
}

// Supports two scenario-section writing styles (applicable / not-applicable):
//  1) inline "label: content" (with ASCII or full-width colon)
//  2) markdown heading (e.g. "## 适用场景") up to the next "## " heading or EOF (standard SKILL.md style)
// The original implementation only supported style 1, so local Skills using the
// standard markdown heading style never received the applicable-scenario bonus.
//
// P1-C: a negative lookbehind on the Chinese negation character replaces the line-start anchor, preventing an
// applicable-scenario heading from being substring-matched inside a not-applicable-scenario heading, while still
// matching inline legal negative labels (e.g. a "disabled scenario: write weekly report" label).
// The heading pattern no longer adds a negative-ahead guard: the heading label is already the full name
// (applicable-scenario / not-applicable-scenario); a "## applicable-scenario" heading cannot grab a
// "## not-applicable-scenario" heading because the negation character sits between "## " and the label.
// Removing the negative-ahead guard lets the not-applicable heading be correctly extracted by its own heading
// (fixes A2: previously the guard excluded the negative block, disabling scenarioAdjustment's -1000 entirely).
export function extractScenarioBlock(desc: string, headingLabel: string, inlineLabels: string): string {
  const inlinePattern = new RegExp(
    `(?<!不)(?:${inlineLabels})[：:]\\s*([\\s\\S]*?)(?=\\n#{1,3}\\s|\\n\\s*(?:适用场景|适用|使用场景|不适用场景|不适用|禁用场景)[：:]|$)`,
    'i',
  );
  const m = desc.match(inlinePattern);
  if (m) return m[1];
  const headingPattern = new RegExp(`##\\s*${headingLabel}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const hm = desc.match(headingPattern);
  if (hm) return hm[1].replace(/^\s*[-*+]\s+/gm, '').trim();
  return '';
}

// Bidirectional + CJK 2-gram overlap matching. The strict (negative) mode ignores pure-ASCII generic words to avoid weak words like "skill" falsely triggering -1000.
function flexHits(text: string, queryNorm: string, queryTerms: string[], strict: boolean): boolean {
  const t = normalizeSearchText(text);
  if (queryNorm && (t.includes(queryNorm) || (!strict && queryNorm.includes(t)))) return true;
  const textTerms = tokenizeFlexible(text);
  return queryTerms.some((term) => {
    if (strict && /^[a-z0-9_-]+$/i.test(term)) return false;
    if (textTerms.includes(term)) return true;
    if (!strict && textTerms.some((tt) => term.includes(tt) && tt.length >= 2)) return true;
    return false;
  });
}

export function scenarioAdjustment(desc: string, queryNorm: string, queryTerms: string[]): number {
  const applicable = extractScenarioBlock(desc, '适用场景', '适用场景|适用|使用场景');
  const notApplicable = extractScenarioBlock(desc, '不适用场景', '不适用场景|不适用|禁用场景');
  // The -1000 negative only fires when the query hits a word unique to the
  // not-applicable block relative to the applicable block. Ambiguous words that
  // appear in both blocks must NOT trigger -1000; let the applicable bonus or
  // baseline score decide, to avoid killing valid requests.
  if (notApplicable) {
    const distinctTerms = applicable
      ? queryTerms.filter((term) => !flexHits(applicable, term, [term], false))
      : queryTerms;
    if (flexHits(notApplicable, queryNorm, distinctTerms, true)) return -1000;
  }
  // P1-B (F0-A): coverage-driven dynamic bonus, replacing the fixed +300.
  // Bonus only when coverage >= 0.6, round(coverage*100) capped at +100; avoids the weakest language unit (2-gram)
  // triggering the strongest-correlation (+300) criterion's semantic-granularity error (e.g. a generic finance query mis-activating finance-report Skills).
  if (applicable) {
    const coverage = scenarioCoverage(applicable, queryTerms);
    if (coverage >= 0.6) return Math.min(100, Math.round(coverage * 100));
  }
  return 0;
}

export function scoreLocalSkill(s: LocalSkillIndex, queryNorm: string, queryTerms: string[]): number {
  // Baseline purification: scoringText contains only description + applicable block, excluding notApplicable positive scoring
  // (fixes B10 mis-activation: words in the not-applicable block no longer contribute positive baseline score).
  const applicableFromInstructions = extractScenarioBlock(
    s.instructions ?? '',
    '适用场景',
    '适用场景|适用|使用场景',
  );
  const scoringText = [s.description, applicableFromInstructions].filter(Boolean).join('\n');
  const nameNorm = normalizeSearchText(s.name);
  const descNorm = normalizeSearchText(scoringText);
  // Unified adjudication pipeline (A2/A4 fix): exact-name whole-string hit +800 settles first and is unaffected by generic down-weighting;
  // the generic marker only down-weights, never blocks.
  const exactNameHit = !!queryNorm && nameNorm.includes(queryNorm);
  const generic = isGenericQuery(queryNorm);
  let score = 0;
  if (queryNorm) {
    if (exactNameHit) score += 800;
    // Exact-name hit still grants description whole-string +400 (strong signal); with generic query and no exact-name hit,
    // the 2-char query is already defended by length>=3, and 3-char generic queries also get no +400, preventing weak two-char
    // words from mis-activating via description whole-string match (R4②).
    if (descNorm.includes(queryNorm) && queryNorm.length >= 3 && !(generic && !exactNameHit)) score += 400;
  }
  for (const term of queryTerms) {
    if (nameNorm.includes(term)) score += 100;
    // Generic query with no exact-name hit: description token score halved (+40 => +20) to lower weak-word correlation (R4② down-weight).
    if (descNorm.includes(term)) score += (generic && !exactNameHit) ? 20 : 40;
  }
  // scenarioAdjustment: applicable-scenario dynamic bonus (capped +100) / not-applicable -1000, preserving R4 scoring factors.
  const scenarioAdj = scenarioAdjustment(`${s.description}\n${s.instructions ?? ''}`, queryNorm, queryTerms);
  // Generic query with no exact-name hit: applicable-scenario bonus capped at +30 (R4② prevents weak two-char words from
  // triggering +100 mis-activation via scenario coverage); the -1000 negative is unaffected and still suppresses. Exact-name hit
  // takes priority over down-weighting (A4 fix invariant).
  score += (generic && !exactNameHit && scenarioAdj > 0) ? Math.min(30, scenarioAdj) : scenarioAdj;
  return score;
}

export function selectImplicitSkill(query: string, skills: LocalSkillIndex[]): LocalSkillIndex | null {
  if (skills.length === 0) return null;
  const queryNorm = normalizeSearchText(query);
  // Generic gate (A4 fix): no longer pre-emptively returns null to block. When a query is composed of <=2 common two-char words,
  // scoreLocalSkill's isGenericQuery down-weights (rather than zeroes); an exact-name hit (+800) still wins activation, avoiding
  // killing genuinely applicable Skills.
  // Tokenize the user query sensibly before scoring: tokenizeFlexible (CJK 2-gram +
  // ASCII/digit as-is) avoids a whole Chinese sentence being treated as a single token
  // and then failing to match the scoring-visible fields.
  const queryTerms = tokenizeFlexible(queryNorm);
  const scored = skills
    .map((s) => ({ s, score: scoreLocalSkill(s, queryNorm, queryTerms) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  const overThreshold = top.score >= ACTIVATION_THRESHOLD;
  const leadOk = !second || top.score >= second.score + MIN_LEAD_GAP;
  const activated = overThreshold && leadOk;
  if (!activated) return null;
  return top.s;
}
