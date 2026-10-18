// Perspicax runs end to end against the in-process fake of its API: the
// client (contract of Perspicax PR #372), the provider a bot launches with,
// and the manager's local record of a thread-launched run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startFakePerspicaxAgents, type FakePerspicaxAgents } from "../testing/fake-perspicax-agents.ts";
import { CloudAgentCredentialStore } from "./credentials.ts";
import { CloudAgentManager } from "./manager.ts";
import { PerspicaxAgentsClient } from "./perspicax-client.ts";
import { createPerspicaxProvider, pickEnvironment, repoSlug } from "./providers/perspicax.ts";
import { CloudAgentStore } from "./store.ts";
import type { PerspicaxEnvironment } from "../../shared/cloud-agents.ts";

let fake: FakePerspicaxAgents;
let dataDir = "";

beforeEach(async () => {
  fake = await startFakePerspicaxAgents({ tickMs: 0 });
});

afterEach(async () => {
  await fake.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

const access = () => ({ baseUrl: fake.url, token: fake.token });

describe("PerspicaxAgentsClient", () => {
  it("lists environments and runs with the bearer token", async () => {
    const client = new PerspicaxAgentsClient();
    const envs = await client.environments(access());
    expect(envs.map((env) => env.name)).toEqual(["demo/web-app", "demo/api"]);
    const runs = await client.runs(access(), { mine: true });
    expect(runs.length).toBeGreaterThanOrEqual(6);
    expect(runs.find((run) => run.id === "run_01merged0a3f")?.pr).toMatchObject({ number: 42, state: "merged" });
  });

  it("turns a refused token into a 401 ProviderHttpError without the token in it", async () => {
    const client = new PerspicaxAgentsClient();
    const error = await client.environments({ baseUrl: fake.url, token: "wrong-token-value" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401 });
    expect(String((error as Error).message)).not.toContain("wrong-token-value");
  });

  it("refuses an id that is not a run id before it reaches a path", async () => {
    const client = new PerspicaxAgentsClient();
    await expect(client.run(access(), "../environments")).rejects.toMatchObject({ status: 400 });
  });

  it("creates a run, plays its events and streams them as SSE", async () => {
    const client = new PerspicaxAgentsClient();
    const run = await client.create(access(), { env_id: "env_01demoweb", prompt: "Corrige le bouton", origin: "sagax" });
    expect(run.state).toBe("queued");
    for (let i = 0; i < 20; i++) fake.tick();
    const after = await client.run(access(), run.id);
    expect(after.state).toBe("idle");
    expect(after.pr).toMatchObject({ state: "draft" });
    const events = await client.events(access(), run.id);
    expect(events[0]?.kind).toBe("requested");
    expect(events.map((e) => e.kind)).toContain("tool_call");
    const abort = new AbortController();
    const seen: number[] = [];
    for await (const event of client.stream(access(), run.id, 2, abort.signal)) {
      seen.push(event.seq);
      if (event.seq === events.at(-1)!.seq) abort.abort();
    }
    expect(seen[0]).toBe(3);
    expect(seen.at(-1)).toBe(events.at(-1)!.seq);
  });

  it("reads the diff, commits and files, and follows up", async () => {
    const client = new PerspicaxAgentsClient();
    const diff = await client.diff(access(), "run_01merged0a3f");
    expect(diff.available).toBe(true);
    expect(diff.items.map((file) => file.path)).toEqual(["src/invoices/list.ts", "src/invoices/list.test.ts", "docs/invoices.md"]);
    expect(diff.items[1]).toMatchObject({ status: "added", removed: 0 });
    expect(diff.items[2]?.previewable).toBe(true);
    expect((await client.commits(access(), "run_01merged0a3f")).items).toHaveLength(2);
    expect((await client.files(access(), "run_01merged0a3f")).items.some((f) => f.path === "src/invoices/list.ts")).toBe(true);
    const followed = await client.followUp(access(), "run_02draft00b71", "Ajoute un test de plus", "queue");
    expect(followed.state).toBe("running");
  });
});

describe("pickEnvironment", () => {
  const env = (id: string, owner: string, name: string): PerspicaxEnvironment => ({
    id, name: `${owner}/${name}`, scope: "personnelle", engine_default: "claude-code", model_default: "m",
    repos: [{ provider: "github", owner, name, default_branch: "main" }],
  });

  it("finds the environment by repository URL", () => {
    expect(repoSlug("https://github.com/Demo/Web-App.git")).toBe("demo/web-app");
    expect(pickEnvironment([env("e1", "demo", "web-app"), env("e2", "demo", "api")], { repo: "https://github.com/demo/api" }).id).toBe("e2");
  });

  it("asks when several environments hold the repository", () => {
    expect(() => pickEnvironment([env("e1", "demo", "api"), env("e2", "demo", "api")], { repo: "demo/api" }))
      .toThrow(/Ask the person which one[\s\S]*env_id e1[\s\S]*env_id e2/);
  });

  it("refuses an unknown env_id and a repository no environment holds", () => {
    expect(() => pickEnvironment([env("e1", "demo", "api")], { envId: "nope" })).toThrow(/No Perspicax environment nope/);
    expect(() => pickEnvironment([env("e1", "demo", "api")], { repo: "demo/other" })).toThrow(/No Perspicax environment holds demo\/other/);
  });
});

describe("CloudAgentManager with the perspicax provider", () => {
  const manager = (token: string | null) => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-perspicax-"));
    const store = new CloudAgentStore(dataDir);
    const credentials = new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: Buffer.alloc(32, 7) }));
    const completions: string[] = [];
    const mgr = new CloudAgentManager({
      store,
      credentials,
      providers: new Map([["perspicax", createPerspicaxProvider(fetch, () => fake.url)]]),
      accessToken: async () => token,
      onComplete: (event) => { completions.push(event.summary); },
    });
    return { mgr, completions };
  };

  it("launches from a thread with the sign-in token and mirrors stats and PR", async () => {
    const { mgr } = manager(fake.token);
    const record = await mgr.launch({
      botId: "bot-1",
      threadId: "thread-1",
      principalId: "pr_alice",
      launch: { provider: "perspicax", prompt: "Corrige la pagination", repos: [{ url: "https://github.com/demo/web-app" }] },
    });
    expect(record).toMatchObject({ provider: "perspicax", envId: "env_01demoweb", origin: "sagax", botId: "bot-1", threadId: "thread-1" });
    expect(fake.runs().find((run) => run.id === record.externalId)?.origin).toBe("sagax");
    for (let i = 0; i < 20; i++) fake.tick();
    const synced = await mgr.refresh(record.id);
    expect(synced?.status).toBe("idle");
    expect(synced?.pr).toMatchObject({ state: "draft" });
    expect(synced?.stats?.files).toBeGreaterThan(0);
    expect(synced?.gitBranches[0]?.branch).toMatch(/^px\//);
  });

  it("asks which environment when the repository is missing and several exist", async () => {
    const { mgr } = manager(fake.token);
    await expect(mgr.launch({ botId: "bot-1", threadId: "thread-1", principalId: "pr_alice", launch: { provider: "perspicax", prompt: "x" } }))
      .rejects.toThrow(/Which repository\?/);
  });

  it("keeps a record waiting, not failed, while the person has no live sign-in", async () => {
    let token: string | null = fake.token;
    dataDir = mkdtempSync(join(tmpdir(), "sagax-perspicax-"));
    const store = new CloudAgentStore(dataDir);
    const mgr = new CloudAgentManager({
      store,
      credentials: new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: Buffer.alloc(32, 7) })),
      providers: new Map([["perspicax", createPerspicaxProvider(fetch, () => fake.url)]]),
      accessToken: async () => token,
    });
    const record = await mgr.launch({ botId: "b", threadId: "t", principalId: "p", launch: { provider: "perspicax", prompt: "x", envId: "env_01demoweb" } });
    token = null;
    const after = await mgr.refresh(record.id);
    expect(after?.status).not.toBe("failed");
    await expect(mgr.syncActive()).resolves.toBeUndefined();
  });
});

describe("CloudAgentStore files", () => {
  it("keeps Perspicax runs out of the file an older build parses, and skips a bad row instead of wiping", async () => {
    const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
    dataDir = mkdtempSync(join(tmpdir(), "sagax-store-"));
    const store = new CloudAgentStore(dataDir);
    store.create({ botId: "b", threadId: "t", principalId: "p", provider: "cursor", externalId: "bc-1", name: "A", repos: [] });
    store.create({ botId: "b", threadId: "t", principalId: "p", provider: "perspicax", externalId: "run_1", name: "B", repos: [], status: "queued", envId: "env_1", origin: "sagax" });
    const legacy = JSON.parse(readFileSync(join(dataDir, "cloud-agents", "records.json"), "utf8"));
    expect(legacy.agents.map((a: { provider: string }) => a.provider)).toEqual(["cursor"]);
    const px = JSON.parse(readFileSync(join(dataDir, "cloud-agents", "perspicax-records.json"), "utf8"));
    expect(px.agents.map((a: { provider: string }) => a.provider)).toEqual(["perspicax"]);
    legacy.agents.push({ id: "garbage" });
    writeFileSync(join(dataDir, "cloud-agents", "records.json"), JSON.stringify(legacy));
    const reopened = new CloudAgentStore(dataDir);
    expect(reopened.listAll().map((a) => a.externalId).sort()).toEqual(["bc-1", "run_1"]);
    reopened.patch(reopened.listAll()[0]!.id, { name: "A2" });
    expect(existsSync(join(dataDir, "cloud-agents", "records.json.bak"))).toBe(true);
  });
});
