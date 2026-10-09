// People (server/org-admin-people.ts): the rows, the reach, the filters,
// the detail, and Disable, Reset access and revoke with their audit rows.
import { describe, expect, it } from "vitest";

import { peopleRoutes, usageByPerson, type PeopleDeps, type PersonFacts } from "./org-admin-people.ts";
import type { AdminBot } from "./org-admin-routes.ts";
import { fakeConsole } from "./testing/console-context.ts";
import type { UsageRow } from "./usage-ledger.ts";

const NOW = Date.UTC(2026, 9, 8, 12);
const person = (principalId: string, name: string, extra: Partial<PersonFacts> = {}): PersonFacts => ({
  principalId, sub: `sub-${name}`, name, role: "member", perspicaxDisabled: false, consoleDisabled: null,
  presence: { state: "offline", lastSeenAt: null }, engines: [{ id: "claude", via: "org-key" }], ...extra,
});
const bot = (id: string, owner: string): { bot: AdminBot; reach: { ownerPrincipalId: string; grantTargets: string[]; sectionMemberTargets: string[] } } => ({
  bot: {
    id, name: id, owner: { principalId: owner, sub: null, name: owner }, ownerRole: "member", engine: { instanceId: "claude", driverKind: "claudeAgent", installed: true },
    model: null, access: "org-key", mcpProfiles: [], grants: [], sections: [], routines: 0, createdAt: null, lastActivityAt: null, status: "active", label: null, threads: 1,
  },
  reach: { ownerPrincipalId: owner, grantTargets: [], sectionMemberTargets: [] },
});
const usage = (principalId: string, at: number, costUsd: number | null): UsageRow => ({
  at: new Date(at).toISOString(), botId: "b", botName: "B", threadId: "t", instanceId: "claude", driverKind: "claudeAgent", model: "m",
  input: 1, output: 1, costUsd, trigger: { kind: "user", principalId },
});

function setup() {
  const disabled = new Map<string, { at: number; by: string; reason?: string } | null>();
  const resets: Array<{ principalId: string; scope: string }> = [];
  const deps: PeopleDeps = {
    people: () => [
      person("pr_alice", "Alice", { role: "admin", presence: { state: "online", lastSeenAt: NOW } }),
      person("pr_bob", "Bob", { consoleDisabled: disabled.get("pr_bob") ?? null }),
      person("pr_carl", "Carl", { perspicaxDisabled: true }),
    ],
    person: (id) => ({ principalId: id, sub: null, name: id }),
    bots: () => [bot("b1", "pr_bob"), bot("b2", "pr_bob"), bot("a1", "pr_alice")],
    routines: () => [{ id: "r1", name: "Digest", botId: "b1", runAs: "pr_bob" }],
    usageRows: () => [usage("pr_bob", NOW - 1000, 0.5), usage("pr_bob", NOW - 2000, 0.25), usage("pr_alice", NOW - 3000, null)],
    shared: () => [{ botId: "a1", botName: "a1", level: "use", via: "user" }],
    connections: () => ({ engines: [{ id: "claude", via: "org-key", signedIn: false, key: false }], mcpServers: [{ id: "gh", name: "gh", transport: "remote", state: "enabled" }], composioApps: [] }),
    setDisabled: (principalId, value) => { disabled.set(principalId, value); },
    resetAccess: async (principalId, scope) => { resets.push({ principalId, scope }); return { engineLogins: 1, sessions: 2 }; },
    revokeConnections: async (_principalId, body) => (body && typeof body === "object" && "all" in body
      ? { status: 200, body: { removed: [{ kind: "mcp", name: "gh" }] }, removed: [{ kind: "mcp", name: "gh" }] }
      : { status: 400, body: { error: "Send { all: true } or one connection.", code: "invalid_body" }, removed: [] }),
    connectionListing: (principalId) => ({ principalId, paused: false, connections: [] }),
  };
  return { deps, disabled, resets, console: fakeConsole(peopleRoutes(deps), () => NOW) };
}

describe("people", () => {
  it("lists every person with their facts, sorted, paged, searched and filtered", async () => {
    const { console } = setup();
    const all = await console.call("GET", "people");
    expect(all.status).toBe(200);
    expect(all.body.items.map((row: { name: string }) => row.name)).toEqual(["Alice", "Bob", "Carl"]);
    expect(all.body.items[1]).toMatchObject({ principalId: "pr_bob", bots: 2, routines: 1, turns30d: 2, costUsd30d: 0.75, lastTurnAt: NOW - 1000, disabled: false, disabledBy: null });
    expect(all.body.items[2]).toMatchObject({ disabled: true, disabledBy: "perspicax" });
    expect((await console.call("GET", "people?role=admin")).body.items.map((row: { name: string }) => row.name)).toEqual(["Alice"]);
    expect((await console.call("GET", "people?presence=online")).body.items).toHaveLength(1);
    expect((await console.call("GET", "people?disabled=true")).body.items.map((row: { name: string }) => row.name)).toEqual(["Carl"]);
    expect((await console.call("GET", "people?q=bo")).body.items.map((row: { name: string }) => row.name)).toEqual(["Bob"]);
    const page = await console.call("GET", "people?limit=2");
    expect(page.body.next).toEqual(expect.any(String));
    expect((await console.call("GET", `people?limit=2&cursor=${page.body.next}`)).body).toMatchObject({ items: [{ name: "Carl" }], next: null });
    expect((await console.call("GET", "people?role=owner")).status).toBe(400);
  });

  it("a manager reads their reach only; out of reach is 404", async () => {
    const { console } = setup();
    const mona = { role: "manager" as const, principalId: "pr_mona", reach: ["pr_mona", "pr_bob"] };
    expect((await console.call("GET", "people", mona)).body.items.map((row: { name: string }) => row.name)).toEqual(["Bob"]);
    expect((await console.call("GET", "people/pr_alice", mona)).status).toBe(404);
    expect((await console.call("GET", "people/pr_bob", mona)).status).toBe(200);
  });

  it("a person's page: owned bots, shared bots, connections, routines run as them", async () => {
    const { console } = setup();
    const got = await console.call("GET", "people/pr_bob");
    expect(got.body).toMatchObject({
      name: "Bob", bots: [{ id: "b1" }, { id: "b2" }], shared: [{ botId: "a1", level: "use", via: "user" }],
      connections: { mcpServers: [{ name: "gh", transport: "remote" }] }, routinesAsRunner: [{ id: "r1", name: "Digest", botId: "b1" }],
    });
    expect((await console.call("GET", "people/pr_nobody")).status).toBe(404);
  });

  it("disable and enable: audited, never oneself, a strict body", async () => {
    const { console } = setup();
    const off = await console.call("POST", "people/pr_bob/disable", { body: { disabled: true, reason: "Left the team" } });
    expect(off).toMatchObject({ status: 200, body: { person: { principalId: "pr_bob", disabled: true, disabledBy: "sagax" } } });
    expect(console.records.at(-1)).toMatchObject({ category: "people", action: "person.console_disable", target: { kind: "person", id: "pr_bob" }, after: { disabled: true, reason: "Left the team" } });
    const on = await console.call("POST", "people/pr_bob/disable", { body: { disabled: false } });
    expect(on.body.person).toMatchObject({ disabled: false, disabledBy: null });
    expect(console.records.at(-1)).toMatchObject({ action: "person.console_enable" });
    expect(await console.call("POST", "people/pr_admin/disable", { body: { disabled: true } })).toMatchObject({ status: 409, body: { code: "self" } });
    for (const body of [null, {}, { disabled: "yes" }, { disabled: true, extra: 1 }, { disabled: true, reason: "x".repeat(501) }]) {
      expect((await console.call("POST", "people/pr_bob/disable", { body })).status).toBe(400);
    }
    expect((await console.call("POST", "people/pr_nobody/disable", { body: { disabled: true } })).status).toBe(404);
  });

  it("reset access and revoke connections: what was cleared, audited", async () => {
    const { console, resets } = setup();
    const reset = await console.call("POST", "people/pr_bob/reset-access", { body: { scope: "all" } });
    expect(reset).toMatchObject({ status: 200, body: { cleared: { engineLogins: 1, sessions: 2 }, person: { principalId: "pr_bob" } } });
    expect(resets).toEqual([{ principalId: "pr_bob", scope: "all" }]);
    expect(console.records.at(-1)).toMatchObject({ action: "person.reset_access", after: { scope: "all", engineLogins: 1, sessions: 2 } });
    expect((await console.call("POST", "people/pr_bob/reset-access", { body: { scope: "keys" } })).status).toBe(400);
    const revoked = await console.call("POST", "people/pr_bob/connections/revoke", { body: { all: true } });
    expect(revoked).toMatchObject({ status: 200, body: { removed: [{ kind: "mcp", name: "gh" }], connections: { principalId: "pr_bob" } } });
    expect(console.records.at(-1)).toMatchObject({ action: "connections.revoke", target: { id: "pr_bob" } });
    expect(await console.call("POST", "people/pr_bob/connections/revoke", { body: { kind: "nope" } })).toMatchObject({ status: 400, body: { code: "bad_request" } });
  });

  it("usage by person: a routine counts for the person it ran as", () => {
    const rows: UsageRow[] = [
      usage("pr_bob", NOW, 1),
      { ...usage("x", NOW, 2), trigger: { kind: "routine", routineId: "r", runAsPrincipalId: "pr_bob" } },
      { ...usage("x", NOW, 2), trigger: { kind: "owner" } },
    ];
    expect(usageByPerson(rows).get("pr_bob")).toEqual({ turns: 2, costUsd: 3, lastAt: NOW });
  });
});
