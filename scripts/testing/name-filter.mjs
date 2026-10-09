// A developer CLI filter such as `--only 'chat|panel'`: the names that contain
// any of the `|`-separated words. Plain substring matching, never a regular
// expression built from the flag, so no input can make matching slow or
// match more than it says. Words are bounded in count and length.
const MAX_WORDS = 32;
const MAX_WORD_LENGTH = 100;

/** A predicate over names, or null when the flag is absent or empty. Throws
 * on a filter longer than the bounds above. */
export function nameFilter(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const words = value.split("|").map((word) => word.trim()).filter(Boolean);
  if (words.length > MAX_WORDS || words.some((word) => word.length > MAX_WORD_LENGTH)) {
    throw new Error(`a filter takes at most ${MAX_WORDS} words of ${MAX_WORD_LENGTH} characters`);
  }
  if (!words.length) return null;
  return (name) => words.some((word) => String(name).includes(word));
}
