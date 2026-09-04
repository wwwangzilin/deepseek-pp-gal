import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contentSource = readFileSync('entrypoints/content.ts', 'utf8');
const mainWorldSource = readFileSync('entrypoints/main-world.content.ts', 'utf8');

describe('Content controller ownership contract', () => {
  it('keeps one explicit controller per migrated DOM capability', () => {
    for (const id of [
      'theme',
      'mutation-hub',
      'token-speed',
      'tool',
      'inline-agent',
      'multimodal',
      'export',
      'history',
      'project',
      'background',
      'pet',
    ]) {
      expect(contentSource).toMatch(new RegExp(`createDomCapability\\(\\s*[\"']${id}[\"']`));
    }
    expect(contentSource).not.toMatch(/createDomCapability\([\"']tool-inline-chat[\"']/);
    expect(contentSource).not.toMatch(/createDomCapability\([\"']multimodal-export[\"']/);
    expect(contentSource).not.toMatch(/createDomCapability\([\"']history-project-ux[\"']/);
  });

  it('routes token and tool refresh through one event-driven navigation owner', () => {
    expect(mainWorldSource).toContain('createMainWorldNavigationController({');
    expect(mainWorldSource).toMatch(/bridge\.post\(\{ type: [\"']NAVIGATION_CHANGED[\"'] \}\);/);
    expect(contentSource).toContain('case "NAVIGATION_CHANGED":');
    expect(contentSource).toContain('window.dispatchEvent(new Event("dpp:navigation"));');
    expect(contentSource).not.toContain('TOKEN_SPEED_ROUTE_CHECK_MS');
    expect(contentSource).not.toContain('TOOL_BLOCK_ROUTE_CHECK_MS');
    expect(contentSource).not.toContain('tokenSpeedRouteTimer');
    expect(contentSource).not.toContain('toolBlockRouteTimer');
  });

  it('waits for the shared navigation event before executing an unbound new-chat tool', () => {
    expect(contentSource).toMatch(/bindNewChatToolCallToBrowserSession\(\s*call,\s*grant\?\.chatSessionId/);
    expect(contentSource).toMatch(/from [\"']\.\/content\/tool-session-binding[\"'];/);
  });

  it('routes both worlds through the shared document lifecycle instead of entrypoint listeners', () => {
    expect(contentSource).toContain('replaceContentDocumentLifecycle({');
    expect(mainWorldSource).toContain('replaceContentDocumentLifecycle({');
    expect(contentSource).not.toMatch(/window\.addEventListener\([\"']pagehide[\"']/);
    expect(mainWorldSource).not.toMatch(/window\.addEventListener\([\"']pagehide[\"']/);
  });

  it('removes capability-owned transient UI and resolves permission waits during teardown', () => {
    expect(contentSource).toContain('finishActivePermissionRequest(false);');
    expect(contentSource).toMatch(/document\s*\.querySelectorAll\([\"']\.dpp-tool-block, \.dpp-artifact-results[\"']\)/);
    expect(contentSource).toContain('removeInlineAgentStyles();');
    expect(contentSource).toMatch(/document\s*\.querySelectorAll\([\"']\[data-dpp-transparent\][\"']\)/);
  });
});
