// B1: every route the server answers has a policy row (server/tool-policy.ts).
// A new route fails here until `node scripts/tool-policy/generate.ts` writes
// its row and the row is reviewed.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routeInventory } from "./route-inventory.ts";
import { classifyRoute, policyFor, policyKey, toolPolicyRows, UNKNOWN_ROUTE_POLICY } from "../../server/tool-policy.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const inventory = routeInventory(root);
const rows = toolPolicyRows();
const keys = new Set(rows.map(policyKey));

describe("tool policy coverage", () => {
  it("finds the server's routes", () => {
    expect(inventory.length).toBeGreaterThan(300);
  });

  it("has a policy row for every route", () => {
    const missing = inventory.filter((r) => !keys.has(policyKey(r))).map((r) => `${policyKey(r)}  (${r.file}:${r.line})`);
    expect(missing, "run: node scripts/tool-policy/generate.ts, then review the new rows").toEqual([]);
  });

  it("has no row for a route that is gone", () => {
    const live = new Set(inventory.map(policyKey));
    expect(rows.filter((r) => !live.has(policyKey(r))).map(policyKey), "run: node scripts/tool-policy/generate.ts").toEqual([]);
  });

  it("declares a tier, readOnly and a scope on every row; admin is never on by default", () => {
    const bad = rows.filter((r) => !["read", "write", "admin"].includes(r.tier) || typeof r.readOnly !== "boolean"
      || !/^[a-z0-9-]+:(read|write|admin)$/.test(r.scope) || (r.tier === "admin" && r.defaultEnabled)
      || ((r.destructive || r.billing) && r.tier !== "admin") || (r.readOnly && r.method !== "GET"));
    expect(bad.map(policyKey)).toEqual([]);
  });

  it("classifies by method and area", () => {
    expect(classifyRoute("GET", "/api/bots")).toMatchObject({ tier: "read", readOnly: true, scope: "bots:read", defaultEnabled: true });
    expect(classifyRoute("POST", "/api/bots")).toMatchObject({ tier: "write", readOnly: false });
    expect(classifyRoute("ANY", "/api/routines")).toMatchObject({ tier: "write", readOnly: false });
    expect(classifyRoute("DELETE", "/api/routines/")).toMatchObject({ tier: "admin", destructive: true, defaultEnabled: false });
    expect(classifyRoute("GET", "/api/org/members")).toMatchObject({ tier: "admin", defaultEnabled: false });
    expect(classifyRoute("POST", "^\\/api\\/billing\\/checkout$")).toMatchObject({ tier: "admin", billing: true, defaultEnabled: false });
  });

  it("treats an unknown route as a write, off by default", () => {
    expect(policyFor("GET", "/api/definitely-not-a-route")).toEqual({ ...UNKNOWN_ROUTE_POLICY, matched: false });
    expect(UNKNOWN_ROUTE_POLICY).toMatchObject({ tier: "write", readOnly: false, defaultEnabled: false });
  });

  it("matches a request to its most specific row", () => {
    expect(policyFor("GET", "/api/bots")).toMatchObject({ matched: true, tier: "read" });
    expect(policyFor("DELETE", "/api/bots/abc")).toMatchObject({ matched: true, tier: "admin" });
  });
});
