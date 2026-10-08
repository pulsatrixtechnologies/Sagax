// Which engines can run a local model (a `host::model` inject row), and why
// not when they cannot. One list for the picker (src/components/ModelPicker.tsx)
// and the turn guard (server/desktop-local-models.ts).
//
// Two kinds of local row:
// - "loopback": a server on the same machine as the Sagax server (solo, or
//   the organization server's own machine). The engine talks to it directly.
// - "desktop": a model on the signed-in person's own computer, reached
//   through the desktop bridge (server/desktop-local-models.ts). The bridge
//   carries the OpenAI-compatible calls only (/v1/models, /v1/chat/completions).

export type LocalModelKind = "loopback" | "desktop";

/** Harnesses that take an OpenAI-compatible base URL and a model id from
 * Sagax for a turn (server/drivers/local-inject.ts: applyOpenAIInject,
 * codexLocalProviderArgs, the pi provider file, the Grok [model.x] block,
 * the Kimi, Qwen, Droid, Hermes and OpenCode configs). */
const OPENAI_BASE_URL_ENGINES = new Set([
  "piAgent",
  "codex",
  "grokAgent",
  "kimiAgent",
  "qwenAgent",
  "droidAgent",
  "hermesAgent",
  "opencodeGo",
]);

export type LocalModelUnavailable =
  /** Claude Code speaks the Anthropic protocol; the computer link does not carry it. */
  | "anthropic"
  /** The engine keeps its own endpoint and does not take a local base URL. */
  | "engine";

/** Null when this engine can run that kind of local row. */
export function localModelUnavailable(driverKind: string | undefined, kind: LocalModelKind): LocalModelUnavailable | null {
  if (OPENAI_BASE_URL_ENGINES.has(driverKind ?? "")) return null;
  // Claude Code sets ANTHROPIC_BASE_URL. A loopback server that answers
  // /v1/messages (DwarfStar, Ollama, LM Studio, llama-server) works; the
  // desktop bridge forwards OpenAI-compatible paths only.
  if (driverKind === "claudeAgent") return kind === "loopback" ? null : "anthropic";
  return "engine";
}

/** A desktop bridge inject id: a desk host, then ::, then the model. */
export function isDesktopModelId(id: string | null | undefined): boolean {
  if (!id) return false;
  const sep = id.indexOf("::");
  return sep > 0 && /^desk[a-z0-9]{3,24}$/.test(id.slice(0, sep));
}

export interface LocalModelFacts {
  id: string;
  /** The server's display name (DwarfStar's `name`), when it has one. */
  name?: string;
}

/** Picker labels for one local server's models: "DwarfStar: Qwen3.8 Flash
 * Next". Several ids under one name keep their id so they stay apart. */
export function localModelLabels(server: string, rows: readonly LocalModelFacts[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.name?.trim() || row.id;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const row of rows) {
    const name = row.name?.trim() || row.id;
    const shown = (counts.get(name) ?? 0) > 1 && name !== row.id ? `${name} (${row.id})` : name;
    out.set(row.id, server.trim() ? `${server.trim()}: ${shown}` : shown);
  }
  return out;
}
