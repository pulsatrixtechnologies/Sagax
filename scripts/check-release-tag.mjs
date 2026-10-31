// A Sagax release tag (pulsa-vX.Y.Z) must point at a commit that is already
// an ancestor of origin/main. Tagging the tip of a release branch before its
// squash lands on main leaves the tag off main's history: tools that walk
// commits or PRs since the previous tag then put mid-flight merges into the
// next version (issue #1709, pulsa-v0.8.17).
//
// Run after the release PR is squash-merged, on that squash commit, before
// `gh release create` (docs/releasing.md step 5).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 * @returns {string}
 */
function defaultGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * @param {{
 *   commit?: string,
 *   base?: string,
 *   cwd?: string,
 *   git?: (args: string[], options?: { cwd?: string }) => string,
 * }} [input]
 * @returns {{ ok: true, commit: string, base: string } | { ok: false, message: string }}
 */
export function checkReleaseTag({
  commit = "HEAD",
  base = "origin/main",
  cwd,
  git = defaultGit,
} = {}) {
  const run = (args) => {
    try {
      return git(args, { cwd });
    } catch (error) {
      const detail = error && typeof error === "object" && "stderr" in error
        ? String(error.stderr || error.message || error).trim()
        : String(error);
      throw new Error(detail || `git ${args.join(" ")} failed`);
    }
  };

  let resolvedCommit;
  let resolvedBase;
  try {
    resolvedCommit = run(["rev-parse", `${commit}^{commit}`]);
  } catch (error) {
    return {
      ok: false,
      message: `Cannot tag: could not resolve commit ${JSON.stringify(commit)} (${error.message}).`,
    };
  }
  try {
    resolvedBase = run(["rev-parse", `${base}^{commit}`]);
  } catch (error) {
    return {
      ok: false,
      message: `Cannot tag: could not resolve ${base} (${error.message}). Fetch main first: git fetch origin main.`,
    };
  }
  if (!FULL_SHA.test(resolvedCommit) || !FULL_SHA.test(resolvedBase)) {
    return {
      ok: false,
      message: `Cannot tag: git returned an unexpected sha for ${commit} or ${base}.`,
    };
  }

  let ancestor;
  try {
    run(["merge-base", "--is-ancestor", resolvedCommit, resolvedBase]);
    ancestor = true;
  } catch {
    ancestor = false;
  }
  if (!ancestor) {
    return {
      ok: false,
      message: [
        `Cannot tag: ${resolvedCommit} is not an ancestor of ${base} (${resolvedBase}).`,
        "Squash-merge the release PR into main first, check out that squash commit, then tag it.",
        "Tagging the release branch tip before the squash leaves pulsa-vX.Y.Z off main's history",
        "so mid-flight merges are counted in the next version (issue #1709).",
      ].join(" "),
    };
  }
  return { ok: true, commit: resolvedCommit, base: resolvedBase };
}

function main(argv = process.argv.slice(2)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const commit = argv[0] && !argv[0].startsWith("-") ? argv[0] : "HEAD";
  const baseFlag = argv.indexOf("--base");
  const base = baseFlag >= 0 && argv[baseFlag + 1] ? argv[baseFlag + 1] : "origin/main";
  const result = checkReleaseTag({ commit, base, cwd: root });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(`${result.commit} is an ancestor of ${base} (${result.base})`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) main();
