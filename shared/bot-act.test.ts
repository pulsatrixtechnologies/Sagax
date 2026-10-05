import { describe, expect, it } from "vitest";
import { actorForTurn, botActFrameAllowed, decideBotAct, uiCommandToAction, type TurnFacts } from "./bot-act.ts";

const client = (method: string, path: string) => path.startsWith("/api/admin") ? "admin" as const : "client" as const;

function facts(patch: Partial<TurnFacts> = {}): TurnFacts {
  return {
    automation: false,
    guest: false,
    requestUsable: true,
    senderUnproven: false,
    provenPerson: null,
    sharedServer: false,
    ...patch,
  };
}

describe("actorForTurn", () => {
  it("refuses a routine even when a person is proven", () => {
    expect(actorForTurn(facts({ automation: true, provenPerson: "p1" }))).toEqual({ kind: "none", reason: "automation" });
  });

  it("refuses a guest before an unproven request", () => {
    expect(actorForTurn(facts({ guest: true, requestUsable: false }))).toEqual({ kind: "none", reason: "guest" });
  });

  it("refuses an unusable request, then a sender that was not proven", () => {
    expect(actorForTurn(facts({ requestUsable: false, senderUnproven: true }))).toEqual({ kind: "none", reason: "unproven" });
    expect(actorForTurn(facts({ senderUnproven: true, provenPerson: "p1" }))).toEqual({ kind: "none", reason: "stale" });
  });

  it("acts as the proven person, and as the owner only on a personal desktop", () => {
    expect(actorForTurn(facts({ provenPerson: "p1", sharedServer: true }))).toEqual({ kind: "person", personKey: "p1" });
    expect(actorForTurn(facts({ sharedServer: true }))).toEqual({ kind: "none", reason: "shared" });
    expect(actorForTurn(facts())).toEqual({ kind: "operator" });
  });
});

describe("decideBotAct", () => {
  it("refuses an internal path, a testing path, and an internal frame", () => {
    expect(decideBotAct({ raw: { method: "GET", path: "/api/internal/agents" }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { method: "POST", path: "/api/testing/internal-capability" }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { method: "GET", path: "/api/bots/../admin" }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { ui: "hydrate" }, mode: "full", scopes: ["admin"], neededScope: client })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a member an admin route and runs a route they may read", () => {
    const refused = decideBotAct({ raw: { method: "POST", path: "/api/admin/settings" }, mode: "full", scopes: ["client"], neededScope: client });
    expect(refused).toMatchObject({ ok: false, status: 403 });
    const allowed = decideBotAct({ raw: { method: "GET", path: "/api/bots", query: { section: "general" } }, mode: "ask", scopes: ["client"], neededScope: client });
    expect(allowed).toMatchObject({ ok: true, effect: "run", summary: "GET /api/bots" });
    if (allowed.ok && allowed.target.kind === "route") expect(allowed.target.query).toEqual({ section: "general" });
  });

  it("holds a write in ask mode and runs it in auto or full", () => {
    const held = decideBotAct({ raw: { method: "POST", path: "/api/bots", body: { name: "Ada" } }, mode: "ask", scopes: ["client"], neededScope: client });
    expect(held).toMatchObject({ ok: true, effect: "hold", summary: "POST /api/bots" });
    expect(decideBotAct({ raw: { method: "POST", path: "/api/bots", body: ["a"] }, mode: undefined, scopes: ["client"], neededScope: client })).toMatchObject({ effect: "hold" });
    expect(decideBotAct({ raw: { method: "DELETE", path: "/api/bots/b1" }, mode: "auto", scopes: ["admin", "client"], neededScope: client })).toMatchObject({ effect: "run" });
    expect(decideBotAct({ raw: { method: "PATCH", path: "/api/bots/b1", body: { name: "Bea" } }, mode: "full", scopes: ["admin", "client"], neededScope: client })).toMatchObject({ effect: "run" });
    expect(decideBotAct({ raw: { method: "POST", path: "/api/bots" }, mode: "edits", scopes: ["client"], neededScope: client })).toMatchObject({ effect: "hold" });
  });

  it("runs a screen change and holds a screen write", () => {
    const screen = decideBotAct({ raw: { ui: "showTeamMap" }, mode: "ask", scopes: ["client"], neededScope: client });
    expect(screen).toMatchObject({ ok: true, effect: "run", summary: "Screen: showTeamMap" });
    const send = decideBotAct({
      raw: { ui: "send", input: { botId: "b1", text: "Hello", onError: () => undefined } },
      mode: "ask",
      scopes: ["client"],
      neededScope: client,
    });
    expect(send).toMatchObject({ ok: true, effect: "hold", summary: "Screen: send" });
    if (send.ok && send.target.kind === "ui") {
      expect(send.target.action).toEqual({ type: "send", botId: "b1", text: "Hello" });
      expect(send.target.action).not.toHaveProperty("onError");
    }
  });

  it("refuses both forms at once, a read with a body, and a prototype key", () => {
    expect(decideBotAct({ raw: { ui: "showChat", method: "GET", path: "/api/bots" }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: {}, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { method: "GET", path: "/api/bots", body: { a: 1 } }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { method: "GET", path: "/api/bots", query: { "__proto__": "x" } }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { ui: "playMascotMotion", input: { botId: "b1", kind: "none" } }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
  });
});

describe("uiCommandToAction", () => {
  it("keeps a null person panel and drops callbacks", () => {
    expect(uiCommandToAction("openPersonPanel", { personId: null })?.action).toEqual({ type: "openPersonPanel", personId: null });
    expect(uiCommandToAction("deleteBot", { botId: "b1", onDeleted: true })).toEqual({
      action: { type: "deleteBot", botId: "b1" },
      write: true,
      input: { botId: "b1" },
    });
    expect(uiCommandToAction("messageAdded", {})).toBeNull();
  });
});

describe("botActFrameAllowed", () => {
  it("matches the viewer's id, or the operator when the stream has none", () => {
    expect(botActFrameAllowed("p1", "p1", "operator")).toBe(true);
    expect(botActFrameAllowed("p1", "p2", "operator")).toBe(false);
    expect(botActFrameAllowed("operator", undefined, "operator")).toBe(true);
    expect(botActFrameAllowed("p1", undefined, "operator")).toBe(false);
  });
});
