// A short text to read aloud from a long reply. The chat keeps the full
// reply. Nothing is sent: the summary is taken from the reply itself.

export const VOICE_SUMMARY_MIN_CHARS = 800;
const MAX_CHARS = 420;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

/** A spoken summary, or null when the reply is short enough to read whole. */
export function voiceSummary(text: string, minChars = VOICE_SUMMARY_MIN_CHARS): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < minChars) return null;
  const parts = sentences(clean);
  const picked = [parts[0], parts[Math.floor(parts.length / 2)], parts[parts.length - 1]]
    .filter((part): part is string => Boolean(part));
  const unique: string[] = [];
  for (const part of picked) if (!unique.includes(part)) unique.push(part);
  let summary = unique.join(" ");
  if (summary.length > MAX_CHARS) summary = `${summary.slice(0, MAX_CHARS - 3).trimEnd()}...`;
  return summary;
}
