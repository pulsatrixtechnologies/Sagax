// sagax-runner on Sagax's real Claude Code and Codex drivers
// (server/drivers/claude.ts, codex.ts) headless, with their fake CLIs
// (server/testing/fake-claude-cli.ts, fake-codex-app-server.ts) and the fake
// Perspicax: proves the runner reuses the drivers as they are (same event
// normalization) and that the engine gets the model proxy, the run token as
// its key, and never a setup_only secret. No network beyond loopback.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../config.ts";
import { FakePerspicax } from "../testing/fake-perspicax-runner.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { realEngineFactory } from "./engine-drivers.ts";
import { ControlClient, controlBase } from "./protocol.ts";
import { runRunner } from "./runner.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-claude-cli.ts");
const FAKE_CODEX = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-codex-app-server.ts");
const TOKEN = "runtok_" + "C".repeat(30) + "_claude";
const SETUP_SECRET = "claude-setup-only-77aa";
const AGENT_SECRET = "claude-agent-visible-88bb";

let root: string;
let fake: FakePerspicax;
const SAVED = ["FAKE_CLAUDE_MODE", "FAKE_CLAUDE_DUMP", "FAKE_CODEX_MODE", "FAKE_CODEX_DUMP"].map((name) => [name, process.env[name]] as const);
let engineName = "claude-code";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
}

beforeEach(() => {
  ensureDirs();
  chmodSync(FAKE_CLI, 0o755);
  chmodSync(FAKE_CODEX, 0o755);
  root = mkdtempSync(join(tmpdir(), "sagax-runner-claude-"));
  const bare = join(root, "origin.git");
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(root, "init", "--quiet", "--bare", "-b", "main", bare);
  git(seed, "init", "--quiet", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# widgets\n");
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "init");
  git(seed, "push", "--quiet", bare, "main");
  fake = new FakePerspicax({
    token: TOKEN,
    bareRepo: bare,
    bootstrap: (base) => ({
      run_id: "runclaude01", env_id: "envclaude01", title: "Say hello", prompt: "Say hello", engine: engineName,
      model: engineName === "codex" ? "gpt-test" : null, effort: null, repo: { owner: "acme", name: "widgets" }, base_branch: "main", branch: "px/hello-cd34",
      existing_branch: false, setup: 'test -n "$SETUP_TOKEN" && echo setup-ran', verify: [],
      git_url: `${base}/api/v1/agents/runner/git/acme/widgets.git`,
      model_proxy: { anthropic: `${base}/api/v1/agents/model-proxy/anthropic`, openai: `${base}/api/v1/agents/model-proxy/openai` },
      followup: null, resume: null, limits: { max_duration_sec: 600 },
    }),
    secrets: [
      { name: "SETUP_TOKEN", value: SETUP_SECRET, setup_only: true },
      { name: "AGENT_TOKEN", value: AGENT_SECRET, setup_only: false },
    ],
  });
});

afterEach(async () => {
  await fake.close();
  for (const [name, value] of SAVED) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  engineName = "claude-code";
  removeTempDir(root);
});

async function start() {
  await fake.start();
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const result = runRunner({
    client: new ControlClient({ base: controlBase(fake.base), token: TOKEN, timeoutMs: 10_000 }),
    token: TOKEN,
    engineFactory: realEngineFactory({ claudeCli: FAKE_CLI, codexCli: FAKE_CODEX }),
    workspace,
    secretsDir: join(root, "shm", "px-secrets"),
    stateDir: join(root, "state"),
    env: { PATH: process.env.PATH, HOME: workspace },
    pollWaitSec: 1,
    relayFlushDelayMs: 10,
    log: () => undefined,
  });
  return { result, workspace };
}

describe("sagax-runner on the real drivers (fake CLIs)", () => {
  it("runs a turn through the real driver and relays its normalized events", async () => {
    process.env.FAKE_CLAUDE_MODE = "happy";
    const dump = join(root, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const { result, workspace } = await start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle", 60_000);
    const assistant = fake.events.filter((e) => e.kind === "message" && e.data.role === "assistant");
    expect(assistant.length).toBeGreaterThan(0);
    expect(fake.events.some((e) => e.kind === "session")).toBe(true);

    const launched = JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string>; cwd: string };
    expect(launched.env.ANTHROPIC_BASE_URL).toBe(fake.modelProxy.anthropic);
    expect(launched.env.ANTHROPIC_API_KEY).toBe(TOKEN);
    expect(launched.env.AGENT_TOKEN).toBe(AGENT_SECRET);
    expect(launched.env.SETUP_TOKEN).toBeUndefined();
    expect(JSON.stringify(launched.env)).not.toContain(SETUP_SECRET);
    expect(realpathSync(launched.cwd)).toBe(realpathSync(join(workspace, "repo")));

    fake.push("stop");
    expect((await result).exit).toBe("stopped");
    expect(fake.states()).toEqual(["setup", "running", "idle", "finished"]);
    expect(JSON.stringify(fake.events)).not.toContain(TOKEN);
  }, 90_000);

  it("runs Codex on the driver's Company provider pointed at the model proxy", async () => {
    engineName = "codex";
    process.env.FAKE_CODEX_MODE = "happy";
    const dump = join(root, "codex-dump.json");
    process.env.FAKE_CODEX_DUMP = dump;
    const { result } = await start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle", 60_000);
    expect(fake.events.some((e) => e.kind === "message" && e.data.role === "assistant")).toBe(true);
    const launched = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; env: Record<string, string> };
    const argv = launched.argv.join(" ");
    expect(argv).toContain(`model_providers.openmaus_company.base_url=${JSON.stringify(`${fake.modelProxy.openai}/v1`)}`);
    expect(argv).not.toContain(TOKEN);
    expect(launched.env.SAGAX_COMPANY_API_KEY).toBe(TOKEN);
    expect(launched.env.SETUP_TOKEN).toBeUndefined();
    expect(JSON.stringify(launched.env)).not.toContain(SETUP_SECRET);
    fake.push("stop");
    expect((await result).exit).toBe("stopped");
    expect(JSON.stringify(fake.events)).not.toContain(TOKEN);
  }, 90_000);
});
