// A handoff to another bot names an engine and a model. The engine alone
// is not enough: the model has to be one that engine lists.

export function handoffModel(input: {
  instanceId: string;
  requested?: string;
  models: readonly string[];
  defaultModel?: string;
}): { instanceId: string; model: string } | null {
  const instanceId = input.instanceId.trim();
  if (!instanceId) return null;
  const models = input.models.map((model) => model.trim()).filter(Boolean);
  const requested = input.requested?.trim() ?? "";
  if (requested && (models.length === 0 || models.includes(requested))) return { instanceId, model: requested };
  const preferred = input.defaultModel?.trim() ?? "";
  const chosen = preferred && models.includes(preferred) ? preferred : models[0];
  if (chosen) return { instanceId, model: chosen };
  return requested ? { instanceId, model: requested } : null;
}

/** Replace one backup's model. Null when that model is not on the engine. */
export function fallbackWithModel(
  chain: readonly { instanceId: string; model: string }[],
  instanceId: string,
  model: string,
  allowed: readonly string[],
): { instanceId: string; model: string }[] | null {
  if (!allowed.includes(model)) return null;
  if (!chain.some((entry) => entry.instanceId === instanceId)) return null;
  return chain.map((entry) => entry.instanceId === instanceId ? { ...entry, model } : { ...entry });
}
