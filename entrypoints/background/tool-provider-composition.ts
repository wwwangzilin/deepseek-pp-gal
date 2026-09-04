import {
  deleteMemory,
  getMemoryById,
  saveMemory,
  updateMemory,
} from '../../core/memory/store';
import { getProjectForConversation } from '../../core/project';
import {
  executeMcpToolCall,
  getMcpToolDescriptors,
  refreshMcpServerDiscovery,
} from '../../core/mcp/discovery';
import { getAllMcpServers } from '../../core/mcp/store';
import type { Memory, NewMemory } from '../../core/types';
import {
  ARTIFACT_TOOL_PROVIDER,
  createArtifactToolDescriptors,
  executeArtifactToolCall,
} from '../../core/artifact';
import {
  SKILL_CREATOR_TOOL_PROVIDER,
  createSkillCreatorToolDescriptors,
  executeSkillCreatorToolCall,
} from '../../core/skill/creator-tool';
import {
  MEMORY_IMPORT_TOOL_PROVIDER,
  createMemoryImportToolDescriptors,
  executeMemoryImportToolCall,
} from '../../core/memory/import-tool';
import {
  BROWSER_CONTROL_PROVIDER,
  createBrowserControlToolDescriptors,
  executeBrowserControlToolCall,
  shouldExposeBrowserControlTools,
} from '../../core/browser-control/tool';
import {
  createMemoryToolDescriptors,
  executeMemoryToolCall,
  MEMORY_TOOL_PROVIDER,
  type MemoryToolRuntime,
} from '../../core/tool/memory';
import {
  createWebSearchToolDescriptors,
  executeWebSearchToolCall,
  WEB_SEARCH_TOOL_PROVIDER,
} from '../../core/tool/web-search';
import { getWebToolSettings } from '../../core/tool/web-settings';
import {
  MCP_CAPABILITY_TOOL_PROVIDER,
  createMcpCapabilityToolDescriptors,
  disambiguateMcpCapabilityToolDescriptors,
  executeMcpCapabilityToolCall,
} from '../../core/mcp/capability-tools';
import {
  ToolProviderRegistry,
  type RuntimeToolProvider,
  type ToolProviderDescriptorContext,
  type ToolProviderExecutionContext,
} from '../../core/tool/provider-registry';
import type { ToolCall, ToolDescriptor, ToolResult } from '../../core/tool/types';

const memoryRuntime: MemoryToolRuntime = {
  async saveMemory(input: NewMemory) {
    const id = await saveMemory(input);
    return { id };
  },
  async getMemoryById(id: number) {
    return (await getMemoryById(id)) ?? null;
  },
  async updateMemory(memory: Memory) {
    await updateMemory(memory);
  },
  async deleteMemory(id: number) {
    await deleteMemory(id);
  },
};

export function createProductionToolProviderRegistry(): ToolProviderRegistry {
  return new ToolProviderRegistry([
    createLocalProvider(
      MEMORY_TOOL_PROVIDER.id,
      ({ locale }) => createMemoryToolDescriptors(locale),
      async (call, _descriptor, { locale }) => executeMemoryToolCall(
        await createMemoryRuntime(call),
        call,
        locale,
      ),
    ),
    createLocalProvider(
      WEB_SEARCH_TOOL_PROVIDER.id,
      async ({ locale }) => {
        const settings = await getWebToolSettings();
        return createWebSearchToolDescriptors(locale).filter(
          (descriptor) => settings[descriptor.name as keyof typeof settings] !== false,
        );
      },
      (call, _descriptor, { locale, signal }) => executeWebSearchToolCall(call, locale, { signal }),
    ),
    createLocalProvider(
      ARTIFACT_TOOL_PROVIDER.id,
      ({ locale }) => createArtifactToolDescriptors(locale),
      (call, _descriptor, { locale }) => executeArtifactToolCall(call, locale),
    ),
    createLocalProvider(
      SKILL_CREATOR_TOOL_PROVIDER.id,
      ({ locale }) => createSkillCreatorToolDescriptors(locale),
      (call, _descriptor, { locale }) => executeSkillCreatorToolCall(call, locale),
    ),
    createLocalProvider(
      MEMORY_IMPORT_TOOL_PROVIDER.id,
      ({ locale }) => createMemoryImportToolDescriptors(locale),
      (call, _descriptor, { locale }) => executeMemoryImportToolCall(call, locale),
    ),
    createLocalProvider(
      BROWSER_CONTROL_PROVIDER.id,
      async ({ locale }) => {
        if (!await shouldExposeBrowserControlTools()) return [];
        return createBrowserControlToolDescriptors(locale);
      },
      (call, _descriptor, { locale }) => executeBrowserControlToolCall(call, locale),
    ),
    createMcpCapabilityProvider(),
    createMcpProvider(),
  ]);
}

function createLocalProvider(
  id: string,
  listTools: (context: ToolProviderDescriptorContext) => ToolDescriptor[] | Promise<ToolDescriptor[]>,
  execute: (
    call: ToolCall,
    authorizedDescriptor: ToolDescriptor,
    context: ToolProviderExecutionContext,
  ) => Promise<ToolResult>,
): RuntimeToolProvider {
  return {
    registration: { kind: 'local', id },
    async listTools(context) {
      return listTools(context);
    },
    execute,
  };
}

function createMcpProvider(): RuntimeToolProvider {
  return {
    registration: { kind: 'mcp' },
    async listTools({ includeDisabled }) {
      return disambiguateMcpInvocationNames(
        await getMcpToolDescriptors(includeDisabled ? { includeDisabled: true } : undefined),
      );
    },
    async refresh() {
      const servers = await getAllMcpServers({ includeSecrets: false });
      await Promise.all(
        servers
          .filter((server) => server.enabled)
          .map((server) => refreshMcpServerDiscovery(server.id)),
      );
    },
    execute(call, authorizedDescriptor, options) {
      return executeMcpToolCall(call, authorizedDescriptor, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxResultBytes: options.maxResultBytes,
      });
    },
  };
}

/**
 * MCP invocation names are derived from sanitized server/tool identifiers, so
 * distinct servers can collide (e.g. `my-server` vs `my_server`). The registry
 * treats duplicate invocation names as fatal and would disable the whole tool
 * registry (M18); disambiguate the later duplicates deterministically instead.
 */
function disambiguateMcpInvocationNames(
  descriptors: readonly ToolDescriptor[],
): ToolDescriptor[] {
  if (!Array.isArray(descriptors)) return descriptors as ToolDescriptor[];
  const seen = new Map<string, number>();
  return descriptors.map((descriptor) => {
    const base = descriptor.invocationName;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    if (occurrence === 0) return descriptor;
    return { ...descriptor, invocationName: `${base}_${occurrence + 1}` };
  });
}

function createMcpCapabilityProvider(): RuntimeToolProvider {
  return {
    ...createLocalProvider(
      MCP_CAPABILITY_TOOL_PROVIDER.id,
      ({ locale }) => createMcpCapabilityToolDescriptors(locale),
      executeMcpCapabilityToolCall,
    ),
    disambiguateInvocationNames: disambiguateMcpCapabilityToolDescriptors,
  };
}

async function createMemoryRuntime(call: ToolCall): Promise<MemoryToolRuntime> {
  const chatSessionId = call.source?.chatSessionId ?? null;
  if (call.name !== 'memory_save' || !chatSessionId) return memoryRuntime;

  const project = await getProjectForConversation(chatSessionId);
  if (!project) return memoryRuntime;

  return {
    ...memoryRuntime,
    async saveMemory(input: NewMemory) {
      return memoryRuntime.saveMemory({
        ...input,
        scope: 'project',
        projectId: project.id,
      });
    },
  };
}
