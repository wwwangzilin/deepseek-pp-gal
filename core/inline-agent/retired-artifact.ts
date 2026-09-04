import { findFirstXmlToolTag } from '../tool/xml-tags';

/**
 * Retired artifact protocol (Issue: drop the plugin artifact extension).
 *
 * The model-facing artifact tools (`artifact_create` / `artifact_bundle_create`)
 * are retired: the model must deliver files as plain markdown fences (```html,
 * ```xychart-beta, mermaid…). The stored RESPONSE boundary normalizes xychart
 * shorthand to Mermaid before DeepSeek's native history renderer takes over.
 * Sessions that still carry the old tool guidance (in-flight context, learned
 * behavior) may keep emitting `<artifact_create>{"filename":…}</artifact_create>`
 * XML blocks. Those blocks are a retired INTERNAL CONTROL PROTOCOL — the loop
 * cannot execute them and the display layer must not show raw protocol bytes.
 *
 * {@link stripRetiredArtifactProtocolBlocks} removes exactly those blocks from
 * a text (complete blocks and unclosed trailing blocks from a clamped/truncated
 * stream). It is a pure, tag-name-scoped operation: it only ever removes
 * `<artifact_create>` / `<artifact_bundle_create>` XML — fenced code blocks,
 * plain text, and every other tool tag pass through byte-for-byte. The
 * "no silent swallow" contract lives in the loop instead: a turn whose visible
 * tail still promises a deliverable (nothing renderable followed the stripped
 * protocol block) triggers the released nudge path, so the model re-delivers in
 * native form instead of the run ending on an empty promise.
 */
export const RETIRED_ARTIFACT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'artifact_create',
  'artifact_bundle_create',
]);

/**
 * Removes every retired artifact-protocol XML block from `text`. Complete
 * blocks (`<artifact_create>…</artifact_create>`, including the legacy DSML
 * wrapper shape handled by the shared XML tag scanner) are dropped entirely;
 * an open tag without its close tag (stream cut, persisted clamp) drops the
 * remainder of the text — that remainder is protocol body, not user content.
 *
 * The strip is fence-aware: inside a fenced code block an artifact tag is
 * model-visible example content (a model showing the retired syntax in a
 * ```fence```), never an executable control protocol, so those tags pass
 * through byte-for-byte and an unclosed tag there never swallows the rest of
 * the answer. Returns the input unchanged when no artifact tag is present.
 */
export function stripRetiredArtifactProtocolBlocks(text: string): string {
  if (!text) return text;

  let output = '';
  let cursor = 0;
  let inFence = false;
  while (cursor < text.length) {
    const fenceIndex = text.indexOf('```', cursor);
    const open = findFirstXmlToolTag(text, RETIRED_ARTIFACT_TOOL_NAMES, {
      closing: false,
      fromIndex: cursor,
    });
    if (!open) {
      // No more artifact tags: copy the rest (fence markers included).
      output += text.slice(cursor);
      break;
    }
    if (fenceIndex !== -1 && fenceIndex < open.index) {
      // The next fence marker precedes the artifact tag: copy up to and
      // including the marker, toggle the fence state, and keep scanning.
      output += text.slice(cursor, fenceIndex + 3);
      inFence = !inFence;
      cursor = fenceIndex + 3;
      continue;
    }
    if (inFence) {
      // Inside a fenced code block the tag is example content: copy the tag
      // itself and continue scanning from after it.
      output += text.slice(cursor, open.endIndex);
      cursor = open.endIndex;
      continue;
    }
    // Outside any fence: drop the complete block — or, for an unclosed
    // trailing block, the remainder of the text.
    output += text.slice(cursor, open.index);
    const close = findFirstXmlToolTag(text, new Set([open.name]), {
      closing: true,
      fromIndex: open.endIndex,
    });
    if (!close) {
      // Unclosed trailing block: a clamped/truncated stream cut mid-protocol.
      // The remainder belongs to the protocol body, not to user content.
      cursor = text.length;
      break;
    }
    // The whole block is removed — nothing of the protocol may surface.
    cursor = close.endIndex;
  }
  return output;
}
