// Organization server: the engines (model providers) the organization allows,
// set by an admin in Perspicax (`allowedEngines`, POST /api/org/admin/settings,
// docs/org-admin-api.md). A list of engine instance ids; null, absent or an
// empty list means every engine, as before the setting existed. The server
// refuses a model on another engine, moves a bot whose engine left the list
// onto Auto on an allowed engine, and Auto never picks outside the list. The
// model picker lists only these providers (src/components/ModelPicker.tsx).
import type { ModelSelection } from "./wire.ts";

export type AllowedEngines = readonly string[] | null | undefined;

/** Whether the organization lets this engine run turns. */
export function engineAllowed(allowed: AllowedEngines, instanceId: string): boolean {
  return !allowed || allowed.length === 0 || allowed.includes(instanceId);
}

/** An engine as the fallback sees it: its id, whether it runs here, and the
 * model it starts on. */
export interface FallbackEngine {
  instanceId: string;
  installed: boolean;
  defaultModel: string;
}

/**
 * The model a bot falls back to once its engine is no longer allowed: Auto,
 * based on the organization's New bot default when that engine is allowed,
 * else on the first allowed engine that runs here, at its default model.
 * Null when the bot's engine is still allowed, or when no allowed engine can
 * take it (the bot then keeps its model and the server refuses its turns).
 */
export function allowedFallbackSelection(
  current: ModelSelection,
  allowed: AllowedEngines,
  engines: readonly FallbackEngine[],
  preferred?: ModelSelection,
): ModelSelection | null {
  if (engineAllowed(allowed, current.instanceId)) return null;
  const usable = (instanceId: string) => engineAllowed(allowed, instanceId) &&
    engines.some((engine) => engine.instanceId === instanceId && engine.installed);
  if (preferred && preferred.model && usable(preferred.instanceId)) {
    return { instanceId: preferred.instanceId, model: preferred.model, auto: true };
  }
  const first = engines.find((engine) => engine.defaultModel && usable(engine.instanceId));
  return first ? { instanceId: first.instanceId, model: first.defaultModel, auto: true } : null;
}
