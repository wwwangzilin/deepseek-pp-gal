const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export interface InlineMarkdownRenderOptions {
  /**
   * Fenced-code languages that belong to another renderer and must therefore
   * remain absent from this HTML surface. The full source text is not mutated;
   * callers keep it separately for native delivery and persistence.
   */
  omitFencedCodeLanguages?: ReadonlySet<string>;
}

export function renderInlineMarkdown(
  text: string,
  options: InlineMarkdownRenderOptions = {},
): string {
  try {
    const codeBlocks: string[] = [];
    // Normalize CRLF/CR line endings to LF up front so the blank-line
    // handling below also works when the model output uses `\r\n`
    // (Issue: agent panel blank-line rendering).
    const normalizedText = text.replace(/\r\n?/g, '\n');
    let html = replaceFencedCodeBlocks(
      normalizedText,
      codeBlocks,
      options.omitFencedCodeLanguages,
    );
    html = escapeHtml(html);
    html = renderMarkdownTables(html);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const decodedHref = decodeBasicEntities(href.trim());
      if (!isSafeHref(decodedHref)) return `${label} (${href})`;
      return `<a href="${escapeAttribute(decodedHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    // Block-level layout: headings, lists, blockquotes, tables, code fences
    // and paragraphs are emitted as their own block elements (with list items
    // wrapped in <ul>/<ol> and paragraph text in <p>), so the visual result
    // matches the DeepSeek page's own markdown renderer: compact rows with no
    // blank line between every row. The previous all-`<br>` conversion put a
    // <br> next to every block element (<h4>/<li>), which stacked the block
    // element's own line break on top of the <br> and rendered an empty row
    // between every paragraph/list item (Issue: agent panel blank-line
    // rendering).
    html = renderBlockLayout(html);
    html = html.replace(/@@DPP_CODE_BLOCK_(\d+)@@/g, (_match, index) => codeBlocks[Number(index)] ?? '');

    return html;
  } catch {
    return escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').replace(/\n/g, '<br>');
  }
}

/**
 * Splits already-inline-rendered HTML into markdown block elements.
 *
 * - ATX headings (`#`..`######`) become `<h1>`..`<h6>`.
 * - Consecutive list-item lines (unordered `-`/`*` and ordered `N.`) are
 *   wrapped in a single `<ul>`/`<ol>`; a blank line between items does not
 *   split the list (agent-mode output separates every item with `\n\n`).
 * - `>` quote lines become `<blockquote>`.
 * - Table and fenced-code output is emitted as-is (already block-level).
 * - Everything else is grouped into `<p>` paragraphs, with single line
 *   breaks inside a paragraph kept as `<br>`.
 *
 * Blank lines are structural separators and never produce their own output:
 * block spacing comes from CSS margins, exactly like the page's native
 * markdown renderer.
 */
function renderBlockLayout(html: string): string {
  const lines = html.split('\n');
  const blocks: string[] = [];
  let i = 0;

  const isCodeBlockToken = (line: string): boolean => /^@@DPP_CODE_BLOCK_\d+@@$/.test(line);
  const isTableLine = (line: string): boolean => line.startsWith('<table>');
  const isBlockLine = (line: string): boolean =>
    isCodeBlockToken(line) ||
    isTableLine(line) ||
    /^(#{1,6}) /.test(line) ||
    /^[-*] /.test(line) ||
    /^\d+\. /.test(line) ||
    /^&gt; /.test(line);

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      // Blank line: block separator, no output (matches native paragraph
      // spacing driven by CSS margins).
      i += 1;
      continue;
    }

    // Fenced code block placeholder / table: already block-level HTML.
    if (isCodeBlockToken(trimmed) || isTableLine(trimmed)) {
      blocks.push(trimmed);
      i += 1;
      continue;
    }

    // ATX headings, longest first so `####` is not swallowed by `##`
    // (agent-mode output uses `####` sub-headings; the page's own markdown
    // renderer renders them as headings, so the inline agent panel must too).
    const heading = /^(#{1,6}) (.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${heading[2]}</h${level}>`);
      i += 1;
      continue;
    }

    // Blockquote lines, rendered like the page's markdown renderer.
    const quote = /^&gt; (.+)$/.exec(trimmed);
    if (quote) {
      blocks.push(`<blockquote>${quote[1]}</blockquote>`);
      i += 1;
      continue;
    }

    // List items: collect consecutive items (blank lines between items are
    // skipped so `1. a\n\n2. b` stays one compact list) and wrap them in a
    // single <ul>/<ol>, matching native markdown list semantics.
    const listMatch = /^([-*]|\d+\.) (.+)$/.exec(trimmed);
    if (listMatch) {
      const ordered = /^\d+\. /.test(trimmed);
      const tag = ordered ? 'ol' : 'ul';
      const items: string[] = [listMatch[2]];
      i += 1;
      while (i < lines.length) {
        const current = lines[i].trim();
        if (!current) {
          // Blank line: only keep collecting when the next non-blank line is
          // another item of the same list type.
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j += 1;
          const next = j < lines.length ? lines[j].trim() : '';
          const isSameItem = ordered ? /^\d+\. /.test(next) : /^[-*] /.test(next);
          if (!isSameItem) break;
          const item = /^([-*]|\d+\.) (.+)$/.exec(next);
          if (!item) break;
          items.push(item[2]);
          i = j + 1;
          continue;
        }
        const item = /^([-*]|\d+\.) (.+)$/.exec(current);
        if (!item) break;
        const isSameItem = ordered ? /^\d+\. /.test(current) : /^[-*] /.test(current);
        if (!isSameItem) break;
        items.push(item[2]);
        i += 1;
      }
      blocks.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`);
      continue;
    }

    // Plain paragraph: collect consecutive non-block lines; single line
    // breaks inside the paragraph stay as <br> (soft line breaks).
    const paragraph: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next || isBlockLine(next)) break;
      paragraph.push(next);
      i += 1;
    }
    blocks.push(`<p>${paragraph.join('<br>')}</p>`);
  }

  return blocks.join('');
}

/**
 * Replaces fenced code blocks with inert tokens before ordinary Markdown
 * rendering. A small line scanner is used instead of a regex back-reference so
 * language info strings such as `xychart-beta` and `c++` are recognized, and a
 * closing fence is legal only when its backtick run exactly matches the opener.
 *
 * An unterminated fence consumes the remainder of the text. This is deliberate
 * for streaming: ordinary code still renders as an auto-closed `<pre>`, while a
 * caller-omitted native deliverable stays hidden from the first streamed byte
 * and cannot flash as a plugin-owned grey code frame before its closing fence
 * arrives.
 */
function replaceFencedCodeBlocks(
  text: string,
  codeBlocks: string[],
  omitFencedCodeLanguages?: ReadonlySet<string>,
): string {
  const openerPattern = /^(`{3,})([^\n`]*)\n/gm;
  let output = '';
  let cursor = 0;
  let opener: RegExpExecArray | null;

  while ((opener = openerPattern.exec(text)) !== null) {
    const [openingLine, fence, infoString] = opener;
    const openingIndex = opener.index;
    const contentStart = openingIndex + openingLine.length;
    const closingPattern = new RegExp(`^${fence}[ \t]*$`, 'gm');
    closingPattern.lastIndex = contentStart;
    const closing = closingPattern.exec(text);
    const language = getFenceLanguage(infoString);
    const omit = Boolean(language && omitFencedCodeLanguages?.has(language));

    output += text.slice(cursor, openingIndex);

    if (!closing) {
      if (!omit) {
        output += createCodeBlockToken(text.slice(contentStart), language, codeBlocks);
      }
      cursor = text.length;
      break;
    }

    if (!omit) {
      output += createCodeBlockToken(
        text.slice(contentStart, closing.index),
        language,
        codeBlocks,
      );
    }
    cursor = closing.index + closing[0].length;
    openerPattern.lastIndex = cursor;
  }

  return output + text.slice(cursor);
}

function getFenceLanguage(infoString: string): string {
  return infoString.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

function createCodeBlockToken(
  code: string,
  language: string,
  codeBlocks: string[],
): string {
  const token = `@@DPP_CODE_BLOCK_${codeBlocks.length}@@`;
  const langAttr = language ? ` data-dpp-lang="${escapeAttribute(language)}"` : '';
  codeBlocks.push(`<pre${langAttr}><code>${escapeHtml(code)}</code></pre>`);
  return token;
}

function renderMarkdownTables(html: string): string {
  const lines = html.split('\n');
  const rendered: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const header = parseMarkdownTableRow(lines[i]);
    const separator = parseMarkdownTableRow(lines[i + 1] ?? '');
    if (!header || !separator || !separator.every(isMarkdownTableSeparatorCell)) {
      rendered.push(lines[i]);
      continue;
    }

    const rows: string[][] = [];
    i += 2;
    while (i < lines.length) {
      const row = parseMarkdownTableRow(lines[i]);
      if (!row) break;
      rows.push(normalizeTableRow(row, header.length));
      i++;
    }
    i--;

    const thead = `<thead><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>`;
    const tbody = rows.length > 0
      ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`
      : '';
    rendered.push(`<table>${thead}${tbody}</table>`);
  }

  return rendered.join('\n');
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;

  const normalized = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '');
  const cells = normalized.split('|').map((cell) => cell.trim());
  return cells.length >= 2 && cells.some((cell) => cell.length > 0) ? cells : null;
}

function isMarkdownTableSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function normalizeTableRow(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  return [...row, ...Array.from({ length: width - row.length }, () => '')];
}

function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value);
    return SAFE_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}
