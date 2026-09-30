// Slice 5: Perspicax MCP for the person who speaks (server/perspicax-mcp.ts).
import { describe, expect, it } from "vitest";

import type { SubjectTokenOutcome } from "./idp-session.ts";
import type { ExchangeResult } from "./perspicax-link.ts";
import { PERSPICAX_ACCESS_ENDED, PerspicaxMcp, parseMcpBody, type PerspicaxMcpLink } from "./perspicax-mcp.ts";

const ISS = "https://px.example.test";
const ALICE = "pr_alice";
const BOB = "pr_bob";
const CAROL = "pr_carol";
const CATALOG = [
  { id: "P1", slug: "dispatch", name: "Dispatch", description: "" },
  { id: "P2", slug: "billing", name: "Billing", description: "" },
];

function harness(options: { held?: Record<string, string[]>; mcp?: (request: { headers: Record<string, string>; body: any; method: string }) => Response | Promise<Response> } = {}) {
  let clock = 1_000_000;
  const held = options.held ?? { A: ["P1", "P2"], B: ["P1"], C: [] };
  const subjects: Record<string, { iss: string; sub: string; disabled: boolean }> = {
    [ALICE]: { iss: ISS, sub: "A", disabled: false },
    [BOB]: { iss: ISS, sub: "B", disabled: false },
    [CAROL]: { iss: ISS, sub: "C", disabled: false },
  };
  const botProfiles: Record<string, string[]> = { x: ["P1"] };
  const exchanges: Array<{ subject: string; profile: string }> = [];
  const revoked: string[] = [];
  const logs: string[] = [];
  const mcpCalls: Array<{ method: string; headers: Record<string, string>; body: any }> = [];
  const subjectCalls: string[] = [];
  let signInFails: SubjectTokenOutcome | null = null;
  /** Slice 6: who allowed routines to act in their name. */
  const delegations = new Set<string>();
  const delegationCalls: string[] = [];
  const refusedDelegations: string[] = [];
  let n = 0;
  const link: PerspicaxMcpLink = {
    exchangeToken: async (subjectToken, profileId): Promise<ExchangeResult> => {
      exchanges.push({ subject: subjectToken, profile: profileId });
      const sub = subjectToken.split(".")[1]!;
      if (subjects[`pr_${{ A: "alice", B: "bob", C: "carol" }[sub]}`]?.disabled) return { ok: false, error: "subject" };
      if (!(held[sub] ?? []).includes(profileId)) return { ok: false, error: "not_held" };
      return { ok: true, token: `pxlo1.${sub}.mcp-${profileId}-${++n}`, expiresAt: clock + 900_000 };
    },
    revokeExchanged: async (token) => { revoked.push(token); return true; },
    mcpEndpoint: () => "http://perspicax:8787/mcp",
    profileCatalog: () => CATALOG,
  };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = { ...(init?.headers as Record<string, string>) };
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = String(init?.method);
    mcpCalls.push({ method, headers, body });
    expect(String(input)).toBe("http://perspicax:8787/mcp");
    if (options.mcp) return options.mcp({ headers, body, method });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (body.id === undefined) return new Response(null, { status: 202 });
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [], seenAs: headers.authorization.split(".")[1] } })}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" },
    });
  }) as typeof fetch;
  const mcp = new PerspicaxMcp({
    issuer: ISS,
    link: () => link,
    subjectOf: (id) => subjects[id] ?? null,
    subjectToken: async (subject) => {
      subjectCalls.push(subject.sub);
      if (signInFails) return signInFails;
      return { ok: true, token: `pxlo1.${subject.sub}.signin`, expiresAt: clock + 3_600_000 };
    },
    routineSubjectToken: async (principalId) => {
      delegationCalls.push(principalId);
      if (!delegations.has(principalId)) return { ok: false, error: "no_session" };
      const sub = subjects[principalId]!.sub;
      return { ok: true, token: `pxlo1.${sub}.delegation`, expiresAt: clock + 3_600_000 };
    },
    delegationRefused: (principalId) => refusedDelegations.push(principalId),
    botProfiles: (id) => botProfiles[id],
    version: "0.1.89",
    fetch: fetcher,
    now: () => clock,
    log: (line) => logs.push(line),
  });
  return {
    mcp, subjects, botProfiles, exchanges, revoked, logs, mcpCalls, subjectCalls, delegations, delegationCalls, refusedDelegations,
    advance: (ms: number) => { clock += ms; },
    failSignIn: (outcome: SubjectTokenOutcome | null) => { signInFails = outcome; },
  };
}

const bot = { id: "x", perspicax: { profiles: ["P1"] } };
const turn = { threadId: "t1", generation: "g1" };

describe("PerspicaxMcp", () => {
  it("exchanges the speaker's own sign-in, never the owner's", async () => {
    const h = harness();
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(plan).toEqual({ mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }], unavailable: [] });
    expect(h.subjectCalls).toEqual(["B"]);
    expect(h.exchanges).toEqual([{ subject: "pxlo1.B.signin", profile: "P1" }]);
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 1, result: { tools: [], seenAs: "B" } } });
    expect(h.mcpCalls[0]!.headers).toMatchObject({ accept: "application/json, text/event-stream", authorization: "Bearer pxlo1.B.mcp-P1-1" });
  });

  it("a routine without a delegation, an unknown speaker, an unknown profile and solo mode mount nothing", async () => {
    const h = harness();
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: ALICE, speakerOrigin: "owner-routine" })).toEqual({
      mounted: [], unavailable: [{ profileId: "P1", name: "Dispatch", reason: "no_delegation" }],
    });
    expect(h.subjectCalls).toEqual([]);
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: "", speakerOrigin: "person" })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: "pr_nobody", speakerOrigin: "peer" })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot: { id: "x", perspicax: { profiles: ["GONE"] } }, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ mounted: [], unavailable: [{ profileId: "GONE", name: "GONE", reason: "unknown_profile" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot: { id: "x" }, speakerPrincipalId: BOB, speakerOrigin: "person" })).toEqual({ mounted: [], unavailable: [] });
    expect(h.exchanges).toEqual([]);
    const solo = new PerspicaxMcp({ issuer: ISS, link: () => null, subjectOf: () => null, subjectToken: async () => ({ ok: false, error: "no_session" }), botProfiles: () => ["P1"], version: "1" });
    expect(await solo.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toEqual({ mounted: [], unavailable: [] });
  });

  it("a turn in a routine's lineage never uses a sign-in, even for a peer hop that names a live person", async () => {
    const h = harness();
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: ALICE, speakerOrigin: "peer", routine: true })).toEqual({
      mounted: [], unavailable: [{ profileId: "P1", name: "Dispatch", reason: "no_delegation" }],
    });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person", routine: true })).toMatchObject({ mounted: [], unavailable: [{ reason: "no_delegation" }] });
    expect(h.subjectCalls).toEqual([]);
    expect(h.exchanges).toEqual([]);
  });

  it("a routine exchanges its runAs person's delegation (slice 6)", async () => {
    const h = harness();
    h.delegations.add(BOB);
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" });
    expect(plan).toEqual({ mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }], unavailable: [] });
    expect(h.delegationCalls).toEqual([BOB]);
    expect(h.subjectCalls).toEqual([]);
    expect(h.exchanges).toEqual([{ subject: "pxlo1.B.delegation", profile: "P1" }]);
    // a peer hop in the routine's lineage uses the root person's delegation
    await h.mcp.prepareTurn({ threadId: "t2", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "peer", routine: true });
    expect(h.exchanges.at(-1)).toEqual({ subject: "pxlo1.B.delegation", profile: "P1" });
    expect(h.subjectCalls).toEqual([]);
    // a token near its end renews through the delegation, not a sign-in
    h.advance(900_000 - 30_000);
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toMatchObject({ status: 200, body: { result: { seenAs: "B" } } });
    expect(h.delegationCalls).toEqual([BOB, BOB, BOB]);
    expect(h.subjectCalls).toEqual([]);
    // the delegation ends: its tokens are revoked and calls end
    const before = h.revoked.length;
    h.mcp.forgetPrincipal(BOB);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.revoked.length).toBe(before + 2);
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).toMatchObject({ body: { error: { message: PERSPICAX_ACCESS_ENDED } } });
  });

  it("a refused delegation subject drops the delegation's cache and reads no_delegation", async () => {
    const h = harness();
    h.delegations.add(BOB);
    // the exchange refuses the subject (Perspicax revoked the family)
    const link = (h.mcp as unknown as { options: { link(): PerspicaxMcpLink } }).options.link();
    const exchange = link.exchangeToken;
    link.exchangeToken = async () => ({ ok: false, error: "subject" });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" })).toMatchObject({ mounted: [], unavailable: [{ reason: "no_delegation" }] });
    expect(h.refusedDelegations).toEqual([BOB]);
    link.exchangeToken = exchange;
  });

  it("a profile the speaker does not hold is unavailable; no sign-in is no_session", async () => {
    const h = harness();
    expect(await h.mcp.prepareTurn({ ...turn, bot: { id: "x", perspicax: { profiles: ["P1", "P2"] } }, speakerPrincipalId: BOB, speakerOrigin: "person" })).toEqual({
      mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }],
      unavailable: [{ profileId: "P2", name: "Billing", reason: "not_held" }],
    });
    expect(await h.mcp.prepareTurn({ threadId: "t2", generation: "g", bot, speakerPrincipalId: CAROL, speakerOrigin: "person" })).toMatchObject({ mounted: [], unavailable: [{ reason: "not_held" }] });
    expect(await h.mcp.relay({ threadId: "t2", generation: "g", botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).toMatchObject({ status: 403, body: { code: "profile_not_mounted" } });
    h.failSignIn({ ok: false, error: "no_session" });
    expect(await h.mcp.prepareTurn({ threadId: "t3", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ unavailable: [{ reason: "no_session" }] });
    h.failSignIn({ ok: false, error: "unreachable" });
    expect(await h.mcp.prepareTurn({ threadId: "t3", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ unavailable: [{ reason: "unreachable" }] });
  });

  it("rewrites clientInfo on initialize, carries the session id, and a notification answers 202", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2" } } } });
    expect(h.mcpCalls[0]!.body.params).toEqual({ protocolVersion: "2025-06-18", clientInfo: { name: "Pulsa Bot (x)", version: "0.1.89" } });
    expect(h.mcpCalls[0]!.headers["mcp-session-id"]).toBeUndefined();
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", method: "notifications/initialized" } })).toEqual({ status: 202 });
    expect(h.mcpCalls[1]!.headers["mcp-session-id"]).toBe("sess-1");
    // another bot cannot use this turn's entry
    expect(await h.mcp.relay({ ...turn, botId: "y", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).toMatchObject({ status: 403 });
  });

  it("a 401 from /mcp gets one re-exchange with a fresh subject; a second failure ends the access", async () => {
    let refuse = 1;
    const h = harness({
      mcp: ({ body, method }) => {
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (refuse > 0) {
          refuse -= 1;
          return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 5, method: "tools/call" } })).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 5, result: { ok: true } } });
    expect(h.exchanges).toHaveLength(2);
    expect(h.subjectCalls).toEqual(["B", "B"]);
    expect(h.mcpCalls.map((call) => call.headers.authorization)).toEqual(["Bearer pxlo1.B.mcp-P1-1", "Bearer pxlo1.B.mcp-P1-2"]);
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1"]);
    // the person is disabled: the renewal fails and the call says so
    refuse = 1;
    h.subjects[BOB]!.disabled = true;
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 6, method: "tools/call" } })).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 6, error: { code: -32001, message: PERSPICAX_ACCESS_ENDED } } });
  });

  it("a token near its end is renewed before the call; forgetSubject ends a running turn at once", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    h.advance(900_000 - 59_000);
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(h.exchanges).toHaveLength(2);
    expect(h.mcpCalls[0]!.headers.authorization).toBe("Bearer pxlo1.B.mcp-P1-2");
    h.mcp.forgetSubject(ISS, "B");
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1", "pxlo1.B.mcp-P1-2"]);
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/call" } })).toMatchObject({ body: { error: { code: -32001, message: PERSPICAX_ACCESS_ENDED } } });
    expect(h.mcpCalls).toHaveLength(1);
    // a profile removed from the bot mid-turn is refused
    await h.mcp.prepareTurn({ threadId: "t9", generation: "g", bot, speakerPrincipalId: ALICE, speakerOrigin: "operator" });
    h.botProfiles.x = [];
    expect(await h.mcp.relay({ threadId: "t9", generation: "g", botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).toMatchObject({ status: 403 });
  });

  it("revokes each token exactly once when the generation ends, after closing the session", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot: { id: "x", perspicax: { profiles: ["P1", "P2"] } }, speakerPrincipalId: ALICE, speakerOrigin: "person" });
    await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "initialize" } });
    await h.mcp.endGeneration("t1", "g1");
    expect(h.revoked.sort()).toEqual(["pxlo1.A.mcp-P1-1", "pxlo1.A.mcp-P2-2"]);
    const deletes = h.mcpCalls.filter((call) => call.method === "DELETE");
    expect(deletes).toEqual([{ method: "DELETE", headers: { authorization: "Bearer pxlo1.A.mcp-P1-1", "mcp-session-id": "sess-1" }, body: undefined }]);
    expect(h.mcp.size()).toBe(1);
    await h.mcp.endGeneration("t1", "g1");
    await h.mcp.endThread("t1");
    await h.mcp.endAll();
    expect(h.revoked.sort()).toEqual(["pxlo1.A.mcp-P1-1", "pxlo1.A.mcp-P2-2", "pxlo1.B.mcp-P1-3"]);
    expect(h.mcp.size()).toBe(0);
  });

  it("never puts a token in a log line or an error", async () => {
    const h = harness({ mcp: () => { throw new Error("connect ECONNREFUSED pxlo1.B.mcp-P1-1"); } });
    await h.mcp.prepareTurn({ ...turn, bot: { id: "x", perspicax: { profiles: ["P1", "P2"] } }, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Perspicax is unavailable" } } });
    h.failSignIn({ ok: false, error: "unreachable" });
    h.advance(900_000);
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    const text = JSON.stringify([h.logs, answer]);
    expect(h.logs.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/pxlo1\./);
  });

  it("parses a JSON or an SSE body", () => {
    expect(parseMcpBody(`{"jsonrpc":"2.0","id":1}`, 1)).toEqual({ jsonrpc: "2.0", id: 1 });
    expect(parseMcpBody(`event: message\ndata: {"id":0}\n\ndata: {"id":1,"x":true}\n\n`, 1)).toEqual({ id: 1, x: true });
    expect(parseMcpBody("", 1)).toBeNull();
  });
});
