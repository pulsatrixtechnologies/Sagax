// Writes server/self-knowledge/knowledge.generated.json (sagax_help).
//   node --experimental-strip-types scripts/self-knowledge/generate.ts          write it
//   node --experimental-strip-types scripts/self-knowledge/generate.ts --check  exit 1 when stale
// Run by `pnpm build:server` (so every build and release carries a fresh
// base) and by hand after a change to the tools, Settings, docs or notes.
// The day in the file moves only when the content changes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKnowledge, KNOWLEDGE_FILE } from "./build.ts";
import type { KnowledgeBase } from "../../server/self-knowledge-types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const path = join(root, KNOWLEDGE_FILE);
const today = new Date().toISOString().slice(0, 10);
const previous: KnowledgeBase | null = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const fresh = buildKnowledge(root, today);
const base = previous && previous.hash === fresh.hash && previous.version === fresh.version ? { ...fresh, generated: previous.generated } : fresh;

/** One section per line: a change reads as a change of a few lines. */
export function serializeKnowledge(kb: KnowledgeBase): string {
  const { sections, ...head } = kb;
  return `{\n${Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join("\n")}\n  "sections": [\n${sections.map((section) => `    ${JSON.stringify(section)}`).join(",\n")}\n  ]\n}\n`;
}

const text = serializeKnowledge(base);
if (process.argv.includes("--check")) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current !== text) {
    console.error(`${KNOWLEDGE_FILE} is stale: run node --experimental-strip-types scripts/self-knowledge/generate.ts`);
    process.exit(1);
  }
  console.log(`${KNOWLEDGE_FILE} is up to date (${base.sections.length} sections, ${base.hash}).`);
} else {
  writeFileSync(path, text);
  console.log(`${KNOWLEDGE_FILE}: ${base.sections.length} sections, ${Math.round(text.length / 1024)} KiB, ${base.hash}, ${base.generated}.`);
}
