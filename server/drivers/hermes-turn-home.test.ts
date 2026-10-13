import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { hermesTurnHome } from "./host-tools.ts";

const WITNESS = "witness-glm-not-secret";
const SENTINEL = "FIXTURE_SENTINEL_NOT_A_KEY=1";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function home(): { root: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), "hermes-turn-"));
  dirs.push(root);
  const source = join(root, "user-hermes");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "config.yaml"), "model:\n  default: fixture\n", { mode: 0o600 });
  writeFileSync(join(source, ".env"), `${SENTINEL}\nOPENROUTER_API_KEY=${WITNESS}\n`, { mode: 0o600 });
  return { root, source };
}

describe("hermesTurnHome", () => {
  it("writes a regular private dotenv and never reads the source .env", () => {
    const { root, source } = home();
    const env: Record<string, string | undefined> = {};
    hermesTurnHome(env, {
      withhold: false,
      sourceHome: source,
      envText: `GLM_API_KEY=${WITNESS}\n`,
      dataDir: root,
    });
    const privateEnv = join(env.HERMES_HOME!, ".env");
    const stat = lstatSync(privateEnv);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);
    const text = readFileSync(privateEnv, "utf8");
    expect(text).toBe(`GLM_API_KEY=${WITNESS}\n`);
    expect(text).not.toContain("FIXTURE_SENTINEL");
    expect(text).not.toContain("OPENROUTER_API_KEY");
    expect(readFileSync(join(source, ".env"), "utf8")).toContain(SENTINEL);
    expect(readFileSync(join(env.HERMES_HOME!, "config.yaml"), "utf8")).toContain("default: fixture");
  });

  it("replaces a symlinked .env instead of following it", () => {
    const { root, source } = home();
    const leaked = join(root, "leaked.env");
    writeFileSync(leaked, "LEAKED=1\n");
    const env: Record<string, string | undefined> = {};
    hermesTurnHome(env, { withhold: false, sourceHome: source, envText: "", dataDir: root });
    symlinkSync(leaked, join(env.HERMES_HOME!, ".env"));
    hermesTurnHome(env, {
      withhold: false,
      sourceHome: source,
      envText: `ZAI_API_KEY=${WITNESS}\n`,
      dataDir: root,
    });
    const privateEnv = join(env.HERMES_HOME!, ".env");
    expect(lstatSync(privateEnv).isSymbolicLink()).toBe(false);
    expect(readFileSync(privateEnv, "utf8")).toBe(`ZAI_API_KEY=${WITNESS}\n`);
    expect(readFileSync(leaked, "utf8")).toBe("LEAKED=1\n");
  });
});
