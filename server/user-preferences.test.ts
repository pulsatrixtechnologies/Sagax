// A person's preferences on an organization server (server/user-preferences.ts,
// server/routes/user-preferences.ts): their own record, known keys only.
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createUserPreferenceStore } from "./user-preferences.ts";
import { createUserPreferenceRoutes, USER_PREFERENCES_PATH } from "./routes/user-preferences.ts";
import { PASS } from "./routes/table.ts";
import { CLIENT_ALLOW } from "./request-auth.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";

describe("per-person preference store", () => {
  it("keeps each person's own known keys and nothing else, across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-prefs-"));
    const store = createUserPreferenceStore(dir, () => 1000);
    expect(store.get(ADA)).toEqual({ stored: false, preferences: {}, updatedAt: null });
    store.put(ADA, { "omb-skin": "midnight", "omb-language": "fr", "omb-drafts": "{\"secret\":1}", "omb-webhook-credentials": "x", "omb-font": 3 });
    expect(store.get(ADA)).toEqual({ stored: true, preferences: { "omb-skin": "midnight", "omb-language": "fr" }, updatedAt: 1000 });
    expect(store.get(BOB).stored).toBe(false);
    const again = createUserPreferenceStore(dir);
    expect(again.get(ADA).preferences).toEqual({ "omb-skin": "midnight", "omb-language": "fr" });
    expect(readFileSync(join(dir, "user-preferences.json"), "utf8")).not.toContain("omb-drafts");
    if (process.platform !== "win32") expect(statSync(join(dir, "user-preferences.json")).mode & 0o777).toBe(0o600);
    expect(() => store.get("local-owner")).toThrow(/not a person/);
  });

  it("keeps each person's own sidebar sections apart", () => {
    const store = createUserPreferenceStore(mkdtempSync(join(tmpdir(), "omb-prefs-")), () => 1000);
    store.put(ADA, { "sagax.sidebarSections.v1": JSON.stringify({ sections: [{ name: "Ventes", items: ["bot:b1"] }] }) });
    store.put(BOB, { "sagax.sidebarSections.v1": JSON.stringify({ sections: [{ name: "Mine", items: ["bot:b1"] }] }) });
    expect(JSON.parse(store.get(ADA).preferences["sagax.sidebarSections.v1"]!).sections[0].name).toBe("Ventes");
    expect(JSON.parse(store.get(BOB).preferences["sagax.sidebarSections.v1"]!).sections[0].name).toBe("Mine");
  });
});

type Answer = { status: number; body: unknown };
function call(route: ReturnType<typeof createUserPreferenceRoutes>, input: { method: string; auth: unknown; body?: unknown; path?: string; type?: string }) {
  let answer: Answer | null = null;
  const res = {} as never;
  return route({
    req: { headers: { "content-type": input.type ?? "application/json" } } as never,
    res, url: new URL(`http://x${input.path ?? USER_PREFERENCES_PATH}`), path: input.path ?? USER_PREFERENCES_PATH, method: input.method,
    auth: input.auth as never,
    json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
    readBody: (async () => input.body) as never,
  }).then((out) => (out === PASS ? "PASS" : answer));
}

describe("GET and PUT /api/me/preferences", () => {
  const session = (principalId?: string) => ({ kind: "session", scopes: ["client"], session: { id: "s1", principalId } });

  it("answers the signed-in person's own record, on an organization server only", async () => {
    const store = createUserPreferenceStore(mkdtempSync(join(tmpdir(), "omb-prefs-")));
    const org = createUserPreferenceRoutes({ store, organization: () => true });
    const solo = createUserPreferenceRoutes({ store, organization: () => false });
    expect(await call(org, { method: "GET", auth: session(ADA), path: "/api/me/engines" })).toBe("PASS");
    expect(await call(solo, { method: "GET", auth: session(ADA) })).toMatchObject({ status: 404 });
    expect(await call(org, { method: "GET", auth: { kind: "loopback", scopes: ["admin"] } })).toMatchObject({ status: 404 });
    expect(await call(org, { method: "GET", auth: session(undefined) })).toMatchObject({ status: 404 });
    expect(await call(org, { method: "PUT", auth: session(ADA), body: { preferences: { "omb-skin": "paper" } } })).toMatchObject({ status: 200, body: { stored: true, preferences: { "omb-skin": "paper" } } });
    expect(await call(org, { method: "GET", auth: session(ADA) })).toMatchObject({ status: 200, body: { preferences: { "omb-skin": "paper" } } });
    // nobody reads or writes someone else's: the session's person is the record
    expect(await call(org, { method: "GET", auth: session(BOB) })).toMatchObject({ status: 200, body: { stored: false } });
    expect(await call(org, { method: "PUT", auth: session(ADA), body: { preferences: ["x"] } })).toMatchObject({ status: 400 });
    expect(await call(org, { method: "PUT", auth: session(ADA), type: "text/plain", body: { preferences: {} } })).toMatchObject({ status: 415 });
    expect(await call(org, { method: "DELETE", auth: session(ADA) })).toMatchObject({ status: 405 });
  });

  it("is a member's own route (client scope)", () => {
    const rule = CLIENT_ALLOW.find((entry) => entry.path.test(USER_PREFERENCES_PATH));
    expect(rule?.methods).toEqual(["GET", "PUT"]);
    expect(rule?.feature).toBeUndefined();
  });
});
