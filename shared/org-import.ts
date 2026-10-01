// The copy of a person's own bots that travels from a solo Sagax to an
// organization server (slice 8, "Join a Perspicax server"). Browser-safe:
// the solo UI and the org UI parse it locally, the org server parses it
// again before writing anything.
//
// People are named only by opaque local principal ids (`pr_<uuid>`), never
// by an address. `self` is the person who exported; the org server maps it
// to the importer and drops every other ref (counted, never a right).
import { z } from "zod";

import { MAX_TEAM_BACKUP_BYTES, parseTeamBackup, type TeamBackup } from "./team-backup.ts";

export const ORG_IMPORT_FORMAT = "sagax.org-import";
export const ORG_IMPORT_VERSION = 1;
/** The backup limit plus room for the choices and people tables. */
export const MAX_ORG_IMPORT_BYTES = MAX_TEAM_BACKUP_BYTES + 1024 * 1024;
export const MAX_ORG_IMPORT_REFS = 1_000;

const PRINCIPAL_REF = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ref = z.string().regex(PRINCIPAL_REF, { error: "not a person reference" });
const key = z.string().min(1).max(200);

const documentSchema = z.object({
  format: z.literal(ORG_IMPORT_FORMAT),
  version: z.literal(ORG_IMPORT_VERSION),
  exportedAt: z.number().finite().nonnegative(),
  self: ref,
  choices: z.record(key, z.object({ threads: z.boolean(), memory: z.boolean() }).strict()),
  people: z.object({
    bots: z.record(key, z.object({ owner: ref.nullable(), grants: z.array(ref).max(MAX_ORG_IMPORT_REFS) }).strict()),
    groups: z.record(key, z.object({ humans: z.array(ref).max(MAX_ORG_IMPORT_REFS) }).strict()),
    routines: z.array(z.object({ runAs: ref.nullable() }).strict()).max(2_000),
  }).strict(),
  backup: z.unknown(),
}).strict();

export interface OrgImportChoice { threads: boolean; memory: boolean }
export interface OrgImportPeople {
  bots: Record<string, { owner: string | null; grants: string[] }>;
  groups: Record<string, { humans: string[] }>;
  routines: { runAs: string | null }[];
}
export interface OrgImportDocument {
  format: typeof ORG_IMPORT_FORMAT;
  version: typeof ORG_IMPORT_VERSION;
  exportedAt: number;
  self: string;
  choices: Record<string, OrgImportChoice>;
  people: OrgImportPeople;
  backup: TeamBackup;
}

export function isPersonRef(value: string): boolean {
  return PRINCIPAL_REF.test(value);
}

const fail = (path: string, reason: string): never => {
  throw new Error(`Invalid organization copy: ${path}: ${reason}`);
};

function sameKeys(path: string, actual: string[], expected: string[]): void {
  const want = new Set(expected);
  for (const k of actual) if (!want.has(k)) fail(`${path}.${k}`, "not in the backup");
  const have = new Set(actual);
  for (const k of expected) if (!have.has(k)) fail(`${path}.${k}`, "missing");
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Validate a copy before anything reads it. Takes the parsed JSON or its
 * text. Throws `Invalid organization copy: <path>: <reason>`. */
export function parseOrgImportDocument(input: unknown): OrgImportDocument {
  let value = input;
  if (typeof input === "string") {
    if (byteLength(input) > MAX_ORG_IMPORT_BYTES) fail("file", "too large");
    try {
      value = JSON.parse(input);
    } catch {
      fail("file", "not JSON");
    }
  } else {
    let text: string | undefined;
    try {
      text = JSON.stringify(input);
    } catch {
      fail("file", "not JSON");
    }
    if (text === undefined || byteLength(text) > MAX_ORG_IMPORT_BYTES) fail("file", text === undefined ? "not JSON" : "too large");
  }
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    fail(issue.path.join(".") || "file", issue.message);
  }
  const doc = parsed.data!;
  let backup: TeamBackup;
  try {
    backup = parseTeamBackup(doc.backup);
  } catch (error) {
    return fail("backup", error instanceof Error ? error.message : String(error));
  }
  const botKeys = backup.bots.map((bot) => bot.key);
  const groupKeys = backup.groups.map((group) => group.key);
  sameKeys("choices", Object.keys(doc.choices), botKeys);
  sameKeys("people.bots", Object.keys(doc.people.bots), botKeys);
  sameKeys("people.groups", Object.keys(doc.people.groups), groupKeys);
  if (doc.people.routines.length !== backup.routines.length) fail("people.routines", "not one entry per routine");
  for (const bot of backup.bots) {
    const choice = doc.choices[bot.key]!;
    if (!choice.threads && (bot.tasks.length !== 1 || bot.tasks[0]!.messages.length !== 0)) {
      fail(`backup.bots.${bot.key}`, "threads were not chosen but conversations are present");
    }
    if (!choice.memory && bot.memory !== undefined) fail(`backup.bots.${bot.key}`, "memory was not chosen but is present");
  }
  return {
    format: ORG_IMPORT_FORMAT,
    version: ORG_IMPORT_VERSION,
    exportedAt: doc.exportedAt,
    self: doc.self,
    choices: doc.choices,
    people: doc.people as OrgImportPeople,
    backup,
  };
}
