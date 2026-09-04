import { ARTIFACT_TOOL_NAMES } from '../artifact';
import type { ToolDescriptor } from './types';

/**
 * Model-facing tool retirement (Issue: drop the plugin artifact extension).
 *
 * The artifact tools (`artifact_create` / `artifact_bundle_create`) are
 * retired from the MODEL-FACING catalog: they must no longer appear in the
 * "Available Tools" list the model sees, so the model stops emitting
 * `<artifact_create>` XML and delivers files as plain markdown fences that the
 * DeepSeek native renderer takes over. The execution/restore/export paths for
 * artifact calls stay intact (historical records and in-flight sessions still
 * parse, execute, restore, and export them) — only the model-facing guidance
 * is removed here.
 */
const RETIRED_MODEL_FACING_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
  ARTIFACT_TOOL_NAMES as readonly string[],
);

/** True when a descriptor must never be presented to the model. */
export function isRetiredModelFacingTool(descriptor: ToolDescriptor): boolean {
  return RETIRED_MODEL_FACING_TOOL_NAMES.has(descriptor.invocationName);
}

/** Filters the retired model-facing tools out of a descriptor list. */
export function filterRetiredModelFacingTools(
  descriptors: readonly ToolDescriptor[],
): ToolDescriptor[] {
  return descriptors.filter((descriptor) => !isRetiredModelFacingTool(descriptor));
}
