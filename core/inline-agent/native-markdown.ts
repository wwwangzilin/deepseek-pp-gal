const NATIVE_MERMAID_SHORTHAND_LANGUAGES = new Set(["xychart", "xychart-beta"]);

/**
 * Canonicalizes Mermaid xychart shorthand fences for DeepSeek's native
 * history renderer.
 *
 * DeepSeek dispatches diagram cards from the `mermaid` info string, while the
 * inline-agent prompt deliberately permits the friendlier `xychart-beta`
 * shorthand. Translate only that fence at the stored RESPONSE boundary:
 *
 *   ```xychart-beta       ```mermaid
 *   title "..."     ->   xychart-beta
 *   ```                   title "..."
 *                         ```
 *
 * All other markdown bytes, including HTML fences and nested backticks inside
 * non-chart code blocks, remain byte-for-byte unchanged.
 */
export function normalizeInlineAgentNativeMarkdown(markdown: string): string {
  const openerPattern = /^( {0,3})(`{3,})([^\r\n`]*)\r?\n/gm;
  let output = "";
  let cursor = 0;
  let opener: RegExpExecArray | null;

  while ((opener = openerPattern.exec(markdown)) !== null) {
    const [openingLine, indentation, fence, infoString] = opener;
    const openingIndex = opener.index;
    const contentStart = openingIndex + openingLine.length;
    const closingPattern = new RegExp(
      `^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r)?$`,
      "gm",
    );
    closingPattern.lastIndex = contentStart;
    const closing = closingPattern.exec(markdown);
    const blockEnd = closing
      ? closing.index + closing[0].length
      : markdown.length;
    const language = infoString.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";

    output += markdown.slice(cursor, openingIndex);
    if (!NATIVE_MERMAID_SHORTHAND_LANGUAGES.has(language)) {
      output += markdown.slice(openingIndex, blockEnd);
    } else {
      const lineEnding = openingLine.endsWith("\r\n") ? "\r\n" : "\n";
      const bodyEnd = closing?.index ?? markdown.length;
      const body = markdown.slice(contentStart, bodyEnd);
      let canonicalBody: string;
      if (/^\s*xychart-beta(?:\s|$)/i.test(body)) {
        canonicalBody = body;
      } else if (/^\s*xychart(?=[ \t]*(?:\r?\n|$))/i.test(body)) {
        // Avoid producing two grammar directives for the common combination:
        // ` ```xychart-beta` followed by a legacy `xychart` body directive.
        canonicalBody = body.replace(
          /^(\s*)xychart(?=[ \t]*(?:\r?\n|$))/i,
          "$1xychart-beta",
        );
      } else {
        canonicalBody = `xychart-beta${lineEnding}${body}`;
      }
      output += `${indentation}${fence}mermaid${lineEnding}${canonicalBody}`;
      if (closing) output += markdown.slice(closing.index, blockEnd);
    }

    cursor = blockEnd;
    openerPattern.lastIndex = cursor;
    if (!closing) break;
  }

  return output + markdown.slice(cursor);
}
