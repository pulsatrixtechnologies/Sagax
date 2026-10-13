/** The engine set a production image bakes. An empty set shipped to production on
 * 2026-10-12 (`pulsa-bot-server:main-example1`, engineSet "none"). */
export const PRODUCTION_ENGINE_SET = "all";

/** `engines.lock.json` `engines[].id`, in lock order. The unit test fails
 * when the lock gains or drops an engine. */
export const PRODUCTION_ENGINE_IDS = [
  "claude",
  "codex",
  "pi",
  "gemini",
  "kimi",
  "qwen",
  "opencode",
  "droid",
  "grok",
  "cursor",
  "hermes",
] as const;

/** One startup line when the image is not the full set or an engine did not
 * start. Null when there is no manifest (desktop, source checkout) and when
 * the full set started. Any line containing `engine_missing` is an alert. */
export function engineMissingLogLine(
  manifest: { engineSet?: string; installed?: ReadonlyArray<{ id: string }> } | null,
  checks: ReadonlyArray<{ id: string; ok: boolean }>,
): string | null {
  if (!manifest) return null;
  const set = (manifest.engineSet ?? "").trim() || "none";
  const installed = new Set((manifest.installed ?? []).map((engine) => engine.id));
  const failed = checks.filter((check) => !check.ok).map((check) => check.id);
  const absent = PRODUCTION_ENGINE_IDS.filter((id) => !installed.has(id));
  const missing = [...new Set([...absent, ...failed])];
  if (set === PRODUCTION_ENGINE_SET && missing.length === 0) return null;
  const listed = missing.length > 0 ? missing.join(",") : PRODUCTION_ENGINE_IDS.join(",");
  return `[engines] engine_missing engineSet=${set} missing=${listed}`;
}
