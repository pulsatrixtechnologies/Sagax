// Field readers for ConnectWise Manage REST records. A record comes back as
// the API wrote it (`status: { id, name }`, `company: { identifier, name }`)
// or flattened by a tool (`status: "New"`, `companyName`), so each reader
// accepts both and never throws.

import { CW_TEXT_MAX } from "./types.ts";

export type CwRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is CwRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function clip(text: string, max = CW_TEXT_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Multi-line text (a note), trimmed and bounded, line breaks kept. */
export function clipBlock(text: string, max: number): string {
  const trimmed = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function at(record: CwRecord, path: string): unknown {
  let value: unknown = record;
  for (const key of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** A display name: a plain string, or a reference's `name`, `identifier` or
 * `value`. */
function nameOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (isRecord(value)) {
    for (const key of ["name", "identifier", "value", "description"]) {
      const inner = value[key];
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    }
    const first = value.firstName, last = value.lastName;
    if (typeof first === "string" || typeof last === "string") {
      const full = [first, last].filter((part): part is string => typeof part === "string" && !!part.trim()).join(" ").trim();
      return full || undefined;
    }
  }
  return undefined;
}

/** The first of `paths` that names something, clipped to one line. */
export function text(record: CwRecord, ...paths: string[]): string | undefined {
  for (const path of paths) {
    const found = nameOf(at(record, path));
    if (found) return clip(found);
  }
  return undefined;
}

export function num(record: CwRecord, ...paths: string[]): number | undefined {
  for (const path of paths) {
    const value = at(record, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

export function bool(record: CwRecord, ...paths: string[]): boolean | undefined {
  for (const path of paths) {
    const value = at(record, path);
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

/** A positive whole id. */
export function id(record: CwRecord, ...paths: string[]): number | undefined {
  const value = num(record, ...(paths.length ? paths : ["id"]));
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** An ISO date or date-time as the API wrote it ("2026-10-12T14:00:00Z"). */
export function date(record: CwRecord, ...paths: string[]): string | undefined {
  for (const path of paths) {
    const value = at(record, path);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value))) return value;
  }
  return undefined;
}

/** The `_info` block's links, where the API names the record's own address. */
export function infoHrefs(record: CwRecord): string[] {
  const info = record._info;
  if (!isRecord(info)) return [];
  return Object.values(info).filter((value): value is string => typeof value === "string" && /^https?:\/\//.test(value));
}
