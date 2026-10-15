import { describe, expect, it } from "vitest";

import en from "../locales/en.json";
import fr from "../locales/fr.json";
import { botGrantRequest, grantRequest, grantTier, sortGrants, type ToolGrantRow } from "./tool-grants";

const row = (id: string, state: ToolGrantRow["state"], grantedAt: number, scope = "agents:write"): ToolGrantRow =>
  ({ id, subject: { kind: "bot", id: "b" }, scope, grantedBy: "x", grantedAt, state });

describe("tool grants page model", () => {
  it("lists active grants first, newest first", () => {
    expect(sortGrants([row("a", "revoked", 3), row("b", "active", 1), row("c", "active", 2), row("d", "expired", 4)]).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });
  it("reads the tier from the scope", () => {
    expect(grantTier("org:admin")).toBe("admin");
    expect(grantTier("agents:read")).toBe("read");
  });
  it("has every Tool access string in French", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("settings.toolAccess."));
    expect(keys.length).toBe(27);
    for (const k of keys) expect((fr as Record<string, string>)[k], k).toBeTruthy();
  });
});

describe("grant form (B3c)", () => {
  const now = 1_800_000_000_000;
  it("builds the scope and expiry", () => {
    expect(grantRequest({ botId: "b", area: " Agents ", tier: "write", days: "" }, now)).toEqual({ ok: true, body: { subject: { kind: "bot", id: "b" }, scope: "agents:write" } });
    expect(grantRequest({ botId: "b", area: "org", tier: "admin", days: "7" }, now)).toMatchObject({ ok: true, body: { scope: "org:admin", expiresAt: now + 7 * 86_400_000 } });
  });
  it("refuses what the server would refuse", () => {
    expect(grantRequest({ botId: "", area: "agents", tier: "read", days: "" }, now)).toMatchObject({ ok: false, error: "settings.toolAccess.form.needBot" });
    expect(grantRequest({ botId: "b", area: "a b", tier: "read", days: "" }, now)).toMatchObject({ ok: false, error: "settings.toolAccess.form.badArea" });
    expect(grantRequest({ botId: "b", area: "agents", tier: "read", days: "1.5" }, now)).toMatchObject({ ok: false, error: "settings.toolAccess.form.badDays" });
    expect(grantRequest({ botId: "b", area: "org", tier: "admin", days: "" }, now)).toMatchObject({ ok: false, error: "settings.toolAccess.form.adminDays" });
    expect(grantRequest({ botId: "b", area: "org", tier: "admin", days: "31" }, now)).toMatchObject({ ok: false, error: "settings.toolAccess.form.adminDays" });
  });
});

describe("bot editor grant form (2026-10-15)", () => {
  const now = 1_800_000_000_000;
  it("sends only the scope and the end: the bot is the one open", () => {
    expect(botGrantRequest({ area: "agents", tier: "read", days: "" }, now)).toEqual({ ok: true, body: { scope: "agents:read" } });
    expect(botGrantRequest({ area: "org", tier: "admin", days: "3" }, now)).toEqual({ ok: true, body: { scope: "org:admin", expiresAt: now + 3 * 86_400_000 } });
    expect(botGrantRequest({ area: "a b", tier: "read", days: "" }, now)).toMatchObject({ ok: false, error: "settings.toolAccess.form.badArea" });
    expect(botGrantRequest({ area: "org", tier: "admin", days: "" }, now)).toMatchObject({ ok: false, error: "settings.toolAccess.form.adminDays" });
  });
});
