import { describe, expect, it } from 'vitest';
import {
  consumeDeepSeekSseEvents,
  createDeepSeekStreamSummary,
  getDeepSeekFragmentState,
  parseSSEChunk,
  splitDeepSeekResponseText,
} from '../core/deepseek/stream-codec';

/**
 * Reasoning/thinking extraction from the DeepSeek web SSE stream. The stream
 * interleaves `THINK` fragments (reasoning) and `RESPONSE` fragments (answer)
 * over the same patch paths; these fixtures mirror real captured streams.
 */

function consume(text: string, options: { onReasoningChunk?: (r: string, full: string) => void } = {}) {
  const summary = createDeepSeekStreamSummary();
  const reasoningChunks: Array<{ delta: string; full: string }> = [];
  const textChunks: string[] = [];
  const appended = consumeDeepSeekSseEvents(parseSSEChunk(text), summary, {
    retainAssistantText: true,
    onReasoningChunk: (reasoning, fullReasoning) => {
      reasoningChunks.push({ delta: reasoning, full: fullReasoning });
      options.onReasoningChunk?.(reasoning, fullReasoning);
    },
  });
  // Reconstruct onTextChunk-style deltas from the returned appended text.
  let last = '';
  for (const chunk of appended) {
    textChunks.push(chunk);
    last = chunk;
  }
  void last;
  return { summary, appended, reasoningChunks, textChunks };
}

describe('DeepSeek web stream reasoning extraction', () => {
  it('separates THINK fragment content from RESPONSE fragment content', () => {
    // Real captured shape: full snapshot opens the THINK fragment, content
    // grows via `response/fragments/-1/content` APPEND + bare shorthand, then
    // a RESPONSE fragment is appended and the answer streams the same way.
    const sse = [
      'event: ready',
      'data: {"request_message_id":5,"response_message_id":6,"model_type":"default"}',
      '',
      'data: {"v":{"response":{"message_id":6,"parent_id":5,"model":"","role":"ASSISTANT","thinking_enabled":true,"status":"WIP","fragments":[{"id":2,"type":"THINK","content":"我们","elapsed_secs":null,"references":[],"stage_id":1}],"conversation_mode":"DEFAULT"}}}',
      '',
      'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"使用"}',
      '',
      'data: {"v":"经典的"}',
      '',
      'data: {"p":"response/fragments/-1/elapsed_secs","o":"SET","v":1.4}',
      '',
      'data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"设","references":[],"stage_id":1}]}',
      '',
      'data: {"p":"response/fragments/-1/content","v":"鸡"}',
      '',
      'data: {"v":"有23只"}',
      '',
      'data: {"p":"response","o":"BATCH","v":[{"p":"quasi_status","v":"FINISHED"}]}',
      '',
      'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
    ].join('\n\n');

    const { summary, reasoningChunks } = consume(sse);

    expect(summary.assistantText).toBe('设鸡有23只');
    expect(summary.assistantReasoningText).toBe('我们使用经典的');
    expect(reasoningChunks.map((c) => c.delta)).toEqual(['我们', '使用', '经典的']);
    expect(reasoningChunks.at(-1)?.full).toBe('我们使用经典的');
    expect(summary.finished).toBe(true);
  });

  it('routes explicit reasoning_content patch paths to the reasoning channel', () => {
    const sse = [
      'data: {"p":"response/reasoning_content","o":"APPEND","v":"step one"}',
      '',
      'data: {"p":"response/fragments","o":"APPEND","v":[{"id":4,"type":"RESPONSE","content":"答","references":[],"stage_id":1}]}',
      '',
      'data: {"v":"案"}',
      '',
      'data: {"p":"thinking_content","o":"APPEND","v":" tail"}',
    ].join('\n\n');

    const { summary } = consume(sse);
    expect(summary.assistantText).toBe('答案');
    expect(summary.assistantReasoningText).toBe('step one tail');
  });

  it('keeps pre-fragment shorthand as answer text (non-thinking streams)', () => {
    const sse = [
      'data: {"v":"Hello "}',
      '',
      'data: {"v":"world"}',
    ].join('\n\n');

    const { summary, reasoningChunks } = consume(sse);
    expect(summary.assistantText).toBe('Hello world');
    expect(summary.assistantReasoningText).toBe('');
    expect(reasoningChunks).toEqual([]);
  });

  it('tracks the fragment type across a fresh summary per stream', () => {
    // Two separate streams must not share fragment state.
    const sseA = [
      'data: {"p":"response/fragments","o":"APPEND","v":[{"id":1,"type":"THINK","content":"r1"}]}',
      '',
      'data: {"v":"r2"}',
    ].join('\n\n');
    const sseB = [
      'data: {"p":"response/fragments","o":"APPEND","v":[{"id":5,"type":"RESPONSE","content":"a1"}]}',
      '',
      'data: {"v":"a2"}',
    ].join('\n\n');

    const a = consume(sseA);
    const b = consume(sseB);
    expect(a.summary.assistantReasoningText).toBe('r1r2');
    expect(a.summary.assistantText).toBe('');
    expect(b.summary.assistantReasoningText).toBe('');
    expect(b.summary.assistantText).toBe('a1a2');
  });

  it('exposes the fragment state tracker for direct split usage', () => {
    const summary = createDeepSeekStreamSummary();
    const state = getDeepSeekFragmentState(summary);
    const first = splitDeepSeekResponseText(
      { p: 'response/fragments', o: 'APPEND', v: [{ type: 'THINK', content: 'r' }] },
      state,
    );
    const second = splitDeepSeekResponseText({ v: 'more' }, state);
    const third = splitDeepSeekResponseText(
      { p: 'response/fragments', o: 'APPEND', v: [{ type: 'RESPONSE', content: 'a' }] },
      state,
    );
    const fourth = splitDeepSeekResponseText({ v: 'answer' }, state);
    expect(first).toEqual({ text: null, reasoning: 'r' });
    expect(second).toEqual({ text: null, reasoning: 'more' });
    expect(third).toEqual({ text: 'a', reasoning: null });
    expect(fourth).toEqual({ text: 'answer', reasoning: null });
  });

  it('consumes the initial content of EVERY fragment in a multi-fragment APPEND', () => {
    // A single APPEND event that carries a final THINK fragment and an
    // opening RESPONSE fragment must not drop the earlier fragment's initial
    // content (the previous implementation only consumed the last fragment).
    const summary = createDeepSeekStreamSummary();
    const state = getDeepSeekFragmentState(summary);
    const split = splitDeepSeekResponseText(
      {
        p: 'response/fragments',
        o: 'APPEND',
        v: [
          { id: 1, type: 'THINK', content: '前段思考', references: [], stage_id: 1 },
          { id: 2, type: 'RESPONSE', content: '答案开头', references: [], stage_id: 1 },
        ],
      },
      state,
    );
    expect(split).toEqual({ text: '答案开头', reasoning: '前段思考' });
  });

  it('consumes every fragment initial content in the first snapshot too', () => {
    const summary = createDeepSeekStreamSummary();
    const state = getDeepSeekFragmentState(summary);
    const split = splitDeepSeekResponseText(
      {
        v: {
          response: {
            fragments: [
              { id: 1, type: 'THINK', content: 'r1' },
              { id: 2, type: 'RESPONSE', content: 'a1' },
            ],
          },
        },
      },
      state,
    );
    expect(split).toEqual({ text: 'a1', reasoning: 'r1' });
    // Later snapshots stay cumulative: no re-consumption.
    const again = splitDeepSeekResponseText(
      {
        v: {
          response: {
            fragments: [
              { id: 1, type: 'THINK', content: 'r1' },
              { id: 2, type: 'RESPONSE', content: 'a1' },
            ],
          },
        },
      },
      state,
    );
    expect(again).toEqual({ text: null, reasoning: null });
  });
});
