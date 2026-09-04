import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('regenerate request authorization boundary', () => {
  const source = readFileSync('entrypoints/content.ts', 'utf8');

  it('replays only an exact receiver-owned descriptor scope without changing the wire body', () => {
    const handlerStart = source.indexOf('async function handleAugmentRequestBody');
    const handlerEnd = source.indexOf('\nasync function resolveProjectContextForRequestBody', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const regenerateStart = handler.search(/if \(decodedRequest\.route === ['"]regenerate['"]\)/);
    const promptStart = handler.indexOf('const decodedBody = decodedRequest.body', regenerateStart);
    const regenerateBranch = handler.slice(regenerateStart, promptStart);

    expect(regenerateStart).toBeGreaterThanOrEqual(0);
    expect(promptStart).toBeGreaterThan(regenerateStart);
    expect(regenerateBranch).toContain('descriptorIds: scope.descriptorIds');
    expect(regenerateBranch).toContain('localSkillDir: scope.activeLocalSkillDir');
    expect(regenerateBranch).toContain('body: data.body');
    expect(regenerateBranch).toContain('toolDescriptors: authorization.descriptors');
    expect(regenerateBranch).not.toContain('toolIntent:');
  });

  it('recovers new-chat and pre-upgrade response evidence without expanding to the current catalog', () => {
    const rememberStart = source.indexOf('function rememberRegenerateAuthorizationScope');
    const rememberEnd = source.indexOf('\nasync function resolveRegenerateAuthorizationScopeForRequest', rememberStart);
    const remember = source.slice(rememberStart, rememberEnd);
    const recoveryStart = rememberEnd;
    const recoveryEnd = source.indexOf('\nfunction createRegeneratePromptOptionsFromRequest', recoveryStart);
    const recovery = source.slice(recoveryStart, recoveryEnd);

    expect(remember).toContain('authorization.chatSessionId ?? getCurrentChatSessionId()');
    expect(recovery).toContain('readPersistedToolExecutionBlocks()');
    expect(recovery).toContain('resolvePersistedRegenerateAuthorizationEvidence(');
    expect(recovery).not.toContain('currentToolDescriptors');
    expect(recovery).not.toContain('toolIntent:');
  });

  it('persists the exact live descriptor scope for later page reloads', () => {
    const persistStart = source.indexOf('async function persistToolBlockSession');
    const persistEnd = source.indexOf('\nasync function restorePersistedToolBlocks', persistStart);
    const persist = source.slice(persistStart, persistEnd);

    expect(persist).toContain('REGENERATE_AUTHORIZATION_METADATA_KEY');
    expect(persist).toContain('createPersistedRegenerateAuthorizationMetadata(regenerateScope)');
  });

  it('captures the response scope before terminal cleanup can close its grant', () => {
    const responseCase = source.search(/case ['"]RESPONSE_COMPLETE['"]/);
    const terminalOffset = source.slice(responseCase).search(/case ['"]REQUEST_TERMINAL['"]/);
    const terminalCase = terminalOffset < 0 ? -1 : responseCase + terminalOffset;
    const responseHandler = source.slice(responseCase, terminalCase);
    const rememberIndex = responseHandler.indexOf('rememberRegenerateAuthorizationScope(complete)');
    const pendingExecutionsIndex = responseHandler.indexOf('await waitForPendingToolExecutions');
    const continuationIndex = responseHandler.indexOf('startInlineAgentIfNeeded(complete');

    expect(responseCase).toBeGreaterThanOrEqual(0);
    expect(terminalCase).toBeGreaterThan(responseCase);
    expect(rememberIndex).toBeGreaterThanOrEqual(0);
    expect(pendingExecutionsIndex).toBeGreaterThan(rememberIndex);
    expect(continuationIndex).toBeGreaterThan(rememberIndex);
    const tokenSpeedOffset = source.slice(terminalCase).search(/case ['"]RESPONSE_TOKEN_SPEED['"]/);
    const tokenSpeedCase = tokenSpeedOffset < 0 ? source.length : terminalCase + tokenSpeedOffset;
    expect(source.slice(terminalCase, tokenSpeedCase))
      .toContain('closeContentToolAuthorization(requestId)');
  });
});
