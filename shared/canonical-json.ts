/** Sorted keys (UTF-16), undefined omitted, no whitespace, leaves by
 * JSON.stringify. One copy: the package hash, step-up grants, write-once
 * keys, loop digests and routine-watch fingerprints agreed on JSON values.
 * A non-JSON leaf (a function) becomes "null", same as the package form. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((name) => record[name] !== undefined).sort();
  return `{${keys.map((name) => `${JSON.stringify(name)}:${canonicalJson(record[name])}`).join(",")}}`;
}
