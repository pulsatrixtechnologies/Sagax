// The member API's gate, permissions, waits and readings, with fake deps
// (server/org-member-routes.ts). The real server path is
// org-member-api.e2e.test.ts.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ConsoleAssertion } from "./oidc-rp.ts";
import { createOrgMemberRoutes, MEMBER_PROGRESS_MIN_MS, readThreadPage, replyAfter, summarizeTurn, type MemberPerson, type MemberRequest, type OrgMemberRouteDeps, type ThreadStatus } from "./org-member-routes.ts";

const ISS = "https://perspicax.example";
const ORIGIN = "https://sagax.example";
type Person = { principalId: string; name: string; active: boolean; admin: boolean; permissions: string[] };
const people = new Map<string, Person>();
const tokens = new Map<string, ConsoleAssertion>();
let jti = 0;
let performed: Array<{ person: MemberPerson; request: MemberRequest }> = [];
let recorded: Array<{ person: MemberPerson; action: string; after?: Record<string, unknown> }> = [];
let respond: (request: MemberRequest) => { status: number; body: unknown } = () => ({ status: 404, body: { error: "no" } });
let status: () => ThreadStatus | null = () => "idle";
let live: () => string | null = () => null;
let noted: Array<{ principalId: string; threadId: string; requestId: string }> = [];
let cards = new Map<string, { open: boolean; ownerPrincipalId: string | null; ownerName: string | null; adminOnly: boolean }>();
let clock = 1_000_000;

function token(sub: string, role: ConsoleAssertion["role"] = "employee", actor: ConsoleAssertion["actor"] = "perspicax-mcp"): string {
  jti += 1;
  const id = `t${jti}`;
  tokens.set(id, { iss: ISS, sub, jti: `jti-member-${String(jti).padStart(8, "0")}`, iat: 0, exp: Math.floor(clock / 1000) + 60, serverId: "srv", role, teams: [], actor });
  return id;
}

const deps: OrgMemberRouteDeps = {
  identity: "perspicax",
  issuer: ISS,
  publicOrigin: () => ORIGIN,
  linkServerId: () => "srv",
  verify: async (bearer) => {
    const found = tokens.get(bearer);
    if (!found) throw new Error("The assertion does not verify.");
    return found;
  },
  personFor: (_iss, sub) => {
    const person = people.get(sub);
    return person ? { principalId: person.principalId, name: person.name, active: person.active, admin: person.admin } : null;
  },
  permissions: (principalId) => ({ admin: false, permissions: [...people.values()].find((p) => p.principalId === principalId)?.permissions ?? [] }),
  perform: async (person, request) => {
    performed.push({ person, request });
    return respond(request);
  },
  threadStatus: () => status(),
  resolvePerson: (ref) => [...people.entries()].find(([sub, p]) => sub === ref || p.principalId === ref)?.[1].principalId ?? null,
  record: (person, entry) => recorded.push({ person, action: entry.action, ...(entry.after ? { after: entry.after } : {}) }),
  liveText: () => live(),
  threadLink: (threadId, botId) => `${ORIGIN}/#thread=${threadId}${botId ? `&bot=${botId}` : ""}`,
  botOfThread: (threadId) => (threadId === "t1" ? "b1" : null),
  noteAnsweredVia: (person, threadId, requestId) => noted.push({ principalId: person.principalId, threadId, requestId }),
  approvalAnswerer: (threadId, requestId) => {
    const card = cards.get(`${threadId}/${requestId}`);
    return card ? { found: true, ...card } : null;
  },
  version: () => "0.4.16",
  now: () => clock,
  sleep: async (ms) => {
    clock += ms;
  },
};

let server: Server;
let base = "";
beforeAll(async () => {
  const handle = createOrgMemberRoutes(deps);
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!(await handle(req, res, url))) {
      res.writeHead(418);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  people.clear();
  people.set("bob", { principalId: "pr_bob", name: "Bob", active: true, admin: false, permissions: ["clients.botsRead", "clients.botsMessage"] });
  people.set("ann", { principalId: "pr_ann", name: "Ann", active: true, admin: true, permissions: [] });
  people.set("out", { principalId: "pr_out", name: "Out", active: false, admin: false, permissions: ["clients.botsRead"] });
  performed = [];
  recorded = [];
  status = () => "idle";
  live = () => null;
  noted = [];
  cards = new Map();
  respond = () => ({ status: 404, body: { error: "no" } });
});

async function call(method: string, path: string, bearer?: string, body?: unknown) {
  const res = await fetch(`${base}/api/org/member/${path}`, {
    method,
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any, headers: res.headers };
}

describe("the member API gate", () => {
  it("answers only with a fresh assertion for an active person, never twice the same", async () => {
    expect((await call("GET", "capabilities")).body.code).toBe("assertion_missing");
    expect((await call("GET", "capabilities", "nope")).body.code).toBe("assertion_invalid");
    expect((await call("GET", "capabilities", token("stranger"))).body.code).toBe("unknown_person");
    expect((await call("GET", "capabilities", token("out"))).body.code).toBe("person_disabled");
    const once = token("bob");
    const first = await call("GET", "capabilities", once);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-sagax-member-api")).toBe("1");
    expect(first.body).toMatchObject({ api: 1, version: "0.4.16" });
    expect(first.body.routes).toEqual(expect.arrayContaining(["GET bots", "POST bots/{id}/messages", "GET threads/{id}", "POST routines/{id}/run", "GET routines/runs/{id}", "POST approvals/{id}", "POST people/{id}/nudge"]));
    expect((await call("GET", "capabilities", once)).body.code).toBe("assertion_replayed");
    expect((await call("GET", "nowhere", token("bob"))).status).toBe(404);
    expect((await call("POST", "bots", token("bob"), {})).status).toBe(405);
  });

  it("refuses a route without its permission, naming the key; an admin holds every key", async () => {
    const refused = await call("POST", "routines/r1/run", token("bob"), {});
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "forbidden_permission", permission: "clients.routinesRun" });
    expect(performed).toEqual([]);
    respond = () => ({ status: 201, body: { run: { id: "run_1", routineId: "r1", status: "queued", botId: "b1" } } });
    const allowed = await call("POST", "routines/r1/run", token("ann", "admin"), {});
    expect(allowed.status).toBe(201);
    expect(allowed.body.run).toMatchObject({ id: "run_1", routineId: "r1", status: "queued" });
    expect(performed[0]).toMatchObject({ person: { principalId: "pr_ann", admin: true }, request: { method: "POST", path: "/api/routines/r1/run" } });
    expect(recorded).toEqual([{ person: expect.objectContaining({ principalId: "pr_ann", actor: "perspicax-mcp" }), action: "client.routine_run", after: { runId: "run_1" } }]);
  });

  it("an admin role in the assertion alone does not make a member an admin", async () => {
    const refused = await call("POST", "routines/r1/run", token("bob", "admin"), {});
    expect(refused.body.permission).toBe("clients.routinesRun");
  });
});

describe("bots", () => {
  it("lists own, shared and catalogue bots with their status, and who can be messaged", async () => {
    respond = (request) => request.path === "/api/bots"
      ? { status: 200, body: { bots: [
        { id: "b1", name: "Orion", busy: true, activity: "working", threadId: "t1" },
        { id: "b2", name: "Beacon", busy: false, activity: "waiting-on-you", threadId: "t2" },
      ] } }
      : { status: 200, body: { entries: [
        { id: "b1", name: "Orion", title: "Ops", description: "", owner: { principalId: "pr_bob", name: "Bob" }, source: "mine", archived: false },
        { id: "b2", name: "Beacon", title: "", description: "", owner: { principalId: "pr_ann", name: "Ann" }, source: "shared", archived: false },
        { id: "b3", name: "Atlas", title: "", description: "", owner: { principalId: "pr_ann", name: "Ann" }, source: "organization", archived: false },
      ] } };
    const got = await call("GET", "bots", token("bob"));
    expect(got.status).toBe(200);
    expect(got.body.bots).toEqual([
      expect.objectContaining({ id: "b3", name: "Atlas", source: "organization", status: "idle", canMessage: false, threadId: null }),
      expect.objectContaining({ id: "b2", name: "Beacon", source: "shared", status: "waiting", canMessage: true, threadId: "t2" }),
      expect.objectContaining({ id: "b1", name: "Orion", source: "mine", status: "working", canMessage: true, threadId: "t1", owner: { principalId: "pr_bob", sub: "bob", name: "Bob" } }),
    ]);
  });
});

describe("sending", () => {
  const page = (...messages: Array<Record<string, unknown>>) => ({ status: 200, body: { messages } });

  it("waits for the reply and answers it, recording no text", async () => {
    let sent = false;
    let looks = 0;
    status = () => (sent && looks++ < 3 ? "working" : "idle");
    respond = (request) => {
      if (request.method === "POST") {
        sent = true;
        return { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } };
      }
      return page({ id: "m0", role: "bot", kind: "text", text: "earlier", at: 1 }, { id: "m1", role: "user", kind: "text", text: "hi", at: 2 },
        { id: "s1", role: "bot", kind: "activity", tool: { name: "Bash", ok: true } }, { id: "m2", role: "bot", kind: "text", text: "Done: 3 tickets.", at: 3 });
    };
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "hi", wait: 30 });
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ botId: "b1", threadId: "t1", messageId: "m1", status: "done", pending: false, reply: "Done: 3 tickets.", cursor: "m2" });
    expect(performed[0]!.request).toEqual({ method: "POST", path: "/api/bots/b1/messages", body: { text: "hi" } });
    expect(recorded).toEqual([{ person: expect.objectContaining({ principalId: "pr_bob" }), action: "client.message", after: { threadId: "t1", waited: true } }]);
    expect(JSON.stringify(recorded)).not.toContain("hi\"");
  });

  it("answers pending with the thread id when the bot is still working at the end of the wait", async () => {
    status = () => "working";
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : page({ id: "m1", role: "user", kind: "text", text: "long job", at: 2 });
    const start = clock;
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "long job", wait: 5 });
    expect(got.body).toMatchObject({ threadId: "t1", pending: true, status: "working", reply: null, cursor: "m1" });
    expect(clock - start).toBeGreaterThanOrEqual(5_000);
  });

  it("stops waiting at a card and lists it", async () => {
    status = () => "waiting";
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : page({ id: "m1", role: "user", kind: "text", text: "deploy", at: 2 },
        { id: "c1", role: "bot", kind: "options", card: { title: "Run Bash?", subtitle: "uptime", options: ["Allow", "Deny"], requestId: "req_1", tool: "Bash" } });
    const start = clock;
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "deploy", wait: 60 });
    expect(clock - start).toBeLessThan(1_000);
    expect(got.body).toMatchObject({ pending: true, status: "waiting", approvals: [{ id: "req_1", threadId: "t1", title: "Run Bash?", tool: "Bash", options: ["Allow", "Deny"] }] });
  });

  it("opens a new thread when asked, and passes a Sagax refusal through", async () => {
    respond = (request) => request.path.endsWith("/tasks")
      ? { status: 201, body: { task: { threadId: "t9" } } }
      : { status: 403, body: { error: "This bot is not yours to use." } };
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "hello", newThread: true });
    expect(performed.map((p) => p.request.path)).toEqual(["/api/bots/b1/tasks", "/api/bots/b1/messages"]);
    expect(performed[1]!.request.body).toEqual({ text: "hello", threadId: "t9" });
    expect(got.status).toBe(403);
    expect(got.body).toMatchObject({ code: "forbidden", message: "This bot is not yours to use." });
    expect(recorded).toEqual([]);
  });

  it("checks its body", async () => {
    for (const body of [{}, { text: "" }, { text: "x", wait: 121 }, { text: "x", wait: -1 }, { text: "x", extra: 1 }, { text: "x", threadId: "a/b" }, { text: "x", threadId: "t1", newThread: true }, { text: "x", sendId: "short" }]) {
      expect((await call("POST", "bots/b1/messages", token("bob"), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(performed).toEqual([]);
  });
});

describe("threads, approvals and nudges", () => {
  it("reads the messages after a cursor, the steps and the pending cards", () => {
    const read = readThreadPage("t1", { messages: [
      { id: "m1", role: "user", kind: "text", text: "go", at: 1, sender: { name: "Bob" } },
      { id: "s1", role: "bot", kind: "activity", tool: { name: "Read", ok: true, input: "secret path" } },
      { id: "c1", role: "bot", kind: "options", card: { title: "Allow?", subtitle: "", options: ["Allow"], requestId: "r1" } },
      { id: "c2", role: "bot", kind: "options", card: { title: "Old", subtitle: "", options: [], requestId: "r0", answered: "allow" } },
      { id: "m2", role: "bot", kind: "text", text: "half way", at: 3 },
    ] }, "m1");
    expect(read.messages).toEqual([{ id: "m2", role: "bot", kind: "text", text: "half way", at: 3, sender: null }]);
    expect(read.steps).toEqual({ count: 1, recent: [{ tool: "Read", ok: true }] });
    expect(read.approvals.map((a) => a.id)).toEqual(["r1"]);
    expect(read.cursor).toBe("m2");
    expect(read.gap).toBe(false);
    expect(JSON.stringify(read)).not.toContain("secret path");
    expect(readThreadPage("t1", { messages: [] }, "gone").gap).toBe(true);
    expect(replyAfter(read.messages, null)).toBe("half way");
    expect(replyAfter(read.messages, "m2")).toBeNull();
  });

  it("serves a thread through the person's own read", async () => {
    status = () => "working";
    respond = () => ({ status: 200, body: { messages: [{ id: "m1", role: "user", kind: "text", text: "go", at: 1 }, { id: "m2", role: "bot", kind: "text", text: "on it", at: 2 }] } });
    const got = await call("GET", "threads/t1?since=m1", token("bob"));
    expect(got.body).toMatchObject({ threadId: "t1", status: "working", messages: [{ id: "m2", text: "on it" }], cursor: "m2" });
    expect(performed[0]!.request).toMatchObject({ method: "GET", path: "/api/threads/t1/messages" });
    respond = () => ({ status: 404, body: { error: "no such conversation" } });
    expect((await call("GET", "threads/t1", token("bob"))).body).toMatchObject({ code: "not_found", message: "no such conversation" });
  });

  it("answers a card as the person and nudges by Perspicax user id", async () => {
    people.get("bob")!.permissions.push("clients.approvalsAnswer", "clients.peopleNudge");
    respond = (request) => request.path === "/api/nudges" ? { status: 200, body: { ok: true, id: "n1", at: 5 } } : { status: 200, body: { ok: true } };
    expect((await call("POST", "approvals/req_1", token("bob"), { decision: "maybe", threadId: "t1" })).status).toBe(400);
    const answered = await call("POST", "approvals/req_1", token("bob"), { decision: "deny", threadId: "t1" });
    expect(answered.body).toEqual({ answered: true, decision: "deny" });
    expect(performed.at(-1)!.request).toEqual({ method: "POST", path: "/api/threads/t1/respond", body: { requestId: "req_1", behavior: "deny" } });
    const nudged = await call("POST", "people/ann/nudge", token("bob"), {});
    expect(nudged.body).toEqual({ ok: true, id: "n1", at: 5 });
    expect(performed.at(-1)!.request).toEqual({ method: "POST", path: "/api/nudges", body: { principalId: "pr_ann" } });
    expect((await call("POST", "people/nobody/nudge", token("bob"), {})).status).toBe(404);
    expect(recorded.map((r) => r.action)).toEqual(["client.approval", "client.nudge"]);
  });

  it("passes a refusal's permission through", async () => {
    people.get("bob")!.permissions.push("clients.routinesRun");
    respond = () => ({ status: 403, body: { error: "Only the bot's owner can run it now.", code: "run_now_not_allowed", permission: "routines.runNowAny" } });
    const got = await call("POST", "routines/r1/run", token("bob"), {});
    expect(got.status).toBe(403);
    expect(got.body).toMatchObject({ code: "forbidden_permission", permission: "routines.runNowAny", message: "Only the bot's owner can run it now." });
  });
});

/** A streamed answer, split into its NDJSON events. */
async function stream(method: string, path: string, bearer: string, body?: unknown) {
  const res = await fetch(`${base}/api/org/member/${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, events: res.headers.get("content-type")?.startsWith("application/x-ndjson") ? text.trim().split("\n").map((line) => JSON.parse(line) as any) : [] };
}

describe("the streamed turn (lot C.3)", () => {
  const page = (...messages: Array<Record<string, unknown>>) => ({ status: 200, body: { messages } });
  const card = (answered?: Record<string, unknown>) => ({ id: "c1", role: "bot", kind: "options", card: { title: "Run Bash?", subtitle: "rm -rf build", options: ["Allow", "Deny"], requestId: "req_1", tool: "Bash", ...answered } });

  it("streams progress at most every 2 s with the steps and the words being written, then the approval, then a final waiting answer", async () => {
    let looks = 0;
    status = () => (looks++ < 30 ? "working" : "waiting");
    live = () => `Looking at the build ${looks}`;
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : looks < 30
        ? page({ id: "m1", role: "user", kind: "text", text: "clean the build", at: 2 }, { id: "s1", role: "bot", kind: "activity", tool: { name: "Read", ok: true, input: "private" } })
        : page({ id: "m1", role: "user", kind: "text", text: "clean the build", at: 2 }, { id: "s1", role: "bot", kind: "activity", tool: { name: "Read", ok: true } }, card());
    const got = await stream("POST", "bots/b1/messages", token("bob"), { text: "clean the build", wait: 60, stream: true });
    expect(got.status).toBe(200);
    expect(got.headers.get("x-sagax-member-api")).toBe("1");
    const kinds = got.events.map((e) => e.event);
    expect(kinds[0]).toBe("started");
    expect(got.events[0]).toMatchObject({ botId: "b1", threadId: "t1", messageId: "m1" });
    expect(kinds.slice(-2)).toEqual(["approval", "final"]);
    const progress = got.events.filter((e) => e.event === "progress");
    expect(progress.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < progress.length; i += 1) expect(progress[i].elapsedMs - progress[i - 1].elapsedMs).toBeGreaterThanOrEqual(MEMBER_PROGRESS_MIN_MS);
    expect(progress[0]).toMatchObject({ status: "working", steps: { count: 1, recent: [{ tool: "Read", ok: true }] } });
    expect(progress[0].partial).toMatch(/^Looking at the build/);
    expect(got.text).not.toContain("private");
    expect(got.events.at(-2).approval).toMatchObject({ id: "req_1", threadId: "t1", tool: "Bash", title: "Run Bash?", options: ["Allow", "Deny"] });
    expect(got.events.at(-1)).toMatchObject({ status: "waiting", pending: true, threadId: "t1", summary: {
      approvals: [{ id: "req_1", tool: "Bash", decision: "pending", by: null, via: null }],
      threadUrl: `${ORIGIN}/#thread=t1&bot=b1`,
    } });
  });

  it("an approval answered from the AI client is marked with its via; the watch then ends with the structured summary", async () => {
    people.get("bob")!.permissions.push("clients.approvalsAnswer");
    respond = () => ({ status: 200, body: { ok: true, outcome: "allowed-once" } });
    expect((await call("POST", "approvals/req_1", token("bob"), { threadId: "t1", decision: "allow" })).body).toEqual({ answered: true, decision: "allow" });
    expect(noted).toEqual([{ principalId: "pr_bob", threadId: "t1", requestId: "req_1" }]);
    expect(recorded.at(-1)).toMatchObject({ action: "client.approval", after: { requestId: "req_1", decision: "allow" } });

    let looks = 0;
    // The waiting flag lags one look behind the answered card: keep watching.
    status = () => (looks++ === 0 ? "waiting" : looks < 6 ? "working" : "idle");
    respond = () => page(
      { id: "m0", role: "bot", kind: "text", text: "before", at: 1 },
      { id: "m1", role: "user", kind: "text", text: "clean the build", at: 2 },
      { id: "s1", role: "bot", kind: "activity", tool: { name: "Read", ok: true } },
      card({ answered: "allow", answeredBy: { kind: "session", name: "Bob", via: "ai-client" } }),
      { id: "s2", role: "bot", kind: "activity", tool: { name: "Bash", ok: true, files: ["build/clean.log"] } },
      { id: "s3", role: "bot", kind: "activity", tool: { name: "Write", ok: false, files: ["never.txt"] } },
      { id: "m2", role: "bot", kind: "text", text: "Build cleaned.", at: 3 },
      { id: "d1", role: "bot", kind: "digest", text: "", digest: { usage: { input: 1200, output: 300, costUsd: 0.0123 }, files: { added: ["build/clean.log", "notes.md"], changed: [], deleted: ["old.tmp"] } } },
    );
    const got = await stream("GET", "threads/t1/stream?anchor=m1&wait=60", token("bob"));
    expect(got.status).toBe(200);
    expect(got.events[0]).toMatchObject({ event: "started", botId: "b1", threadId: "t1", messageId: "m1" });
    expect(got.events.some((e) => e.event === "approval")).toBe(false);
    const final = got.events.at(-1);
    expect(final).toMatchObject({ event: "final", status: "done", pending: false, reply: "Build cleaned.", approvals: [] });
    expect(final.summary).toEqual({
      text: "Build cleaned.",
      toolCalls: [{ tool: "Read", ok: true }, { tool: "Bash", ok: true }, { tool: "Write", ok: false }],
      toolCallCount: 3,
      files: ["build/clean.log", "notes.md"],
      cost: { inputTokens: 1200, outputTokens: 300, costUsd: 0.0123, turns: 1 },
      approvals: [{ id: "req_1", tool: "Bash", title: "Run Bash?", decision: "allow", by: "Bob", via: "ai-client" }],
      threadUrl: `${ORIGIN}/#thread=t1&bot=b1`,
    });
  });

  it("a thread the person cannot read, a missing permission or a bad wait is refused as JSON, before any stream", async () => {
    respond = () => ({ status: 404, body: { error: "no such conversation" } });
    const unreadable = await stream("GET", "threads/t1/stream?wait=5", token("bob"));
    expect(unreadable.status).toBe(404);
    expect(JSON.parse(unreadable.text)).toMatchObject({ code: "not_found" });
    expect((await call("GET", "threads/t1/stream?wait=0", token("bob"))).status).toBe(400);
    expect((await call("GET", "threads/t1/stream?anchor=a/b", token("bob"))).status).toBe(400);
    people.get("bob")!.permissions = ["clients.botsMessage"];
    const refused = await call("GET", "threads/t1/stream", token("bob"));
    expect(refused.body).toMatchObject({ code: "forbidden_permission", permission: "clients.botsRead" });
    expect((await call("POST", "bots/b1/messages", token("bob"), { text: "x", stream: "yes" })).status).toBe(400);
  });

  it("a send without stream still answers JSON, now with the summary", async () => {
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : page({ id: "m1", role: "user", kind: "text", text: "hi", at: 2 }, { id: "m2", role: "bot", kind: "text", text: "Hello.", at: 3 });
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "hi", wait: 10 });
    expect(got.headers.get("content-type")).toContain("application/json");
    expect(got.body).toMatchObject({ status: "done", reply: "Hello.", summary: { text: "Hello.", toolCallCount: 0, files: [], cost: null, approvals: [] } });
  });

  it("summarizes what followed the anchor only, with every card outcome", () => {
    const summary = summarizeTurn({ messages: [
      { id: "s0", role: "bot", kind: "activity", tool: { name: "Old", ok: true, files: ["old.txt"] } },
      { id: "m1", role: "user", kind: "text", text: "go" },
      { id: "c1", role: "bot", kind: "options", card: { title: "A", requestId: "r1", answered: "deny", answeredBy: { kind: "session", name: "Ann" } } },
      { id: "c2", role: "bot", kind: "options", card: { title: "B", requestId: "r2", expired: true } },
      { id: "c3", role: "bot", kind: "options", card: { title: "C", requestId: "r3", answered: "answer", answeredBy: { kind: "loopback" } } },
      { id: "d1", role: "bot", kind: "digest", digest: { usage: { input: 10, output: 5 } } },
      { id: "d2", role: "bot", kind: "digest", digest: { usage: { input: 1, output: 2, costUsd: 0.5 } } },
    ] }, "m1", null);
    expect(summary.toolCalls).toEqual([]);
    expect(summary.files).toEqual([]);
    expect(summary.text).toBeNull();
    expect(summary.cost).toEqual({ inputTokens: 11, outputTokens: 7, costUsd: 0.5, turns: 2 });
    expect(summary.approvals.map((a) => [a.id, a.decision, a.by])).toEqual([["r1", "deny", "Ann"], ["r2", "expired", null], ["r3", "answered", "this computer"]]);
  });
});

describe("who may answer a card (lot C.3)", () => {
  const ok = () => ({ status: 200, body: { ok: true, messages: [] } });

  it("the bot's owner answers the cards of their own bots without clients.approvalsAnswer", async () => {
    cards.set("t1/req_1", { open: true, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: false });
    respond = ok;
    const check = await call("GET", "approvals/req_1?threadId=t1", token("bob"));
    expect(check.body).toEqual({ id: "req_1", threadId: "t1", open: true, canAnswer: true, whoCanApprove: { kind: "owner", principalId: "pr_bob", name: "Bob", sentence: "The bot's owner, Bob." } });
    const answered = await call("POST", "approvals/req_1", token("bob"), { threadId: "t1", decision: "allow" });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect(performed.at(-1)!.request).toEqual({ method: "POST", path: "/api/threads/t1/respond", body: { requestId: "req_1", behavior: "allow" } });
  });

  it("a member cannot answer on a bot they do not own; the permission alone does not beat Sagax's owner rule", async () => {
    cards.set("t2/req_2", { open: true, ownerPrincipalId: "pr_ann", ownerName: "Ann", adminOnly: false });
    respond = ok;
    const check = await call("GET", "approvals/req_2?threadId=t2", token("bob"));
    expect(check.body).toMatchObject({ canAnswer: false, permission: "clients.approvalsAnswer", whoCanApprove: { kind: "owner", principalId: "pr_ann", name: "Ann" } });
    const before = performed.length;
    const refused = await call("POST", "approvals/req_2", token("bob"), { threadId: "t2", decision: "allow" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "forbidden_permission", permission: "clients.approvalsAnswer" });
    expect(performed.length).toBe(before);
    expect(noted).toEqual([]);
    // Granted by an admin: the gate lets them through, the check still names
    // Sagax's own rule (the owner answers).
    people.get("bob")!.permissions.push("clients.approvalsAnswer");
    const granted = await call("GET", "approvals/req_2?threadId=t2", token("bob"));
    expect(granted.body).toMatchObject({ canAnswer: false, reason: "Only the bot owner can answer this approval." });
    expect(granted.body.permission).toBeUndefined();
  });

  it("an admin answers a server command of a member's bot; the member owner cannot", async () => {
    cards.set("t3/req_3", { open: true, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: true });
    respond = ok;
    const admin = await call("GET", "approvals/req_3?threadId=t3", token("ann", "admin"));
    expect(admin.body).toMatchObject({ canAnswer: true, whoCanApprove: { kind: "admin" } });
    expect((await call("POST", "approvals/req_3", token("ann", "admin"), { threadId: "t3", decision: "deny" })).status).toBe(200);
    const owner = await call("GET", "approvals/req_3?threadId=t3", token("bob"));
    expect(owner.body).toMatchObject({ canAnswer: false, reason: "Only an organization admin can approve this command.", whoCanApprove: { kind: "admin", sentence: expect.stringContaining("organization admin") } });
  });

  it("an answered card, an unknown card or an unreadable thread is said so", async () => {
    cards.set("t1/req_9", { open: false, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: false });
    respond = ok;
    expect((await call("GET", "approvals/req_9?threadId=t1", token("bob"))).body).toMatchObject({ open: false, canAnswer: false });
    expect((await call("GET", "approvals/nope?threadId=t1", token("bob"))).status).toBe(404);
    expect((await call("GET", "approvals/req_9", token("bob"))).status).toBe(400);
    respond = () => ({ status: 404, body: { error: "no such conversation" } });
    expect((await call("GET", "approvals/req_9?threadId=t1", token("bob"))).body).toMatchObject({ code: "not_found", message: "no such conversation" });
  });
});
