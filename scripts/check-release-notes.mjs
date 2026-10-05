// A Sagax release tag (pulsa-vX.Y.Z) is the GitHub release whose body is
// docs/releases/<forkVersion>.md. Packaging and the fork release workflow
// refuse to continue when that file is missing or has no English section.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = /^\d+\.\d+\.\d+$/;
const ENGLISH = /^## English[ \t]*$/m;

export function releaseNotesFile(root, version) {
  return join(root, "docs", "releases", `${version}.md`);
}

/**
 * @param {{ root: string, version: string, exists?: (file: string) => boolean, read?: (file: string) => string }} input
 * @returns {{ ok: true, file: string } | { ok: false, message: string }}
 */
export function checkReleaseNotes({ root, version, exists = existsSync, read = (file) => readFileSync(file, "utf8") }) {
  const got = version == null || version === "" ? "nothing" : String(version);
  if (!VERSION.test(got)) {
    return {
      ok: false,
      message: `package.json forkVersion must be X.Y.Z before a release can be tagged (got ${JSON.stringify(version ?? "")}).`,
    };
  }
  const file = releaseNotesFile(root, got);
  const label = `docs/releases/${got}.md`;
  if (!exists(file)) {
    return {
      ok: false,
      message: `Cannot tag pulsa-v${got}: ${label} is missing. Write the release notes (French first, then a "## English" section) and run this again.`,
    };
  }
  const body = read(file).replace(/\r\n/g, "\n");
  const match = ENGLISH.exec(body);
  if (!match) {
    return {
      ok: false,
      message: `Cannot tag pulsa-v${got}: ${label} has no "## English" section. The app shows that section in every language except French.`,
    };
  }
  if (!body.slice(0, match.index).trim()) {
    return {
      ok: false,
      message: `Cannot tag pulsa-v${got}: ${label} has no French notes before "## English".`,
    };
  }
  return { ok: true, file };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const result = checkReleaseNotes({ root, version: pkg.forkVersion });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) main();
