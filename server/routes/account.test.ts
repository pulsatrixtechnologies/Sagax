import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { createAccountRoutes, type AccountRouteDeps } from "./account.ts";
import { dispatchRoutes } from "./table.ts";

const ADA = "pr_00000000-0000-4000-8000-000000000001";
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });
const person = (principalId?: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: "s", label: "phone", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, ...(principalId ? { principalId } : {}) } as never,
});

async function serve(auth: RequestAuth, deps: Partial<AccountRouteDeps>) {
  const deleted: string[] = [];
  const routes = [createAccountRoutes({
    organization: () => true,
    perspicaxDeletion: null,
    deletePersonData: async (principalId) => { deleted.push(principalId); return { bots: 2, threads: 3 }; },
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const remove = (body: unknown = { confirm: true }) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me`, {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { remove, deleted };
}

describe("DELETE /api/me", () => {
  it("is member scope (a person deletes only themselves)", () => {
    expect(requiredScope("DELETE", "/api/me")).toBe("client");
    expect(requiredScope("GET", "/api/me")).toBe("admin");
  });

  it("answers personal_server on a personal computer", async () => {
    const { remove } = await serve({ kind: "loopback", scopes: ["admin", "client"] }, { organization: () => false });
    const res = await remove();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "personal_server" });
  });

  it("answers 501 perspicax_deletion_unavailable and deletes nothing while Perspicax has no endpoint", async () => {
    const { remove, deleted } = await serve(person(ADA), {});
    const res = await remove();
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: "perspicax_deletion_unavailable" });
    expect(deleted).toEqual([]);
  });

  it("deletes the Perspicax account first, then the person's data, only when confirmed", async () => {
    const calls: string[] = [];
    const { remove, deleted } = await serve(person(ADA), { perspicaxDeletion: async (id) => { calls.push(id); } });
    expect((await remove({})).status).toBe(400);
    const res = await remove();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, bots: 2, threads: 3 });
    expect(calls).toEqual([ADA]);
    expect(deleted).toEqual([ADA]);
    const failing = await serve(person(ADA), { perspicaxDeletion: async () => { throw new Error("down"); } });
    expect((await failing.remove()).status).toBe(502);
    expect(failing.deleted).toEqual([]);
    expect((await (await serve(person(), {})).remove()).status).toBe(403);
  });
});
