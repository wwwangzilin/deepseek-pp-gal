import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import { diagnosticLogBuffer } from '../../core/diagnostics/log-buffer';

export interface DiagnosticsRuntimeHandlerDependencies {
  getVersion(): string;
}

export function createDiagnosticsRuntimeHandlers(
  dependencies: DiagnosticsRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('EXPORT_DIAGNOSTIC_LOGS', () => ({
      exportedAt: new Date().toISOString(),
      extensionVersion: dependencies.getVersion(),
      entries: diagnosticLogBuffer.snapshot(),
    })),
  ]);
}
