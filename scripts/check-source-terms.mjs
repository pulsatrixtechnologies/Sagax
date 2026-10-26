// The npm package scan (scripts/build-npm-package.mjs) refuses a package that
// carries a forbidden term, but only after a full build, on a release tag.
// This runs the same scan, with the same tables and allowlist, on the tracked
// source that ends up in the package with its comments intact (server/ and
// shared/, compiled to dist-server by tsc, and skills/), so a comment or a
// string that names a person or an internal bot fails locally (pre-push)
// instead of on the tag. src/ is not scanned: the web build strips comments,
// and only the built bundle (the package scan) shows what is left.
//
//   node scripts/check-source-terms.mjs
//
// Tests and fixtures are not shipped and are not scanned. The list of given
// The allowlist names built files, so a source file is scanned under the
// path it has in the package (dist-server/ for server/ and shared/).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllowlist, scanText } from "./npm-package-terms.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED = ["server", "shared", "skills"];
// tsc emits only .ts; the skills ship as they are.
const TEXT = (file) => (file.startsWith("skills/") ? /\.(?:md|json|ya?ml|txt|mjs|js|ts|py|sh)$/i.test(file) : /\.tsx?$/.test(file));
const SKIPPED = /(?:\.test\.|\.e2e\.|\.node-test\.|\.generated\.|\/testing\/|\/__tests__\/)/;

const files = execFileSync("git", ["ls-files", "-z", "--", ...SHIPPED], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter((file) => file && TEXT(file) && !SKIPPED.test(file));

const packed = (file) => (file.startsWith("server/") || file.startsWith("shared/") ? `dist-server/${file}` : file).replace(/\.tsx?$/, ".js");
const allowlist = loadAllowlist(join(root, "scripts", "npm-package-allowlist.json"));
let blocked = 0;
for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  if (text.includes("\0")) continue;
  for (const hit of scanText(text, allowlist, packed(file))) {
    if (hit.allowedBy) continue;
    blocked++;
    // The context is masked by the scan (first letter, then asterisks), never the word.
    console.error(`${file}: ${hit.term} in ...${hit.context.replace(/\s+/g, " ")}...`);
  }
}
if (blocked) {
  console.error(`source term scan: ${blocked} forbidden term(s); neutralize the source or justify them in scripts/npm-package-allowlist.json`);
  process.exit(1);
}
console.log(`source term scan clean (${files.length} files)`);
