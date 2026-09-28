// Package the fork line. package.json "version" stays the official base.
// The installer, updater feed, and app.getVersion() use forkVersion.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const target = process.argv[2];
if (target !== "mac" && target !== "win") {
  console.error("usage: node scripts/package-fork.mjs mac|win");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const fork = pkg.forkVersion;
const base = pkg.baseVersion ?? pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(fork ?? "")) {
  console.error("package.json forkVersion must be X.Y.Z");
  process.exit(1);
}

const args = [
  "exec", "electron-builder",
  target === "win" ? "--win" : "--mac",
  "--publish", "never",
  `-c.extraMetadata.version=${fork}`,
  `-c.extraMetadata.baseVersion=${base}`,
];
if (target === "mac") {
  args.push("-c.mac.identity=null", "-c.mac.hardenedRuntime=false", "-c.dmg.sign=false");
}

const result = spawnSync("pnpm", args, {
  stdio: "inherit",
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
});
process.exit(result.status ?? 1);
