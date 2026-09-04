import type { ToolDescriptor, ToolProviderIdentity, ToolExecutionRecord } from '../types';
import { MCP_CAPABILITY_TOOL_PROVIDER_ID } from '../mcp/capability-contract';
import { MEMORY_TOOL_PROVIDER_ID } from '../tool/memory';

export { INCOMPLETE_TOOL_CALL_ERROR_CODE } from '../tool/execution-error';

/**
 * The full set of tool executions that should trigger an inline-agent
 * continuation round after the model's turn. Everything here has an
 * executable provider and no terminal marker, so the loop must be started
 * (or continued) to give the model a chance to produce a final answer.
 */
export function isContinuableToolProvider(provider?: ToolProviderIdentity): boolean {
  if (!provider) return false;
  if (
    provider.kind === 'mcp' ||
    provider.id === MCP_CAPABILITY_TOOL_PROVIDER_ID ||
    provider.id === 'web' ||
    provider.id === 'browser_control' ||
    (
      provider.kind === 'local' &&
      provider.id === MEMORY_TOOL_PROVIDER_ID
    )
  ) {
    return true;
  }
  return false;
}

/** The names of local tools the inline agent treats as continuable. Kept in
 * sync with the provider-based predicate above for the tools that are matched
 * by name rather than by provider. */
export function isContinuableToolName(name: string): boolean {
  return (
    name === 'web_search' ||
    name === 'web_fetch' ||
    name.startsWith('browser_')
  );
}

/**
 * An incomplete streamed call is a recovery-only execution record. It must be
 * included so the inline agent can see the failure and re-emit a closed call;
 * executeToolCall exits on call.parseError before any provider is reached.
 */
export function selectContinuableToolExecutions(
  executions: readonly ToolExecutionRecord[],
): ToolExecutionRecord[] {
  return executions.filter((execution) =>
    !execution.pending &&
    (
      isContinuableToolProvider(execution.provider) ||
      isContinuableToolName(execution.name)
    ));
}

/**
 * Policy mirror of {@link selectContinuableToolExecutions} for descriptor
 * lists: keeps the descriptors whose tools may trigger an inline continuation.
 * The inline agent must be able to resolve and echo the result of these tools,
 * so the descriptors used to build prompt schemas must match the executions
 * the policy keeps.
 */
export function selectContinuableToolDescriptors(
  descriptors: readonly ToolDescriptor[],
): ToolDescriptor[] {
  return descriptors.filter(
    (descriptor) =>
      isContinuableToolProvider(descriptor.provider) ||
      isContinuableToolName(descriptor.name),
  );
}
