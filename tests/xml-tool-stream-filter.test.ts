import { describe, expect, it } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import { XmlToolStreamFilter } from '../core/interceptor/fetch-hook';
import {
  createDeepSeekSseFrameDecoder,
  extractResponseTextFromParsed,
  parseSSEChunk,
  parseSSEData,
} from '../core/deepseek/stream-codec';

describe('XmlToolStreamFilter', () => {
  it('strips whitespace-padded artifact tags with large canvas HTML across SSE events', () => {
    const html = [
      '<!doctype html><html><body><canvas id="stage"></canvas>',
      '<script>',
      'const ctx = document.getElementById("stage").getContext("2d");'.repeat(3000),
      '</script></body></html>',
    ].join('');
    const payload = JSON.stringify({
      filename: 'canvas-design.html',
      content: html,
      language: 'html',
      previewMode: 'html',
    });

    const output = runFilter([
      sseText('Intro < artifact'),
      sseText('_create >' + payload.slice(0, 10_000)),
      sseText(payload.slice(10_000, 80_000)),
      sseText(payload.slice(80_000) + '</ artifact'),
      sseText('_create > done'),
    ]);

    expect(output).not.toContain('artifact_create');
    expect(output).not.toContain('<canvas');
    expect(output).not.toContain('getContext');
    expect(readVisibleText(output)).toBe('Intro  done');
  });

  it('keeps response fragment structure while suppressing a streamed artifact body', () => {
    const payload = JSON.stringify({
      filename: 'fragment-demo.html',
      content: '<!doctype html><canvas></canvas>',
      language: 'html',
    });

    const output = runFilter([
      sseFragment('Before < artifact'),
      sseFragment('_create >' + payload),
      sseFragment('</ artifact_create > after'),
    ]);

    expect(output).toContain('"p":"response/fragments"');
    expect(output).not.toContain('fragment-demo.html');
    expect(output).not.toContain('<canvas');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('keeps an unclosed oversized artifact body out of the visible stream at EOF', () => {
    const output = runFilter([
      sseText('Before <artifact_create>'),
      sseText('{"filename":"demo.pptx","content":"' + 'A'.repeat(250_000)),
    ]);

    expect(output).not.toContain('artifact_create');
    expect(output).not.toContain('AAAA');
    expect(readVisibleText(output)).toBe('Before ');
  });

  it('buffers partial SSE events before parsing full-text stream state', () => {
    const parsed: unknown[] = [];
    const decoder = createDeepSeekSseFrameDecoder();
    const event = sseText('Split event text');

    parsed.push(...decoder.push(event.slice(0, 8)).map((frame) => frame.parsed));
    parsed.push(...decoder.push(event.slice(8, 21)).map((frame) => frame.parsed));
    expect(parsed).toEqual([]);

    parsed.push(...decoder.push(event.slice(21)).map((frame) => frame.parsed));
    expect(parsed).toHaveLength(1);
    expect(extractResponseTextFromParsed(parsed[0])).toBe('Split event text');
  });

  it('collapses blank lines around a stripped tool call instead of stacking \\n\\n\\n\\n', () => {
    // DeepSeek agent-mode output separates tool calls with blank lines on
    // both sides: `前文\n\n<tool_call>...</tool_call>\n\n后文`. Stripping only
    // the XML tags must leave a single paragraph break (`前文\n\n后文`), not
    // `前文\n\n\n\n后文` (the "blank line between every row" rendering bug on
    // the DeepSeek page).
    const payload = JSON.stringify({
      filename: 'blank-line.html',
      content: '<p>hi</p>',
      language: 'html',
    });
    const output = runFilter([
      sseText('现在我已经获取了足够的搜索结果。\n\n'),
      sseText('<artifact_create>'),
      sseText(payload),
      sseText('</artifact_create>\n\n'),
      sseText('从搜索结果中，我可以看到当天有几个重大科技新闻：\n\n1. 远景科技集团\n\n2. 谷歌AI部门'),
    ]);

    expect(output).not.toContain('artifact_create');
    expect(output).not.toContain('<p>hi</p>');
    expect(readVisibleText(output)).toBe(
      '现在我已经获取了足够的搜索结果。\n\n' +
      '从搜索结果中，我可以看到当天有几个重大科技新闻：\n\n' +
      '1. 远景科技集团\n\n2. 谷歌AI部门',
    );
  });

  it('collapses blank lines between consecutive stripped tool calls', () => {
    const payload = JSON.stringify({ filename: 'two.html', content: '<p>x</p>', language: 'html' });
    const output = runFilter([
      sseText('第一段。\n\n<artifact_create>'),
      sseText(payload),
      sseText('</artifact_create>\n\n<artifact_create>'),
      sseText(payload),
      sseText('</artifact_create>\n\n第二段。\n\n第三段。'),
    ]);

    expect(readVisibleText(output)).toBe('第一段。\n\n第二段。\n\n第三段。');
    expect(readVisibleText(output)).not.toContain('\n\n\n');
  });

  it('keeps a single blank line when only one side of the tool call is blank', () => {
    const payload = JSON.stringify({ filename: 'one-side.html', content: '<p>x</p>', language: 'html' });
    const output = runFilter([
      sseText('前文。\n\n<artifact_create>'),
      sseText(payload),
      sseText('</artifact_create>后文。'),
    ]);

    expect(readVisibleText(output)).toBe('前文。\n\n后文。');
  });

  it('collapses excess blank lines already flushed before a tool call opens', () => {
    // Agent-mode output often wraps tool calls in `\n\n\n`. When the text
    // before the open tag was already flushed to a previous SSE frame, the
    // trailing blank lines must still collapse to a single paragraph break.
    const payload = JSON.stringify({ filename: 'flush.html', content: '<p>x</p>', language: 'html' });
    const output = runFilter([
      sseText('最后一步的思考。\n\n\n'),
      sseText('<artifact_create>'),
      sseText(payload),
      sseText('</artifact_create>\n\n'),
      sseText('最终答案：\n\n1. 第一点。\n\n2. 第二点。'),
    ]);

    const visible = readVisibleText(output);
    expect(visible).toBe(
      '最后一步的思考。\n\n' +
      '最终答案：\n\n1. 第一点。\n\n2. 第二点。',
    );
    expect(visible).not.toContain('\n\n\n');
  });

  it('collapses excess blank lines in plain text while preserving fenced code blocks', () => {
    const output = runFilter([
      sseText('第一段。\n\n\n第二段。\n\n\n```\nline one\n\n\nline two\n```\n\n\n结束。'),
    ]);

    const visible = readVisibleText(output);
    expect(visible).toContain('第一段。\n\n第二段。');
    expect(visible).toContain('```\nline one\n\n\nline two\n```');
    expect(visible).toContain('```\n\n结束。');
    expect(visible).not.toContain('第二段。\n\n\n```');
  });

  it('keeps fenced-code blank lines intact when the fence spans SSE frames', () => {
    // The opening fence arrives in frame 1; frame 2 carries the interior
    // blank-line run (PEP8-style two blank lines between top-level defs).
    // Frame-local fence tracking collapsed these interior blank lines; the
    // cross-frame fence state must preserve them.
    const output = runFilter([
      sseText('代码示例：\n```python\ndef a():\n    pass'),
      sseText('\n\n\ndef b():\n    pass\n```\n结束。'),
    ]);

    const visible = readVisibleText(output);
    expect(visible).toContain('def a():\n    pass\n\n\ndef b():\n    pass');
    expect(visible).not.toContain('def a():\n    pass\n\ndef b()');
  });

  it('keeps a frame that is nothing but blank lines intact inside an open fence', () => {
    const output = runFilter([
      sseText('```html\n<section>'),
      sseText('\n\n\n'),
      sseText('</section>\n```'),
    ]);

    expect(readVisibleText(output)).toContain('<section>\n\n\n</section>');
  });

  it('keeps collapsing plain prose across frames outside fences', () => {
    // The cross-frame fence state must not disable the intended prose
    // collapse: a `\n\n\n` run in a later frame, with no fence open, still
    // collapses to a single paragraph break.
    const output = runFilter([
      sseText('第一段。'),
      sseText('\n\n\n第二段。\n\n\n第三段。'),
    ]);

    const visible = readVisibleText(output);
    expect(visible).toBe('第一段。\n\n第二段。\n\n第三段。');
    expect(visible).not.toContain('\n\n\n');
  });

  it('closes the fence state when the closing fence arrives in a later frame', () => {
    // After the closing fence, a later `\n\n\n` prose run must collapse again.
    const output = runFilter([
      sseText('```\ncode\n\n\ninside\n```'),
      sseText('\n\n\n后续段落。'),
    ]);

    const visible = readVisibleText(output);
    expect(visible).toContain('```\ncode\n\n\ninside\n```');
    expect(visible).toContain('```\n\n后续段落。');
    expect(visible).not.toContain('inside\n```\n\n\n后续段落。');
  });
});

function runFilter(chunks: string[]): string {
  const filter = new XmlToolStreamFilter(createArtifactToolDescriptors('en'));
  const frameDecoder = createDeepSeekSseFrameDecoder();
  const decoder = new TextDecoder();
  const output: string[] = [];
  const controller = {
    enqueue(data: Uint8Array) {
      output.push(decoder.decode(data));
    },
  } as ReadableStreamDefaultController<Uint8Array>;

  for (const chunk of chunks) {
    filter.processFrames(frameDecoder.push(chunk), controller);
  }
  filter.processFrames(frameDecoder.finish(), controller);
  filter.flush(controller);
  return output.join('');
}

function sseText(text: string): string {
  return `data: ${JSON.stringify({ p: 'response/content', o: 'APPEND', v: text })}\n\n`;
}

function sseFragment(text: string): string {
  return `data: ${JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ content: text }] })}\n\n`;
}

function readVisibleText(output: string): string {
  return parseSSEChunk(output)
    .map((event) => parseSSEData(event.data))
    .map((parsed) => extractResponseTextFromParsed(parsed))
    .filter((text): text is string => text !== null)
    .join('');
}
