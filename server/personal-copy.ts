// A copy of what the person already lent, kept on the server so a cloud bot
// can read it while their computer sleeps. It is not a live route: the
// desktop publishes it while it is awake, and the bytes stay. The live
// shared-computer call still refuses when the desktop is offline.
//
// The copy is the person's. Another member does not get it, and it never
// holds a screen, cookies, or a password store.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export const PERSONAL_COPY_DIR = "personal-copies";
const FILE_CAP = 20;
const TEXT_CAP = 100_000;
const CHROME_FILES = new Set(["bookmarks.json", "tabs.json"]);

export type PersonalCopyKind = "chrome" | "folder";

export interface PersonalCopyFile {
  path: string;
  text: string;
}

export interface PersonalCopy {
  person: string;
  kind: PersonalCopyKind;
  name: string;
  at: number;
  files: PersonalCopyFile[];
}

function personDir(person: string): string {
  return createHash("sha256").update(person).digest("hex");
}

function safeName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80 || !/^[\w.-]+$/.test(trimmed)) return null;
  return trimmed;
}

function safeRelative(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  return normalized;
}

/** Chrome's copy is a reading list, not the profile and not the screen. */
export function personalCopyRefusal(kind: string, files: readonly { path: string }[]): string | null {
  if (kind !== "chrome" && kind !== "folder") return "The copy is a chrome reading list or a lent folder, never a screen.";
  if (files.length > FILE_CAP) return `A copy holds at most ${FILE_CAP} files.`;
  for (const file of files) {
    const path = safeRelative(file.path);
    if (!path) return "A copy path stays inside the folder.";
    if (/cookie|login data|password|web data|screen/i.test(path)) return "A copy does not keep cookies, passwords, or a screen.";
    if (kind === "chrome" && !CHROME_FILES.has(path)) return "A Chrome copy keeps bookmarks.json and tabs.json only.";
  }
  return null;
}

export function publishPersonalCopy(root: string, copy: PersonalCopy): { files: number; at: number } {
  const name = safeName(copy.name);
  if (!copy.person.trim() || !name) throw new Error("The copy needs a person and a name.");
  const refusal = personalCopyRefusal(copy.kind, copy.files);
  if (refusal) throw new Error(refusal);
  const files: PersonalCopyFile[] = [];
  for (const file of copy.files) {
    const path = safeRelative(file.path);
    if (!path) throw new Error("A copy path stays inside the folder.");
    if (typeof file.text !== "string" || file.text.length > TEXT_CAP) throw new Error("A copied file is text, and not that large.");
    files.push({ path, text: file.text });
  }
  const dir = join(root, PERSONAL_COPY_DIR, personDir(copy.person));
  mkdirSync(dir, { recursive: true });
  const at = copy.at;
  const body: PersonalCopy = { person: copy.person, kind: copy.kind, name, at, files };
  writeFileAtomic(join(dir, `${copy.kind}-${name}.json`), JSON.stringify(body), { mode: 0o600 });
  return { files: files.length, at };
}

/** The reader's own copy, or null. A different person gets nothing. */
export function readPersonalCopy(root: string, reader: string, kind: PersonalCopyKind, name: string): PersonalCopy | null {
  const safe = safeName(name);
  if (!reader.trim() || !safe) return null;
  let parsed: PersonalCopy;
  try {
    parsed = JSON.parse(readFileSync(join(root, PERSONAL_COPY_DIR, personDir(reader), `${kind}-${safe}.json`), "utf8")) as PersonalCopy;
  } catch {
    return null;
  }
  if (parsed.person !== reader || parsed.kind !== kind) return null;
  return parsed;
}
