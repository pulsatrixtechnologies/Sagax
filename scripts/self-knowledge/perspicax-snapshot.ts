// Writes server/self-knowledge/perspicax.snapshot.json: Perspicax's part
// of the sagax_help knowledge base, read from a Perspicax repository at a
// ref (origin/main by default): the console's menu and Settings pages with
// their French and English labels and the role that sees them, the header
// note of each console page, the user docs and the last release notes.
//
//   node --experimental-strip-types scripts/self-knowledge/perspicax-snapshot.ts --repo ../Perspicax [--ref origin/main]
//
// Rerun at each Perspicax release (then scripts/self-knowledge/generate.ts).
// A bot reaches the live catalog of its organization through api_list.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnowledgeSection, PerspicaxSnapshot } from "../../server/self-knowledge-types.ts";
import { clip, docSections, scrub } from "./markdown.ts";
import { PERSPICAX_SNAPSHOT_FILE } from "./build.ts";

const arg = (name: string) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const repo = arg("--repo");
const ref = arg("--ref") ?? "origin/main";
if (!repo) {
  console.error("usage: perspicax-snapshot.ts --repo <Perspicax checkout> [--ref origin/main]");
  process.exit(2);
}
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const show = (path: string) => git("show", `${ref}:${path}`);
const files = git("ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean);

const ROLE_WORDS: Record<string, string> = {
  employee: "every person of the organization", manager: "managers and admins", admin: "admins only",
};

/** `"key": "value",` lines of the console's message tables. */
function messages(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of show(path).matchAll(/^\s*"([\w.-]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) out[match[1]] = JSON.parse(`"${match[2]}"`);
  return out;
}

const fr = messages("console/src/lib/messages.fr.ts");
const en = messages("console/src/lib/messages.en.ts");
const both = (key: string) => {
  const english = en[key] ?? key;
  const french = fr[key];
  return french && french !== english ? `${english} (${french})` : english;
};

/** The comment block at the top of a source file, as prose. */
function headerNote(source: string): string {
  const lines: string[] = [];
  for (const line of source.split("\n")) {
    const comment = /^\s*\/\/\s?(.*)$/.exec(line);
    if (!comment) { if (lines.length || line.trim()) break; continue; }
    lines.push(comment[1]);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

const sections: KnowledgeSection[] = [];

// The console's menu: NAV in console/src/lib/nav.ts.
const nav = show("console/src/lib/nav.ts");
const routeInfo = new Map<string, { label: string; group: string; role: string; advanced: boolean; sagax: boolean }>();
let group = "";
for (const line of nav.split("\n")) {
  const head = /^\s*label: "([\w.]+)",\s*$/.exec(line);
  if (head) group = both(head[1]);
  const item = /\{ to: "([^"]+)", label: "([\w.]+)",.*?min: "(\w+)"(.*)\}/.exec(line);
  if (!item) continue;
  const [, to, labelKey, role, rest] = item;
  if (routeInfo.has(to)) continue;
  const only = /only: "(\w+)"/.exec(rest)?.[1];
  routeInfo.set(to, { label: both(labelKey), group, role: only ? `${only}s only` : ROLE_WORDS[role] ?? role, advanced: /advanced: true/.test(rest), sagax: /sagax: true/.test(rest) });
}

// Page notes: console/src/pages/**.tsx, matched to their menu row by the
// first address they name.
const pageNotes = new Map<string, { note: string; file: string }>();
for (const file of files.filter((path) => /^console\/src\/pages\/.+\.tsx$/.test(path) && !/\.test\./.test(path))) {
  const note = headerNote(show(file));
  if (note.length < 60) continue;
  const route = /`(\/[a-z][\w/-]*)/.exec(note)?.[1]?.replace(/\/:.*$/, "") ?? "";
  pageNotes.set(route && !pageNotes.has(route) ? route : file, { note, file });
}

const consoleWhere = (to: string, info?: { label: string; group: string }) =>
  `Perspicax console${info ? ` > ${info.group ? `${info.group} > ` : ""}${info.label}` : ""} (${to})`;

for (const [to, info] of routeInfo) {
  const page = pageNotes.get(to);
  sections.push({
    id: `px:console:${to}`,
    kind: "perspicax",
    title: `Perspicax console: ${info.label}`,
    where: consoleWhere(to, info),
    access: `${info.role}${info.sagax ? "; shown while a Sagax server is linked" : ""}${info.advanced ? "; Mode avancé only" : ""}`,
    text: clip(page ? page.note : `${info.label}: a page of the Perspicax console menu.`, 2400),
    source: page?.file ?? "console/src/lib/nav.ts",
  });
  if (page) pageNotes.delete(to);
}
for (const [key, page] of pageNotes) {
  const route = key.startsWith("/") ? key : /`(\/[a-z][\w/?=&-]*)/.exec(page.note)?.[1] ?? "";
  sections.push({
    id: `px:page:${page.file.replace(/^console\/src\/pages\//, "").replace(/\.tsx$/, "")}`,
    kind: "perspicax",
    title: `Perspicax console page ${page.file.replace(/^console\/src\/pages\//, "").replace(/\.tsx$/, "")}`,
    ...(route ? { where: `Perspicax console (${route})` } : {}),
    text: clip(page.note, 2400),
    source: page.file,
  });
}

// The Settings window: console/src/lib/settings-pages.ts.
const settings = show("console/src/lib/settings-pages.ts");
for (const match of settings.matchAll(/id: "([\w.]+)",\s*group: "(\w+)",\s*label: "([\w.]+)",[\s\S]*?kw: "([^"]*)"([^}]*)\}/g)) {
  const [, id, groupId, labelKey, kw, rest] = match;
  const admin = /admin: true/.test(rest) || groupId === "organisation";
  sections.push({
    id: `px:settings:${id}`,
    kind: "perspicax",
    title: `Perspicax settings: ${both(labelKey)}`,
    where: `Perspicax console > account menu > Réglages (Settings) > ${groupId === "organisation" ? "Organisation" : "Personnel"} > ${both(labelKey)} (?settings=${id})`,
    access: admin ? "admins only" : "each person, their own",
    keywords: kw,
    text: `Settings page ${both(labelKey)} of the Perspicax console. Holds: ${kw.split(" ").join(", ")}.`,
    source: "console/src/lib/settings-pages.ts",
  });
}

// Docs written for people and integrators.
for (const path of ["docs/sagax.md", "docs/mcp-surface.md", "docs/memory.md", "docs/flow-actions.md", "docs/account-deletion.md", "docs/email.md", "docs/data-access-policy.md", "README.md"]) {
  if (!files.includes(path)) continue;
  for (const section of docSections({ path, markdown: show(path), kind: "perspicax", prefix: "px:doc", fallbackTitle: `Perspicax ${path}`, maxLevel: 2 })) {
    sections.push({ ...section, title: section.title.startsWith("Perspicax") ? section.title : `Perspicax: ${section.title}`, source: `Perspicax ${path}` });
  }
}

// The last release notes, French files only (an .en.md twin says the same).
const versions = files.filter((path) => /^docs\/releases\/\d+\.\d+\.\d+\.md$/.test(path)).map((path) => path.replace(/^docs\/releases\/|\.md$/g, ""));
versions.sort((a, b) => b.split(".").map(Number).reduce((acc, part, at) => acc || part - Number(a.split(".")[at]), 0));
for (const version of versions.slice(0, 8)) {
  const markdown = show(`docs/releases/${version}.md`);
  for (const section of docSections({ path: `docs/releases/${version}.md`, markdown, kind: "perspicax", prefix: "px:release", fallbackTitle: `Perspicax ${version}` })) {
    if (/installation|install|mise à niveau|upgrade|checksums?/i.test(section.title.split(": ").pop() ?? "")) continue;
    sections.push({ ...section, id: `px:release:${version}#${section.id.split("#")[1]}`, title: `Perspicax ${version}: ${section.title.includes(": ") ? section.title.slice(section.title.indexOf(": ") + 2) : section.title}`, source: `Perspicax docs/releases/${version}.md` });
  }
}

const cargo = show("Cargo.toml");
const version = /^version = "([^"]+)"/m.exec(cargo)?.[1] ?? versions[0] ?? "unknown";
const commit = git("rev-parse", "--short=8", ref).trim();
const date = git("show", "-s", "--format=%cs", ref).trim();
const byId = new Map<string, KnowledgeSection>();
for (const section of sections) if (!byId.has(section.id)) byId.set(section.id, scrub(section));
const snapshot: PerspicaxSnapshot = { version, commit, date, sections: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) };
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
writeFileSync(join(root, PERSPICAX_SNAPSHOT_FILE), `{\n  "version": ${JSON.stringify(version)},\n  "commit": ${JSON.stringify(commit)},\n  "date": ${JSON.stringify(date)},\n  "sections": [\n${snapshot.sections.map((section) => `    ${JSON.stringify(section)}`).join(",\n")}\n  ]\n}\n`);
console.log(`${PERSPICAX_SNAPSHOT_FILE}: Perspicax ${version} (${commit}, ${date}), ${snapshot.sections.length} sections.`);
