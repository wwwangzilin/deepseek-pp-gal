import type {
  TypedRuntimeCommandRequest,
  TypedRuntimeCommandResponse,
  TypedRuntimeCommandType,
} from '../../core/messaging/runtime-command-registry';
import {
  getRuntimeErrorMessage,
  isRuntimeFailure,
} from '../../core/messaging/runtime-response';

export type SidepanelRuntimeErrorKind =
  | 'transport'
  | 'unavailable'
  | 'command'
  | 'protocol';

export class SidepanelRuntimeError extends Error {
  readonly kind: SidepanelRuntimeErrorKind;
  readonly command: TypedRuntimeCommandType;
  readonly retryable: boolean;

  constructor(options: {
    kind: SidepanelRuntimeErrorKind;
    command: TypedRuntimeCommandType;
    message: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SidepanelRuntimeError';
    this.kind = options.kind;
    this.command = options.command;
    this.retryable = options.retryable ?? false;
  }
}

export type AnyTypedRuntimeCommandRequest = {
  [TType in TypedRuntimeCommandType]: TypedRuntimeCommandRequest<TType>;
}[TypedRuntimeCommandType];

type RuntimeResponseFor<TRequest extends AnyTypedRuntimeCommandRequest> =
  TypedRuntimeCommandResponse<TRequest['type']>;

export type SidepanelRuntimeTransport = (
  request: AnyTypedRuntimeCommandRequest,
) => Promise<unknown>;

export interface SidepanelRuntimeRequestOptions<TResult> {
  decode?: (value: unknown) => TResult;
  unavailableMessage?: string;
  acceptFailure?: boolean;
}

export interface SidepanelRuntimeRetryConfig {
  /** Total transport attempts including the initial send. */
  maxAttempts: number;
  /** Delay between transport attempts in milliseconds. */
  retryDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: SidepanelRuntimeRetryConfig = {
  maxAttempts: 3,
  retryDelayMs: 400,
};

export interface SidepanelRuntimeClientOptions {
  retry?: Partial<SidepanelRuntimeRetryConfig>;
}

export interface SidepanelRuntimeClient {
  request<TRequest extends AnyTypedRuntimeCommandRequest, TResult>(
    request: TRequest,
    options: SidepanelRuntimeRequestOptions<TResult> & { decode: (value: unknown) => TResult },
  ): Promise<TResult>;
  request<TRequest extends AnyTypedRuntimeCommandRequest>(
    request: TRequest,
    options?: Omit<SidepanelRuntimeRequestOptions<RuntimeResponseFor<TRequest>>, 'decode'>,
  ): Promise<RuntimeResponseFor<TRequest>>;
}

export function isRetryableChannelError(error: unknown): boolean {
  if (error instanceof SidepanelRuntimeError) return error.kind === 'transport';
  const message = getRuntimeErrorMessage(error).toLowerCase();
  return message.includes('receiving end does not exist')
    || message.includes('message port closed');
}

export function createSidepanelRuntimeClient(
  transport: SidepanelRuntimeTransport,
  options?: SidepanelRuntimeClientOptions,
): SidepanelRuntimeClient {
  const retryConfig: SidepanelRuntimeRetryConfig = {
    maxAttempts: options?.retry?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    retryDelayMs: options?.retry?.retryDelayMs ?? DEFAULT_RETRY_CONFIG.retryDelayMs,
  };

  return Object.freeze({
    async request<
      TRequest extends AnyTypedRuntimeCommandRequest,
      TResult = RuntimeResponseFor<TRequest>,
    >(
      request: TRequest,
      options?: SidepanelRuntimeRequestOptions<TResult>,
    ): Promise<TResult> {
      const response = await sendWithRetry(
        transport,
        request,
        retryConfig,
      );

      if (response === undefined) {
        throw new SidepanelRuntimeError({
          kind: 'unavailable',
          command: request.type,
          message: options?.unavailableMessage ?? `${request.type} did not return a response.`,
        });
      }
      if (isRuntimeFailure(response) && !options?.acceptFailure) {
        throw new SidepanelRuntimeError({
          kind: 'command',
          command: request.type,
          message: typeof response.error === 'string'
            ? response.error
            : options?.unavailableMessage ?? `${request.type} failed.`,
        });
      }

      if (!options?.decode) return response as TResult;
      try {
        return options.decode(response);
      } catch (error) {
        throw new SidepanelRuntimeError({
          kind: 'protocol',
          command: request.type,
          message: getRuntimeErrorMessage(error),
          cause: error,
        });
      }
    },
  });
}

export function createResendingTransport(
  transport: SidepanelRuntimeTransport,
  retry: Partial<SidepanelRuntimeRetryConfig> = {},
): SidepanelRuntimeTransport {
  const retryConfig: SidepanelRuntimeRetryConfig = {
    maxAttempts: retry.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    retryDelayMs: retry.retryDelayMs ?? DEFAULT_RETRY_CONFIG.retryDelayMs,
  };
  return (request) => sendWithRetry(transport, request, retryConfig);
}

async function sendWithRetry(
  transport: SidepanelRuntimeTransport,
  request: AnyTypedRuntimeCommandRequest,
  retry: SidepanelRuntimeRetryConfig,
): Promise<unknown> {
  let lastError: unknown;
  let retried = false;
  const maxAttempts = Math.max(1, Math.floor(retry.maxAttempts));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await transport(request);
    } catch (error) {
      lastError = error;
      const canRetry = isRetryableChannelError(error) && attempt < maxAttempts;
      if (canRetry) retried = true;
      if (!canRetry) break;
      await sleep(retry.retryDelayMs);
    }
  }

  if (retried) {
    throw new SidepanelRuntimeError({
      kind: 'transport',
      command: request.type,
      retryable: true,
      message: 'The extension background is still starting. Please try again in a moment.',
      cause: lastError,
    });
  }
  throw new SidepanelRuntimeError({
    kind: 'transport',
    command: request.type,
    message: getRuntimeErrorMessage(lastError),
    cause: lastError,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const sidepanelRuntimeClient = createSidepanelRuntimeClient(
  (request) => chrome.runtime.sendMessage(request),
);
