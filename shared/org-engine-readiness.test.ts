import { describe, expect, it } from "vitest";
import { accessWorksForChat, orgAdminNames, orgEngineReadiness, type ReadinessAccess } from "./org-engine-readiness.ts";

const admitted = { withholdsHostTools: true };
const instances = [
  { instanceId: "claude", driverKind: "claudeAgent", capabilities: admitted },
  { instanceId: "codex", driverKind: "codex", capabilities: admitted },
  { instanceId: "grok", driverKind: "grokAgent", capabilities: admitted },
  { instanceId: "droid", driverKind: "droidAgent", capabilities: {} },
];
const access = (instanceId: string, driver: string, patch: Partial<ReadinessAccess> = {}): ReadinessAccess => ({
  instanceId, driver, installed: true, subscription: { supported: ["claudeAgent", "codex", "grokAgent"].includes(driver), signedIn: false }, myTurns: "none", ...patch,
});
const none = [access("claude", "claudeAgent"), access("codex", "codex"), access("grok", "grokAgent"), access("droid", "droidAgent")];
const ids = (rows: ReadonlyArray<{ instanceId: string } | { instance: { instanceId: string } }>) => rows.map((row) => ("instance" in row ? row.instance.instanceId : row.instanceId));
const org = (mine: readonly ReadinessAccess[] | null, allowedEngines: string[] | null = null) => ({ organization: true, allowedEngines, mine });

describe("an organization person's engines at first run (2026-10-18)", () => {
  it("solo: always ready, the no-engines screen stays solo's", () => {
    expect(orgEngineReadiness(instances, { organization: false, allowedEngines: [], mine: null }).state).toBe("ready");
  });

  it("waits for the person's engines and for the list before deciding", () => {
    expect(orgEngineReadiness(instances, org(null)).state).toBe("loading");
    expect(orgEngineReadiness([], org(none)).state).toBe("loading");
  });

  it("one engine paid for by the person or the organization: ready, nothing changes", () => {
    const mine = none.map((row) => (row.instanceId === "codex" ? { ...row, myTurns: "org-key" as const } : row));
    const readiness = orgEngineReadiness(instances, org(mine));
    expect(readiness.state).toBe("ready");
    expect(ids(readiness.working)).toEqual(["codex"]);
    const own = none.map((row) => (row.instanceId === "claude" ? { ...row, myTurns: "subscription" as const, subscription: { supported: true, signedIn: true } } : row));
    expect(orgEngineReadiness(instances, org(own)).state).toBe("ready");
  });

  it("engines allowed but none connected: connect, only allowed and admitted engines", () => {
    const readiness = orgEngineReadiness(instances, org(none));
    expect(readiness.state).toBe("connect");
    // Droid cannot withhold its own tools: never offered on an organization server
    expect(ids(readiness.connectable)).toEqual(["claude", "codex", "grok"]);
  });

  it("one row per account: the API-key and plan instances of a driver fold into its first", () => {
    const more = [...instances, { instanceId: "claudeApi", driverKind: "claudeAgent", access: "api", capabilities: admitted }, { instanceId: "chatgpt", driverKind: "codex", capabilities: admitted }];
    const mine = [...none, access("claudeApi", "claudeAgent"), access("chatgpt", "codex")];
    expect(ids(orgEngineReadiness(more, org(mine)).connectable)).toEqual(["claude", "codex", "grok"]);
  });

  it("an engine the admin hid is never offered to connect, even with the person's account on it", () => {
    const mine = none.map((row) => (row.instanceId === "grok" ? { ...row, myTurns: "subscription" as const } : row));
    const readiness = orgEngineReadiness(instances, org(mine, ["claude"]));
    expect(readiness.state).toBe("connect");
    expect(ids(readiness.connectable)).toEqual(["claude"]);
  });

  it("an engine paid by the organization but not given to the person can still be connected with their own account", () => {
    const mine = none.map((row) => (row.instanceId === "claude" ? { ...row, orgKeyNotGiven: true } : row));
    const readiness = orgEngineReadiness(instances, org(mine, ["claude"]));
    expect(readiness.state).toBe("connect");
    expect(ids(readiness.connectable)).toEqual(["claude"]);
  });

  it("the organization's xAI key is voice only: a Grok engine served by it alone does not count", () => {
    const grokOnOrgKey = none.map((row) => (row.instanceId === "grok" ? { ...row, myTurns: "org-key" as const } : row));
    expect(accessWorksForChat(grokOnOrgKey.find((row) => row.instanceId === "grok")!)).toBe(false);
    expect(orgEngineReadiness(instances, org(grokOnOrgKey)).state).toBe("connect");
    // the person's own Grok account does count
    const grokOwn = none.map((row) => (row.instanceId === "grok" ? { ...row, myTurns: "subscription" as const } : row));
    expect(orgEngineReadiness(instances, org(grokOwn)).state).toBe("ready");
  });

  it("nothing allowed, or nothing the person can connect: blocked", () => {
    expect(orgEngineReadiness([], org([], [])).state).toBe("blocked");
    const apiOnly = [{ instanceId: "openai", driverKind: "openai-compat", capabilities: admitted }];
    expect(orgEngineReadiness(apiOnly, org([access("openai", "openai-compat")])).state).toBe("blocked");
    const notInstalled = none.map((row) => ({ ...row, installed: false }));
    expect(orgEngineReadiness(instances, org(notInstalled)).state).toBe("blocked");
  });

  it("names the active admins, never a service account or a disabled one", () => {
    expect(orgAdminNames([
      { name: "Ada", login: "ada", role: "admin", disabled: false },
      { name: "", login: "bob", role: "admin", disabled: false },
      { name: "Bot", login: "svc", role: "admin", disabled: false, service: true },
      { name: "Old", login: "old", role: "admin", disabled: true },
      { name: "Cy", login: "cy", role: "member", disabled: false },
    ])).toEqual(["Ada", "bob"]);
  });
});
