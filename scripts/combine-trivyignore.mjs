#!/usr/bin/env node
// Turn the private exception list (repository secret) into the file the
// image scan reads. An optional public file is still accepted and merged
// in front; this repository does not keep one. Smoke, publish, and the
// signing proof must read the same combined file. Fail closed when the
// private list is missing, blank, or unusable. A comments-only private
// list is valid and ignores nothing. Never print an identifier.
//
//   node scripts/combine-trivyignore.mjs \
//     --private-env TRIVYIGNORE_PRIVATE --out /tmp/trivyignore.ci
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { EMPTY_LIST, parseTrivyignore, redactVulnerabilityIds } from "./trivy-ignore-guard.mjs";

export function parseArgs(argv) {
  const out = { public: "", privateEnv: "", privateFile: "", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[++i];
    if (flag === "--public") out.public = value ?? "";
    else if (flag === "--private-env") out.privateEnv = value ?? "";
    else if (flag === "--private-file") out.privateFile = value ?? "";
    else if (flag === "--out") out.out = value ?? "";
    else throw new Error(`unknown argument: ${flag}`);
    if (!value) throw new Error(`${flag} needs a value`);
  }
  return out;
}

function readPrivate({ privateEnv, privateFile }) {
  if (privateFile) {
    try {
      return readFileSync(privateFile, "utf8");
    } catch {
      return "";
    }
  }
  if (privateEnv) return process.env[privateEnv] ?? "";
  return "";
}

/** Public text first, when any; private ids already listed publicly are dropped. */
export function combineTrivyignore({ publicText, privateText } = {}) {
  const privateRaw = String(privateText ?? "");
  if (!privateRaw.trim()) {
    return { ok: false, errors: ["private exception list is missing"], text: "", publicCount: 0, privateCount: 0, combinedCount: 0 };
  }
  const publicRaw = String(publicText ?? "");
  const pub = publicRaw.trim() ? parseTrivyignore(publicRaw) : { entries: [], errors: [] };
  const priv = parseTrivyignore(privateRaw);
  if (pub.errors.length) {
    return {
      ok: false,
      errors: pub.errors,
      text: "",
      publicCount: pub.entries.length,
      privateCount: 0,
      combinedCount: 0,
    };
  }
  // A configured list may hold zero entries (comments only) when the image
  // needs no private exception: the secret is still required, nothing is masked.
  const privateEmpty = priv.entries.length === 0 && priv.errors.every((e) => e === EMPTY_LIST);
  if (priv.errors.length && !privateEmpty) {
    return {
      ok: false,
      errors: ["private exception list is unusable"],
      text: "",
      publicCount: pub.entries.length,
      privateCount: 0,
      combinedCount: 0,
    };
  }
  const publicIds = new Set(pub.entries.map((row) => row.id));
  const extra = priv.entries.filter((row) => !publicIds.has(row.id));
  const chunks = [];
  const publicBlock = publicRaw.trimEnd();
  if (publicBlock.trim()) chunks.push(publicBlock);
  if (extra.length) {
    const seen = new Set();
    const lines = [];
    for (const raw of privateRaw.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) {
        lines.push(raw);
        continue;
      }
      if (publicIds.has(line) || seen.has(line)) continue;
      seen.add(line);
      lines.push(raw);
    }
    const block = lines.join("\n").trim();
    if (block) chunks.push(block);
  }
  const text = chunks.length ? `${chunks.join("\n\n")}\n` : "\n";
  return {
    ok: true,
    errors: [],
    text,
    publicCount: pub.entries.length,
    privateCount: priv.entries.length,
    combinedCount: pub.entries.length + extra.length,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out || (!args.privateEnv && !args.privateFile)) {
    throw new Error("usage: node scripts/combine-trivyignore.mjs [--public <file>] --private-env <NAME>|--private-file <file> --out <file>");
  }
  const publicText = args.public ? readFileSync(args.public, "utf8") : "";
  const privateText = readPrivate(args);
  const result = combineTrivyignore({ publicText, privateText });
  if (!result.ok) {
    for (const error of result.errors) console.error(`[trivy-ignore] ${redactVulnerabilityIds(error)}`);
    process.exit(1);
  }
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, result.text, { mode: 0o600 });
  chmodSync(args.out, 0o600);
  console.log(
    `[trivy-ignore] combined public=${result.publicCount} private=${result.privateCount} unique=${result.combinedCount}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`[trivy-ignore] ${redactVulnerabilityIds(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  }
}
