// What a person reads when something fails. A server or library message is
// kept when it is a sentence; a machine dump (a JSON issue list such as a
// zod error, a stack, a huge body) never reaches the screen: the fallback,
// a sentence in the person's language, is shown instead (2026-10-14).
export function readableErrorMessage(error: unknown, fallback: string): string {
  const raw = (error instanceof Error ? error.message : typeof error === "string" ? error : "").trim();
  if (!raw) return fallback;
  if (/^[[{]/.test(raw)) return fallback;
  if (/"code"\s*:|invalid_type|^\s*at\s|\n\s*at\s/.test(raw)) return fallback;
  if (raw.length > 300) return fallback;
  return raw;
}
