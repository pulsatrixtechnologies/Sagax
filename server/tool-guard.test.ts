import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolGrantStore } from "./tool-grants.ts";
import { guardDecision, toolGuardMode } from "./tool-guard.ts";

const bot = { kind: "bot" as const, id: "bot-1" };
const jc = { kind: "user" as const, id: "pr_jc" };
const admin = { tier: "admin" as const, scope: "agents:admin", readOnly: false, defaultEnabled: false };

describe("tool grants", () => {
  it("grants, persists, covers lower tiers of the same area, expires and revokes", () => {
    let t = 1_000;
    const file = join(mkdtempSync(join(tmpdir(), "grants-")), "tool-grants.json");
    const store = new ToolGrantStore(file, () => t);
    const g = store.grant(bot, "routines:write", "pr_jc", 5_000);
    expect(store.holds(bot, "routines:read")).toBe(true);
    expect(store.holds(bot, "routines:write")).toBe(true);
    expect(store.holds(bot, "routines:admin")).toBe(false);
    expect(store.holds(bot, "files:read")).toBe(false);
    expect(new ToolGrantStore(file, () => t).holds(bot, "routines:write")).toBe(true);
    t = 6_000;
    expect(store.holds(bot, "routines:write")).toBe(false);
    t = 1_000;
    expect(store.revoke(g.id, "pr_jc")).toBe(true);
    expect(store.holds(bot, "routines:write")).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8")).grants[0]).toMatchObject({ revokedBy: "pr_jc" });
    expect(() => store.grant(bot, "Routines", "pr_jc")).toThrow();
  });
});

describe("tool guard", () => {
  it("lets default-enabled reads and writes through; writes need approval", () => {
    const store = new ToolGrantStore(null);
    expect(guardDecision({ tier: "read", scope: "agents:read", readOnly: true, defaultEnabled: true }, bot, jc, store)).toEqual({ allow: true, reason: "default", needsApproval: false });
    expect(guardDecision({ tier: "write", scope: "agents:write", readOnly: false, defaultEnabled: true }, bot, jc, store)).toEqual({ allow: true, reason: "default", needsApproval: true });
  });

  it("keeps admin off without a grant, and a bot never past its speaker", () => {
    const store = new ToolGrantStore(null);
    expect(guardDecision(admin, bot, jc, store)).toMatchObject({ allow: false, reason: "not_granted" });
    store.grant(bot, "agents:admin", "pr_jc");
    expect(guardDecision(admin, bot, jc, store)).toMatchObject({ allow: false, reason: "speaker_not_granted" });
    store.grant(jc, "agents:admin", "pr_jc");
    expect(guardDecision(admin, bot, jc, store)).toEqual({ allow: true, reason: "grant", needsApproval: true });
  });

  it("treats an unknown route (off by default) as needing a grant", () => {
    expect(guardDecision({ tier: "write", scope: "unknown:write", readOnly: false, defaultEnabled: false }, bot, null, new ToolGrantStore(null))).toMatchObject({ allow: false, reason: "not_granted" });
  });

  it("defaults to shadow", () => {
    expect(toolGuardMode(undefined)).toBe("shadow");
    expect(toolGuardMode("enforce")).toBe("enforce");
    expect(toolGuardMode("bogus")).toBe("shadow");
  });
});
