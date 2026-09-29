import { describe, expect, it } from "vitest";
import { createDirectGrantRoutes, grantDirect, grantDirectRoute } from "./direct-grants.ts";
import { requiredScope } from "./request-auth.ts";

describe("direct grants", () => {
  it("lets the owner open a direct and refuses anyone else", () => {
    const opened = grantDirect({ actorId: "jc", ownerUserId: "jc", botId: "aurora", userId: "zachary@example.test", grants: [] });
    expect(opened.ok).toBe(true);
    expect(grantDirect({ actorId: "ada@example.test", ownerUserId: "jc", botId: "aurora", userId: "zachary@example.test", grants: [] })).toEqual({
      ok: false,
      error: "not-owner",
    });
  });

  it("does not duplicate the same pair", () => {
    const first = grantDirect({ actorId: "jc", ownerUserId: "jc", botId: "aurora", userId: "zachary@example.test", grants: [] });
    expect(first).toEqual({
      ok: true,
      grants: [{ botId: "aurora", userId: "zachary@example.test" }],
    });
    expect(grantDirect({
      actorId: "jc",
      ownerUserId: "jc",
      botId: "aurora",
      userId: "zachary@example.test",
      grants: first.ok ? first.grants : [],
    })).toEqual(first);
  });

  it("maps stored user ids and refuses a bot with no owner", () => {
    expect(grantDirectRoute({
      actorId: "jc",
      bot: { id: "aurora", ownerUserId: "jc", directGrants: [] },
      userId: "zachary@example.test",
    })).toEqual({ status: 200, directGrants: ["zachary@example.test"] });
    expect(grantDirectRoute({
      actorId: "jc",
      bot: { id: "aurora", ownerUserId: "jc", directGrants: ["zachary@example.test"] },
      userId: "zachary@example.test",
    })).toEqual({ status: 200, directGrants: ["zachary@example.test"] });
    expect(grantDirectRoute({
      actorId: "jc",
      bot: { id: "aurora" },
      userId: "zachary@example.test",
    })).toEqual({ status: 403, error: "not-owner" });
    expect(grantDirectRoute({
      actorId: "ada@example.test",
      bot: { id: "aurora", ownerUserId: "jc" },
      userId: "zachary@example.test",
    })).toEqual({ status: 403, error: "not-owner" });
    expect(grantDirectRoute({ actorId: "jc", userId: "zachary@example.test" })).toEqual({ status: 404 });
  });

  it("lets a member owner post a grant at client scope", () => {
    expect(requiredScope("POST", "/api/bots/aurora/direct-grants")).toBe("client");
  });

  it("authorizes the owner before resolving the grantee", async () => {
    const resolved: string[] = [];
    const patched: unknown[] = [];
    const route = createDirectGrantRoutes({
      bot: (id) => (id === "aurora" ? { id, ownerUserId: "pr_owner", directGrants: [] } : undefined),
      patchBot: (id, patch) => patched.push({ id, ...patch }),
      actorId: (auth) => (auth as unknown as { actor: string }).actor,
      resolveUserId: (ref) => { resolved.push(ref); return ref.includes("@") && ref.length <= 320 ? "pr_zach" : null; },
    });
    const call = async (actor: string, userId: string) => {
      let answer: { status: number; body: unknown } | undefined;
      await route({
        req: {} as never,
        res: {} as never,
        url: new URL("http://x/api/bots/aurora/direct-grants"),
        path: "/api/bots/aurora/direct-grants",
        method: "POST",
        auth: { actor } as never,
        json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
        readBody: (async () => ({ userId })) as never,
      });
      return answer!;
    };
    const huge = `${"a".repeat(400)}@gox.ca`;
    expect(await call("", huge)).toEqual({ status: 403, body: { error: "not-owner" } });
    expect(await call("pr_other", "zach@gox.ca")).toEqual({ status: 403, body: { error: "not-owner" } });
    expect(resolved).toEqual([]);
    expect((await call("pr_owner", huge)).status).toBe(400);
    expect((await call("pr_owner", "bob")).status).toBe(400);
    expect(await call("pr_owner", "zach@gox.ca")).toEqual({ status: 200, body: { directGrants: ["pr_zach"] } });
    expect(patched).toEqual([{ id: "aurora", directGrants: ["pr_zach"] }]);
  });
});
