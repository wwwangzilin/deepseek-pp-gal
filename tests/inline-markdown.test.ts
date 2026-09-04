import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown } from '../core/inline-agent/markdown';

describe('renderInlineMarkdown', () => {
  it('does not create anchors for unsafe protocols', () => {
    const html = renderInlineMarkdown('[run](javascript:alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).toContain('run');
  });

  it('escapes safe href attributes', () => {
    const html = renderInlineMarkdown('[docs](https://example.com/?q=a&b=c)');

    expect(html).toContain('<a href="https://example.com/?q=a&amp;b=c"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders markdown tables before newline conversion', () => {
    const html = renderInlineMarkdown([
      '| Metric | Value |',
      '| --- | --- |',
      '| **Average price** | About **47k** CNY/sqm |',
    ].join('\n'));

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Metric</th>');
    expect(html).toContain('<td><strong>Average price</strong></td>');
    expect(html).toContain('<td>About <strong>47k</strong> CNY/sqm</td>');
    expect(html).not.toContain('| --- |');
  });

  it('does not parse markdown tables inside fenced code blocks', () => {
    const html = renderInlineMarkdown([
      '```',
      '| a | b |',
      '| --- | --- |',
      '```',
    ].join('\n'));

    expect(html).toContain('<pre><code>| a | b |');
    expect(html).not.toContain('<table>');
  });

  it('renders agent-mode lists and paragraphs as compact block elements', () => {
    // DeepSeek agent mode separates every list item / sentence with \n\n.
    // Blank lines must be structural separators (block spacing comes from CSS
    // margins), never a <br> stacked next to a block element — that renders
    // an empty row between every paragraph/list item (the "blank line between
    // every row" rendering bug).
    const html = renderInlineMarkdown([
      '现在我已经获取了足够的搜索结果。让我从这些结果中提炼出最重要的科技新闻。',
      '',
      '从搜索结果中，我可以看到当天有几个重大科技新闻：',
      '',
      '1. 远景科技集团的乌兰察布星河基地投产。',
      '',
      '2. 谷歌AI部门发生重大调整。',
      '',
      '3. 新华网报道了中国的一些科技进展。',
    ].join('\n'));

    expect(html).not.toContain('<br><br>');
    // Paragraphs are <p> blocks; blank lines produce no <br> at all.
    expect(html).not.toContain('<br>');
    expect(html).toContain('</p><p>从搜索结果中，我可以看到当天有几个重大科技新闻：</p>');
    // Ordered list rows wrap in one <ol> (native markdown semantics), with no
    // <br> between items.
    expect(html).toContain('<ol><li>远景科技集团的乌兰察布星河基地投产。</li><li>谷歌AI部门发生重大调整。</li><li>新华网报道了中国的一些科技进展。</li></ol>');
  });

  it('preserves intentional single line breaks inside fenced code blocks', () => {
    const html = renderInlineMarkdown([
      '```',
      'line one',
      '',
      'line two',
      '```',
    ].join('\n'));

    expect(html).toContain('<pre><code>line one\n\nline two\n</code></pre>');
    expect(html).not.toContain('<br><br>');
  });

  it('collapses blank lines when the model output uses CRLF line endings', () => {
    // \r\n\r\n must be collapsed just like \n\n — the \r characters must not
    // defeat the blank-line collapse and re-introduce blank rows.
    const html = renderInlineMarkdown([
      '第一行。',
      '',
      '第二行。',
      '',
      '第三行。',
    ].join('\r\n'));

    expect(html).not.toContain('<br><br>');
    expect(html).not.toContain('\r');
    expect(html).not.toContain('<br>');
    expect(html).toContain('<p>第一行。</p><p>第二行。</p><p>第三行。</p>');
  });

  it('renders agent-mode ATX headings with the correct level', () => {
    // DeepSeek agent-mode final answers use `####` sub-headings; the page's
    // own markdown renderer renders them as headings, so the inline agent
    // panel must match (Issue: agent panel blank-line rendering).
    const html = renderInlineMarkdown([
      '五、核心博弈：三大矛盾',
      '',
      '#### 1. 🟢 云计算超级周期 vs. 🔴 天量资本开支',
      '谷歌云同比增长82%，积压订单$5,140亿，营业利润率35.6%',
      '',
      '但资本开支翻倍至$2,000亿级别，自由现金流转负',
      '',
    ].join('\n'));

    expect(html).toContain('<h4>1. 🟢 云计算超级周期 vs. 🔴 天量资本开支</h4>');
    // Block elements are siblings — no <br> stacked on <h4> (that double line
    // break is the "blank line between every row" rendering bug).
    expect(html).toContain('</p><h4>1. 🟢 云计算超级周期 vs. 🔴 天量资本开支</h4>');
    expect(html).toContain('</h4><p>谷歌云同比增长82%');
    expect(html).not.toContain('#### 1.');
    expect(html).not.toContain('<br>');
  });

  it('renders ordered and unordered list items', () => {
    const html = renderInlineMarkdown([
      '要点：',
      '',
      '1. 第一点。',
      '2. 第二点。',
      '',
      '- 补充一。',
      '- 补充二。',
    ].join('\n'));

    expect(html).toContain('<li>第一点。</li>');
    expect(html).toContain('<li>第二点。</li>');
    expect(html).toContain('<li>补充一。</li>');
    expect(html).toContain('<li>补充二。</li>');
    expect(html).not.toContain('1. 第一点');
    expect(html).not.toContain('- 补充一');
  });

  it('renders blockquote lines', () => {
    const html = renderInlineMarkdown('> 引用内容。\n\n正文。');

    expect(html).toContain('<blockquote>引用内容。</blockquote>');
    expect(html).toContain('正文。');
  });

  it('renders 4-backtick fences and keeps 3-backtick runs as content', () => {
    // 4-backtick outer fences let the content contain standard ``` fences.
    // Code content is HTML-escaped and the fence language is preserved for
    // the agent console's incremental run support.
    const html = renderInlineMarkdown([
      '````html',
      '<div>partial</div>',
      '```',
      'inner',
      '```',
      '````',
    ].join('\n'));

    expect(html).toContain('<pre data-dpp-lang="html"><code>&lt;div&gt;partial&lt;/div&gt;\n```\ninner\n```\n</code></pre>');
    // No leftover raw fences.
    expect(html).not.toContain('````');
    expect(html).not.toContain('<table>');
  });

  it('auto-closes an unterminated trailing fence', () => {
    // Streaming cuts and 100k-clamped persisted answers can end mid-block; the
    // partial content renders as a code block instead of leaking backticks.
    const html = renderInlineMarkdown('```html\n<div>partial');

    expect(html).toContain('<pre data-dpp-lang="html"><code>&lt;div&gt;partial</code></pre>');
    expect(html).not.toContain('```');
  });

  it('keeps a lone trailing fence without content literal', () => {
    const html = renderInlineMarkdown('text\n```');

    expect(html).not.toContain('<pre>');
    expect(html).toContain('text');
  });
  it('recognizes hyphenated fence languages without nesting later blocks', () => {
    const html = renderInlineMarkdown([
      '```xychart-beta',
      'title First',
      'line [1, 2]',
      '```',
      '',
      'between',
      '',
      '```xychart-beta',
      'title Second',
      'bar [2, 1]',
      '```',
    ].join('\n'));

    expect(html.match(/<pre data-dpp-lang="xychart-beta">/g)).toHaveLength(2);
    expect(html).toContain('<p>between</p>');
    expect(html).not.toContain('```xychart-beta');
  });

  it('can omit closed and streaming native fences while preserving surrounding text', () => {
    const nativeLanguages = new Set(['html', 'xychart-beta']);
    const complete = renderInlineMarkdown([
      'before',
      '````HTML',
      '<div>native</div>',
      '```',
      'still code',
      '````',
      'after',
      '```js',
      'console.log(1)',
      '```',
    ].join('\n'), { omitFencedCodeLanguages: nativeLanguages });

    expect(complete).toContain('<p>before</p>');
    expect(complete).toContain('<p>after</p>');
    expect(complete).not.toContain('&lt;div&gt;native&lt;/div&gt;');
    expect(complete).not.toContain('still code');
    expect(complete).toContain('<pre data-dpp-lang="js"><code>console.log(1)\n</code></pre>');

    const streaming = renderInlineMarkdown(
      'before\n```xychart-beta\ntitle Partial\nline [1',
      { omitFencedCodeLanguages: nativeLanguages },
    );
    expect(streaming).toBe('<p>before</p>');
    expect(streaming).not.toContain('<pre');
  });

});
