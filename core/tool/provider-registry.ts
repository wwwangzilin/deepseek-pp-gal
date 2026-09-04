import type { SupportedLocale } from '../i18n';
import type {
  ToolCall,
  ToolCapabilityScope,
  ToolDescriptor,
  ToolProviderIdentity,
  ToolResult,
} from './types';

export type ToolProviderRegistration =
  | { kind: 'local'; id: string }
  | { kind: 'mcp' };

export interface ToolProviderDescriptorContext {
  locale: SupportedLocale;
  includeDisabled: boolean;
}

export interface ToolProviderExecutionContext {
  locale: SupportedLocale;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResultBytes?: number;
  /** Full live descriptors, supplied only after runtime authorization. */
  availableDescriptors?: readonly ToolDescriptor[];
  /** Background-derived capability scope; never populated from a ToolCall payload. */
  capabilityScope?: ToolCapabilityScope;
}

export interface RuntimeToolProvider {
  registration: ToolProviderRegistration;
  listTools(context: ToolProviderDescriptorContext): Promise<ToolDescriptor[]>;
  /**
   * Optional provider-owned deterministic disambiguation. It may only rename
   * descriptors it owns; the registry validates the resulting contracts.
   */
  disambiguateInvocationNames?(
    descriptors: readonly ToolDescriptor[],
    occupiedInvocationNames: ReadonlySet<string>,
  ): ToolDescriptor[];
  execute(
    call: ToolCall,
    authorizedDescriptor: ToolDescriptor,
    context: ToolProviderExecutionContext,
  ): Promise<ToolResult>;
  refresh?(context: Pick<ToolProviderDescriptorContext, 'locale'>): Promise<void>;
}

export type ToolProviderRegistryErrorCode =
  | 'tool_provider_duplicate'
  | 'tool_provider_unknown'
  | 'tool_provider_descriptor_mismatch'
  | 'tool_descriptor_duplicate'
  | 'tool_invocation_duplicate';

export class ToolProviderRegistryError extends Error {
  constructor(
    public readonly code: ToolProviderRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ToolProviderRegistryError';
  }
}

/**
 * The sole owner of provider registration, descriptor aggregation, and
 * provider-before-name execution routing.
 */
export class ToolProviderRegistry {
  private readonly providers: readonly RuntimeToolProvider[];
  private readonly providersByRegistration: ReadonlyMap<string, RuntimeToolProvider>;

  constructor(providers: readonly RuntimeToolProvider[]) {
    const providersByRegistration = new Map<string, RuntimeToolProvider>();
    for (const provider of providers) {
      const key = registrationKey(provider.registration);
      if (providersByRegistration.has(key)) {
        throw new ToolProviderRegistryError(
          'tool_provider_duplicate',
          `Duplicate tool provider registration: ${key}`,
        );
      }
      providersByRegistration.set(key, provider);
    }
    this.providers = [...providers];
    this.providersByRegistration = providersByRegistration;
  }

  async listTools(context: ToolProviderDescriptorContext): Promise<ToolDescriptor[]> {
    const groups = await Promise.all(
      this.providers.map((provider) => provider.listTools(context)),
    );
    const resolvedGroups = groups.map((descriptors, index) => {
      this.assertProviderOwnsDescriptors(this.providers[index], descriptors);
      return descriptors;
    });
    for (let index = 0; index < resolvedGroups.length; index += 1) {
      const provider = this.providers[index];
      if (!provider.disambiguateInvocationNames) continue;
      const occupiedInvocationNames = new Set(
        resolvedGroups.flatMap((descriptors, groupIndex) => (
          groupIndex === index ? [] : descriptors.map((descriptor) => descriptor.invocationName)
        )),
      );
      const resolved = provider.disambiguateInvocationNames(
        resolvedGroups[index],
        occupiedInvocationNames,
      );
      this.assertProviderOwnsDescriptors(provider, resolved);
      this.assertDescriptorIdentityPreserved(resolvedGroups[index], resolved, provider);
      resolvedGroups[index] = resolved;
    }
    const descriptors = resolvedGroups.flat();
    this.assertDescriptorContracts(descriptors);
    return descriptors;
  }

  async refresh(context: Pick<ToolProviderDescriptorContext, 'locale'>): Promise<void> {
    await Promise.all(
      this.providers.map((provider) => provider.refresh?.(context)),
    );
  }

  async execute(
    call: ToolCall,
    authorizedDescriptor: ToolDescriptor,
    context: ToolProviderExecutionContext,
  ): Promise<ToolResult> {
    const provider = this.getProvider(authorizedDescriptor.provider);
    return provider.execute(call, authorizedDescriptor, context);
  }

  private getProvider(identity: ToolProviderIdentity): RuntimeToolProvider {
    if (identity.kind === 'local' && identity.transport !== 'in_process') {
      throw new ToolProviderRegistryError(
        'tool_provider_unknown',
        `Unsupported local tool provider transport: ${identity.transport}`,
      );
    }
    const key = identity.kind === 'mcp'
      ? registrationKey({ kind: 'mcp' })
      : registrationKey({ kind: 'local', id: identity.id });
    const provider = this.providersByRegistration.get(key);
    if (!provider) {
      throw new ToolProviderRegistryError(
        'tool_provider_unknown',
        `Unknown tool provider: ${identity.kind}:${identity.id}`,
      );
    }
    return provider;
  }

  private assertDescriptorContracts(descriptors: readonly ToolDescriptor[]): void {
    const descriptorIds = new Set<string>();
    const invocationNames = new Set<string>();

    for (const descriptor of descriptors) {
      this.getProvider(descriptor.provider);
      if (descriptorIds.has(descriptor.id)) {
        throw new ToolProviderRegistryError(
          'tool_descriptor_duplicate',
          `Duplicate tool descriptor id: ${descriptor.id}`,
        );
      }
      if (invocationNames.has(descriptor.invocationName)) {
        throw new ToolProviderRegistryError(
          'tool_invocation_duplicate',
          `Duplicate tool invocation name: ${descriptor.invocationName}`,
        );
      }
      descriptorIds.add(descriptor.id);
      invocationNames.add(descriptor.invocationName);
    }
  }

  private assertProviderOwnsDescriptors(
    provider: RuntimeToolProvider,
    descriptors: readonly ToolDescriptor[],
  ): void {
    for (const descriptor of descriptors) {
      if (registrationOwnsIdentity(provider.registration, descriptor.provider)) continue;
      throw new ToolProviderRegistryError(
        'tool_provider_descriptor_mismatch',
        `Provider ${registrationKey(provider.registration)} does not own descriptor ${descriptor.id}`,
      );
    }
  }

  private assertDescriptorIdentityPreserved(
    source: readonly ToolDescriptor[],
    resolved: readonly ToolDescriptor[],
    provider: RuntimeToolProvider,
  ): void {
    const unchanged = source.length === resolved.length && source.every((descriptor, index) => {
      const candidate = resolved[index];
      return candidate?.id === descriptor.id &&
        candidate.provider === descriptor.provider &&
        candidate.title === descriptor.title &&
        candidate.description === descriptor.description &&
        candidate.inputSchema === descriptor.inputSchema &&
        candidate.outputSchema === descriptor.outputSchema &&
        candidate.execution === descriptor.execution &&
        candidate.annotations === descriptor.annotations;
    });
    if (unchanged) return;
    throw new ToolProviderRegistryError(
      'tool_provider_descriptor_mismatch',
      `Provider ${registrationKey(provider.registration)} changed descriptor identity while resolving invocation names.`,
    );
  }
}

function registrationKey(registration: ToolProviderRegistration): string {
  return registration.kind === 'mcp'
    ? 'mcp:*'
    : `local:${registration.id}`;
}

function registrationOwnsIdentity(
  registration: ToolProviderRegistration,
  identity: ToolProviderIdentity,
): boolean {
  return registration.kind === 'mcp'
    ? identity.kind === 'mcp'
    : identity.kind === 'local'
      && identity.id === registration.id
      && identity.transport === 'in_process';
}
