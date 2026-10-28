// Keys of en.json that no shipped source reads, as a literal or as a
// template on an ancestor (`prefix.${...}`, "prefix." + ...). The list is a
// ratchet: a new unread key fails the test. It is not a deletion list.
// Dynamic keys the scan cannot see stay here on purpose.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "server", "electron", "shared", "companion", "scripts"];

export function unreadLocaleKeys(repo) {
  const en = JSON.parse(readFileSync(join(repo, "src/locales/en.json"), "utf8"));
  const literals = new Set();
  const prefixes = new Set();
  const literal = /["'`]([^"'`\n]{1,200})["'`]/g;
  const template = /`([A-Za-z0-9_.]+)\$\{/g;
  const plus = /["']([A-Za-z0-9_.]+)["']\s*\+/g;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "locales" || name === "dist" || name === "release") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|mjs|js)$/.test(name) && !name.endsWith(".d.ts") && name !== "unused-keys.mjs") files.push(path);
    }
  };
  for (const dir of ROOTS) {
    try { walk(join(repo, dir)); } catch { /* a checkout without that tree */ }
  }
  for (const path of files) {
    const code = readFileSync(path, "utf8");
    for (const match of code.matchAll(literal)) {
      if (!match[1].includes("${")) literals.add(match[1]);
    }
    for (const match of code.matchAll(template)) prefixes.add(match[1]);
    for (const match of code.matchAll(plus)) prefixes.add(match[1]);
  }
  const unread = [];
  for (const key of Object.keys(en)) {
    if (literals.has(key)) continue;
    let covered = false;
    const parts = key.split(".");
    for (let i = 1; i < parts.length; i += 1) {
      const parent = `${parts.slice(0, i).join(".")}.`;
      if (prefixes.has(parent) || literals.has(parent)) { covered = true; break; }
    }
    if (!covered) unread.push(key);
  }
  unread.sort();
  return unread;
}

const here = new URL(".", import.meta.url);
if (process.argv[2] === "--write") {
  const repo = new URL("../..", here).pathname;
  const keys = unreadLocaleKeys(repo);
  writeFileSync(new URL("./unused-keys.allow.txt", here), `${keys.join("\n")}\n`);
  console.log(`wrote ${keys.length}`);
}
