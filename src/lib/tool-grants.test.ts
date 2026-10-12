import { describe, expect, it } from "vitest";

import en from "../locales/en.json";
import fr from "../locales/fr.json";
import { grantTier, sortGrants, type ToolGrantRow } from "./tool-grants";

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
    expect(keys.length).toBe(11);
    for (const k of keys) expect((fr as Record<string, string>)[k], k).toBeTruthy();
  });
});
