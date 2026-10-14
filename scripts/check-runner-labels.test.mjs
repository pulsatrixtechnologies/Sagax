import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-runner-labels.mjs", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./testing/runner-guard-fixtures/${name}`, import.meta.url));
const guard = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

describe("check-runner-labels", () => {
  it.each(["hosted", "hosted-matrix"])("passes %s", (name) => {
    const r = guard(fixture(name));
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toMatch(/every job uses a GitHub-hosted runner/);
  });

  it.each([
    ["self-hosted", /uses a self-hosted label/],
    ["unknown-runner", /not a GitHub-hosted label/],
    ["foo-latest", /not a GitHub-hosted label/],
  ])("fails %s", (name, expected) => {
    const r = guard(fixture(name));
    expect(r.status, r.stderr + r.stdout).toBe(1);
    expect(r.stderr).toMatch(expected);
  });

  it("repository workflows use only GitHub-hosted runners", () => {
    const r = guard(fileURLToPath(new URL("../.github/workflows", import.meta.url)));
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toMatch(/every job uses a GitHub-hosted runner/);
  });
});
