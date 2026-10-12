import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudAgentCredentialStore } from "./credentials.ts";
import { CloudAgentManager } from "./manager.ts";
import { CloudAgentStore } from "./store.ts";
import type { CloudAgentProviderAdapter } from "./providers/types.ts";

const vaultKey = Buffer.alloc(32, 7);

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), "sagax-cloud-agents-"));
}

function stubProvider(overrides: Partial<CloudAgentProviderAdapter> = {}): CloudAgentProviderAdapter {
  return {
    id: "cursor",
    label: "Cursor",
    testToken: vi.fn(async () => {}),
    launch: vi.fn(async () => ({
      externalId: "bc-1",
      name: "Job",
      status: "RUNNING",
      latestRunId: "run-1",
      url: "https://cursor.com/agents/bc-1",
    })),
    refresh: vi.fn(async () => ({ status: "FINISHED", result: "Done." })),
    followUp: vi.fn(async () => ({ status: "RUNNING" })),
    cancel: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    listArtifacts: vi.fn(async () => []),
    transcript: vi.fn(async () => []),
    findByPr: vi.fn(async () => null),
    ...overrides,
  };
}

describe("CloudAgentManager", () => {
  let dataDir = "";

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    dataDir = "";
  });

  it("launches and fires completion once when a run finishes", async () => {
    dataDir = tempDataDir();
    const store = new CloudAgentStore(dataDir);
    const credentials = new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: vaultKey }));
    credentials.set("pr_test", "cursor", "tok_test");
    const provider = stubProvider();
    const onComplete = vi.fn();
    const manager = new CloudAgentManager({
      store,
      credentials,
      providers: new Map([["cursor", provider]]),
      now: () => 1_000,
      onComplete,
    });
    const record = await manager.launch({
      botId: "bot-1",
      threadId: "thread-1",
      principalId: "pr_test",
      launch: { provider: "cursor", prompt: "Ship it" },
    });
    expect(record.externalId).toBe("bc-1");
    await manager.refresh(record.id);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].summary).toContain("Done.");
    await manager.refresh(record.id);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("queues follow-up while a run is active", async () => {
    dataDir = tempDataDir();
    const store = new CloudAgentStore(dataDir);
    const credentials = new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: vaultKey }));
    credentials.set("pr_test", "cursor", "tok_test");
    const provider = stubProvider({
      refresh: vi.fn(async () => ({ status: "RUNNING" })),
    });
    const manager = new CloudAgentManager({
      store,
      credentials,
      providers: new Map([["cursor", provider]]),
    });
    const record = await manager.launch({
      botId: "bot-1",
      threadId: "thread-1",
      principalId: "pr_test",
      launch: { provider: "cursor", prompt: "First" },
    });
    const queued = await manager.followUp(record.id, "pr_test", { text: "Also do X", mode: "queue" });
    expect(queued.pendingFollowUp?.text).toBe("Also do X");
    expect(provider.followUp).not.toHaveBeenCalled();
  });
});
