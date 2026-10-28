// What the Context pod may say about the last turn. Only numbers the server
// already measured are kept: the model's own context reading, and the byte
// size of the system prompt that was just assembled. Nothing is estimated.

export interface ContextReading {
  tokens: number;
  window?: number;
  /** Bytes of the assembled system prompt (stable and volatile together). */
  promptBytes?: number;
}

const clean = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

/** The next stored reading. A turn that reported no context keeps the
 * previous one. A prompt size is attached only to a real reading: it never
 * stands in for a token total the model did not report. */
export function nextContext(
  prev: ContextReading | undefined,
  turn: { tokens?: number; window?: number; promptBytes?: number },
): ContextReading | undefined {
  const tokens = clean(turn.tokens);
  const window = clean(turn.window);
  const promptBytes = clean(turn.promptBytes);
  const kept: ContextReading | undefined = tokens > 0
    ? { tokens, ...(window > 0 ? { window } : {}), ...(prev?.promptBytes ? { promptBytes: prev.promptBytes } : {}) }
    : prev ? { ...prev } : undefined;
  if (!kept) return undefined;
  if (promptBytes > 0) kept.promptBytes = promptBytes;
  return kept;
}
