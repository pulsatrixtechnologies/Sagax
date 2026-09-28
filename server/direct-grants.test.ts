import { describe, expect, it } from "vitest";
import { grantDirect, grantDirectRoute } from "./direct-grants.ts";
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
});
