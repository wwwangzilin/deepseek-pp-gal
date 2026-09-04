import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Content request augmentation boundary', () => {
  it('decodes the body before correlation state or privileged work begins', () => {
    const source = readFileSync('entrypoints/content.ts', 'utf8');
    const start = source.indexOf('async function handleAugmentRequestBody');
    const end = source.indexOf('\nasync function resolveProjectContextForRequestBody', start);
    const handler = source.slice(start, end).replace(/\s+/g, ' ');
    const routeIndex = handler.indexOf('isDeepSeekAugmentableWebRoute(data.route)');
    const decodeIndex = handler.indexOf('decodeAugmentableDeepSeekRequest');
    const passthroughIndex = handler.indexOf('if (!decodedRequest)');
    const replayScopeIndex = handler.indexOf('resolveRegenerateAuthorizationScopeForRequest');
    const correlationIndex = handler.indexOf('pendingToolAuthorizationCorrelations.begin');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    expect(decodeIndex).toBeGreaterThanOrEqual(0);
    expect(decodeIndex).toBeGreaterThan(routeIndex);
    expect(passthroughIndex).toBeGreaterThan(decodeIndex);
    expect(replayScopeIndex).toBeGreaterThan(passthroughIndex);
    expect(replayScopeIndex).toBeLessThan(correlationIndex);
    expect(handler.slice(passthroughIndex, correlationIndex)).toContain('postAugmentRequestPassthrough(id)');
    for (const privilegedOperation of [
      'pendingToolAuthorizationCorrelations.begin',
      'consumePendingMultimodalMediaForRequest',
      'createContentToolAuthorization',
      'resolveProjectContextForRequestBody',
      'type: "TOUCH_MEMORIES"',
    ]) {
      expect(handler.indexOf(privilegedOperation), privilegedOperation).toBeGreaterThan(decodeIndex);
    }
  });
});
