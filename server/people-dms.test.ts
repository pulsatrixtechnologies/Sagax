// The rules of a direct conversation between two people, pure. The real
// server's behavior (privacy, live frames, search, notifications) is covered
// by server/people-dms.e2e.test.ts.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import {
  findPeopleDm,
  isPeopleDmParticipant,
  otherPerson,
  peopleDmCandidate,
  peopleDmPatchRefusal,
  peopleDmRouteRefusal,
} from "./people-dms.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createPeopleDmRoutes } from "./routes/people-dms.ts";
import { dispatchRoutes } from "./routes/table.ts";

const dm = { id: "g1", peopleDm: true, humanIds: ["pr_alice", "pr_bob"] };

describe("people dm rules", () => {
  it("lets only its two people in, never a viewer without an id", () => {
    expect(isPeopleDmParticipant(dm, "pr_alice")).toBe(true);
    expect(isPeopleDmParticipant(dm, "PR_BOB")).toBe(true);
    expect(isPeopleDmParticipant(dm, "pr_carol")).toBe(false);
    expect(isPeopleDmParticipant(dm, undefined)).toBe(false);
    expect(isPeopleDmParticipant({ humanIds: ["pr_alice"] }, "pr_alice")).toBe(false);
  });

  it("finds the pair in either order and names the other person", () => {
    const groups = [{ id: "room", humanIds: ["pr_alice", "pr_bob"] }, dm];
    expect(findPeopleDm(groups, "pr_bob", "pr_alice")?.id).toBe("g1");
    expect(findPeopleDm(groups, "pr_alice", "pr_carol")).toBeUndefined();
    expect(otherPerson(dm, "pr_alice")).toBe("pr_bob");
  });

  it("only marks read or the home pin, only takes messages", () => {
    expect(peopleDmPatchRefusal({ unread: false })).toBeNull();
    expect(peopleDmPatchRefusal({ unread: true })).toBeNull();
    expect(peopleDmPatchRefusal({ pinned: false })).toBeNull();
    expect(peopleDmPatchRefusal({ pinned: true })).toBeNull();
    expect(peopleDmPatchRefusal({ unread: false, name: "x" })).toBe("name");
    expect(peopleDmPatchRefusal({ section: "Ops" })).toBe("section");
    expect(peopleDmRouteRefusal("GET", "/api/threads/t1/messages")).toBeNull();
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/messages")).toBeNull();
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/read")).toBeNull();
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/tasks")).not.toBeNull();
    expect(peopleDmRouteRefusal("DELETE", "/api/groups/g1")).not.toBeNull();
    expect(peopleDmRouteRefusal("PUT", "/api/groups/g1/memory")).not.toBeNull();
  });

  it("offers active people only, never a service account or oneself", () => {
    expect(peopleDmCandidate({ principalId: "pr_bob" }, "pr_alice")).toBe(true);
    expect(peopleDmCandidate({ principalId: "pr_bob", service: true }, "pr_alice")).toBe(false);
    expect(peopleDmCandidate({ principalId: "pr_bob", disabled: true }, "pr_alice")).toBe(false);
    expect(peopleDmCandidate({ principalId: "PR_ALICE" }, "pr_alice")).toBe(false);
  });
});

describe("POST /api/people-dms", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  async function serve(organization = true) {
    const groups: Array<{ id: string; peopleDm?: boolean; humanIds?: string[] }> = [];
    const routes = [createPeopleDmRoutes({
      organization: () => organization,
      viewerId: (auth) => (auth as { session?: { principalId?: string } }).session?.principalId,
      person: (id) => id === "pr_robot" ? { ok: false, code: "service_account" } : id.startsWith("pr_") ? { ok: true, id, name: id.slice(3) } : { ok: false, code: "unknown_person" },
      displayName: (id) => id.slice(3),
      groups: () => groups,
      create: ({ a, b }) => {
        const group = { id: `g${groups.length + 1}`, peopleDm: true, humanIds: [a, b] };
        groups.push(group);
        return group;
      },
      project: (group) => group,
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const auth = (who ? { kind: "session", scopes: ["client"], session: { principalId: who } } : { kind: "loopback", scopes: ["admin"] }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return (who: string | undefined, principalId: string) =>
      fetch(`${base}/api/people-dms`, { method: "POST", headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, body: JSON.stringify({ principalId }) })
        .then(async (r) => ({ status: r.status, body: (await r.json()) as { group?: { id: string }; code?: string; created?: boolean } }));
  }

  it("creates once, then answers the same conversation from either side", async () => {
    const call = await serve();
    const first = await call("pr_alice", "pr_bob");
    expect(first).toMatchObject({ status: 201, body: { created: true } });
    expect((await call("pr_bob", "pr_alice")).body).toMatchObject({ created: false, group: { id: first.body.group!.id } });
  });

  it("refuses a service account, oneself, an unknown person, no session and a solo server", async () => {
    const call = await serve();
    expect((await call("pr_alice", "pr_robot")).body.code).toBe("service_account");
    expect((await call("pr_alice", "pr_alice")).body.code).toBe("self");
    expect((await call("pr_alice", "nobody")).body.code).toBe("unknown_person");
    expect((await call(undefined, "pr_bob")).status).toBe(403);
    expect((await (await serve(false))("pr_alice", "pr_bob")).status).toBe(404);
  });
});
