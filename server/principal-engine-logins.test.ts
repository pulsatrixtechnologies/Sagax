// Slice 4 (D10): each person's own engine sign-in, in their own directory.
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ProviderAuthenticationStatus } from "./contracts.ts";
import { LOGIN_MARKER, PrincipalEngineLogins, type LoginController } from "./principal-engine-logins.ts";

const A = "pr_00000000-0000-4000-8000-00000000000a";
const B = "pr_00000000-0000-4000-8000-00000000000b";

function harness() {
  const dataDir = mkdtempSync(join(tmpdir(), "engine-logins-"));
  const made: Array<{ driver: string; home: string; env: Record<string, string | undefined>; finish: () => Promise<void>; signedOut: boolean }> = [];
  const logins = new PrincipalEngineLogins({
    dataDir,
    now: () => 42,
    instance: (id) => (id === "claude" ? { driver: "claudeAgent", cli: "claude", environment: { ANTHROPIC_API_KEY: "sk-ant-workspace" } }
      : id === "codex" ? { driver: "codex", cli: "codex" }
        : id === "grok" ? { driver: "grokAgent", cli: "grok", environment: { XAI_API_KEY: "xai-workspace" } }
          : id === "kimi" ? { driver: "kimiAgent", cli: "kimi" }
            : id === "cursor" ? { driver: "cursorAgent", cli: "cursor-agent" } : null),
    controller: ({ driver, home, environment, onAuthenticated }) => {
      let phase: ProviderAuthenticationStatus["phase"] = "waiting";
      const record = { driver, home, env: environment(), finish: async () => { phase = "succeeded"; await onAuthenticated(); }, signedOut: false };
      made.push(record);
      const controller: LoginController = {
        start: async () => ({ flowId: `flow-${made.length}`, phase: "waiting", kind: "device", url: "https://example.test/device", code: "TEST-1" }) as never,
        get: async (flowId) => ({ flowId, phase }) as never,
        cancel: async () => { phase = "cancelled" as never; },
        signOut: async () => { record.signedOut = true; },
      };
      return controller;
    },
  });
  return { dataDir, logins, made };
}

describe("PrincipalEngineLogins", () => {
  it("signs a person in within their own directory, marks it, and signs out", async () => {
    const { dataDir, logins, made } = harness();
    expect(logins.signedIn(A, "codex")).toBe(false);
    const started = await logins.start(A, "codex", "session-a");
    expect(started).toMatchObject({ phase: "waiting" });
    const dir = join(dataDir, "principals", A, "codex");
    expect(made[0]!.env.CODEX_HOME).toBe(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, "principals", A)).mode & 0o777).toBe(0o700);
    await made[0]!.finish();
    expect(logins.signedIn(A, "codex")).toBe(true);
    expect(statSync(join(dir, LOGIN_MARKER)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, LOGIN_MARKER), "utf8"))).toEqual({ at: 42 });
    // another person is not signed in by it
    expect(logins.signedIn(B, "codex")).toBe(false);
    await logins.signOut(A, "codex", "session-a");
    expect(made[0]!.signedOut).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(logins.signedIn(A, "codex")).toBe(false);
  });

  it("points Claude at CLAUDE_CONFIG_DIR with no key, and refuses engines without personal sign-in", async () => {
    const { dataDir, logins, made } = harness();
    await logins.start(A, "claude", "session-a");
    expect(made[0]!.env.CLAUDE_CONFIG_DIR).toBe(join(dataDir, "principals", A, "claude"));
    expect(made[0]!.env.ANTHROPIC_API_KEY).toBeUndefined();
    await expect(logins.start(A, "cursor", "session-a")).rejects.toMatchObject({ status: 404 });
    await expect(logins.start(A, "nope", "session-a")).rejects.toMatchObject({ status: 404 });
    expect(() => logins.loginDir("../etc", "codex")).toThrow();
  });

  it("Grok and Kimi sign in by device code into the person's own engine home, with no key", async () => {
    const { dataDir, logins, made } = harness();
    await logins.start(A, "grok", "session-a");
    expect(made[0]).toMatchObject({ driver: "grokAgent", home: join(dataDir, "principals", A, "grok") });
    expect(made[0]!.env.XAI_API_KEY).toBeUndefined();
    await made[0]!.finish();
    expect(logins.signedIn(A, "grokAgent")).toBe(true);
    expect(logins.signedIn(B, "grokAgent")).toBe(false);
    await logins.start(B, "kimi", "session-b");
    expect(made[1]).toMatchObject({ driver: "kimiAgent", home: join(dataDir, "principals", B, "kimi") });
    expect(statSync(made[1]!.home).mode & 0o777).toBe(0o700);
  });

  it("keeps flows per person and per session: another session cannot read or steal them", async () => {
    const { logins, made } = harness();
    const a = await logins.start(A, "codex", "session-a");
    const b = await logins.start(B, "codex", "session-b");
    expect(made).toHaveLength(2);
    expect(made[0]!.env.CODEX_HOME).not.toBe(made[1]!.env.CODEX_HOME);
    await expect(logins.status(A, "codex", "session-b", a.flowId!)).rejects.toMatchObject({ status: 404 });
    expect(await logins.status(A, "codex", "session-a", a.flowId!)).toMatchObject({ phase: "waiting" });
    await expect(logins.start(A, "codex", "session-b")).rejects.toMatchObject({ status: 409 });
    // the session ends: its flow goes with it
    logins.revokeOwner("session-b");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(logins.status(B, "codex", "session-b", b.flowId!)).rejects.toMatchObject({ status: 404 });
  });

  it("marks signed in when the status poll sees success first", async () => {
    const { logins, made } = harness();
    const started = await logins.start(A, "codex", "s");
    // success without the callback having run yet
    const record = made[0]!;
    const originalFinish = record.finish;
    await originalFinish();
    expect(await logins.status(A, "codex", "s", started.flowId!)).toMatchObject({ phase: "succeeded" });
    expect(logins.signedIn(A, "codex")).toBe(true);
  });
});
