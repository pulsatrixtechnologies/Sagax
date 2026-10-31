import { describe, expect, it } from "vitest";
import { checkReleaseTag } from "./check-release-tag.mjs";

const MAIN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ON_MAIN = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OFF_MAIN = "cccccccccccccccccccccccccccccccccccccccc";

function gitStub(map, options = {}) {
  const fail = options.fail ?? new Set();
  return (args) => {
    const key = args.join(" ");
    if (fail.has(key)) {
      const error = new Error(`failed: ${key}`);
      error.stderr = `fatal: ${key}`;
      throw error;
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD^{commit}") return map.head;
    if (args[0] === "rev-parse" && args[1] === "origin/main^{commit}") return map.main;
    if (args[0] === "rev-parse" && typeof args[1] === "string" && args[1].endsWith("^{commit}")) {
      const name = args[1].slice(0, -"^{commit}".length);
      if (map[name]) return map[name];
    }
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      const commit = args[2];
      if (map.ancestors?.includes(commit)) return "";
      const error = new Error("not an ancestor");
      error.stderr = "";
      throw error;
    }
    throw new Error(`unexpected git ${key}`);
  };
}

describe("checkReleaseTag", () => {
  it("accepts a commit that is already an ancestor of origin/main", () => {
    const result = checkReleaseTag({
      git: gitStub({
        head: ON_MAIN,
        main: MAIN,
        ancestors: [ON_MAIN, MAIN],
      }),
    });
    expect(result).toEqual({ ok: true, commit: ON_MAIN, base: MAIN });
  });

  it("refuses a release-branch tip that is not on main's history", () => {
    const result = checkReleaseTag({
      git: gitStub({
        head: OFF_MAIN,
        main: MAIN,
        ancestors: [MAIN],
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(OFF_MAIN);
    expect(result.message).toContain("not an ancestor of origin/main");
    expect(result.message).toContain("Squash-merge the release PR into main first");
    expect(result.message).toContain("issue #1709");
  });

  it("tells the operator to fetch when origin/main is missing", () => {
    const result = checkReleaseTag({
      git: gitStub(
        { head: ON_MAIN, main: MAIN },
        { fail: new Set(["rev-parse origin/main^{commit}"]) },
      ),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("git fetch origin main");
  });

  it("checks an explicit commit against a custom base", () => {
    const other = "dddddddddddddddddddddddddddddddddddddddd";
    const result = checkReleaseTag({
      commit: other,
      base: "origin/release",
      git: gitStub({
        [other]: other,
        "origin/release": MAIN,
        ancestors: [other],
      }),
    });
    expect(result).toEqual({ ok: true, commit: other, base: MAIN });
  });
});
