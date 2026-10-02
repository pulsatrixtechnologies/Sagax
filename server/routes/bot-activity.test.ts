// The bot panel's activity list (GET /api/bots/:id/activity) and one
// entry's detail, through the route table: a person lists and opens only
// their own threads, sees a routine run only when routineSeenBy says so
// (without its private thread), and a sub-agent on someone else's thread
// shows no request text.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope } from "../request-auth.ts";
import type { RoutineRun } from "../../shared/routines.ts";
import type { BotActivityDetail, BotActivityItem } from "../../shared/bot-activity.ts";
import { createBotActivityRoutes, type ActivityMessage, type ActivityTask, type BotActivityRouteDeps } from "./bot-activity.ts";
import { dispatchRoutes } from "./table.ts";

const NOW = 1_800_000_000_000;
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const tasks: ActivityTask[] = [
  { threadId: "t-alice", title: "Refactor the parser", createdAt: NOW - 60_000, updatedAt: NOW - 1_000, busy: true, activity: "working", turnStartedAt: NOW - 30_000, ownerPrincipalId: "alice" },
  { threadId: "t-bob", title: "Bob's secret plan", createdAt: NOW - 120_000, updatedAt: NOW - 5_000, ownerPrincipalId: "bob" },
  { threadId: "t-routine", title: "Nightly dispatch", createdAt: NOW - 600_000, updatedAt: NOW - 500_000, routineRunId: "run-1", ownerPrincipalId: "alice" },
  { threadId: "t-old", title: "Last month", createdAt: NOW - 40 * 86_400_000, updatedAt: NOW - 40 * 86_400_000, ownerPrincipalId: "alice" },
];
const runs = [
  { id: "run-1", routineId: "r1", routineName: "Nightly dispatch", botId: "pepper", status: "completed", target: "bot", runOn: "auto", scheduledFor: NOW - 600_000, startedAt: NOW - 600_000, finishedAt: NOW - 500_000, manual: false, createdAt: NOW - 600_000, threadId: "t-routine" },
] as unknown as RoutineRun[];
const messages: Record<string, ActivityMessage[]> = {
  "t-alice": [
    { id: "u1", role: "user", kind: "text", at: NOW - 30_000, text: "go" },
    { id: "a1", role: "bot", kind: "activity", at: NOW - 20_000, tool: { name: "mcp__sagax-desktop__shell", ok: true, summary: "ls", files: ["src/a.ts"] } },
    { id: "a2", role: "bot", kind: "activity", at: NOW - 10_000, tool: { name: "Edit", files: ["src/b.ts"] } },
    { id: "d1", role: "bot", kind: "digest", at: NOW - 9_000, digest: { access: { via: "subscription", payer: "speaker" } } },
  ],
  "t-bob": [
    { id: "u2", role: "user", kind: "text", at: NOW - 6_000 },
    { id: "b2", role: "bot", kind: "text", at: NOW - 5_000, turnSucceeded: false },
  ],
};

/** Threads are their owner's; routine runs: alice's (the bot owner), or
 * anyone holding run (carol). */
function deps(overrides: Partial<BotActivityRouteDeps> = {}): BotActivityRouteDeps {
  return {
    bot: (id) => (id === "pepper" ? { id, name: "Pepper", modelSelection: { instanceId: "claude", model: "sonnet" } } : id === "echo" ? { id, name: "Echo" } : null),
    tasks: (botId) => (botId === "pepper" ? tasks : []),
    viewerId: (auth) => (auth.kind === "session" ? auth.session.principalId : undefined),
    threadReadable: (botId, threadId, viewerId) => !viewerId || (botId === "echo" ? threadId === "t-echo-alice" && viewerId === "alice" : tasks.find((task) => task.threadId === threadId)?.ownerPrincipalId === viewerId),
    threadWritable: (botId, threadId, viewerId) => !viewerId || tasks.find((task) => task.threadId === threadId)?.ownerPrincipalId === viewerId,
    runs: (botId) => runs.filter((run) => run.botId === botId),
    runSeen: (_run, viewerId) => !viewerId || viewerId === "alice" || viewerId === "carol",
    messages: (threadId, limit) => ({ messages: (messages[threadId] ?? []).slice(-limit), hasMore: false }),
    children: (_botId, threadId) => threadId === "t-alice"
      ? [{ botId: "echo", threadId: "t-echo-alice", title: "Write the tests", status: "running", startedAt: NOW - 15_000 }]
      : threadId === "t-bob" ? [{ botId: "echo", threadId: "t-echo-bob", title: "Bob's private ask", status: "completed", startedAt: NOW - 4_000 }] : [],
    personName: (id) => ({ alice: "Alice", bob: "Bob" } as Record<string, string>)[id] ?? "",
    organization: () => true,
    now: () => NOW,
    ...overrides,
  };
}

async function serve(routeDeps: BotActivityRouteDeps = deps()): Promise<string> {
  const routes = [createBotActivityRoutes(routeDeps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const who = req.headers["x-viewer"];
    const auth = typeof who === "string"
      ? { kind: "session", scopes: ["client"], session: { id: who, principalId: who } }
      : { kind: "loopback", scopes: ["admin"] };
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: auth as never, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const get = async (base: string, path: string, viewer?: string) => {
  const res = await fetch(`${base}${path}`, { headers: viewer ? { "x-viewer": viewer } : {} });
  return { status: res.status, body: await res.json() as { items?: BotActivityItem[]; item?: BotActivityDetail } };
};

describe("bot activity API", () => {
  it("is open to a client session (member and phone) for reads only", () => {
    expect(requiredScope("GET", "/api/bots/pepper/activity")).toBe("client");
    expect(requiredScope("GET", "/api/bots/pepper/activity/item")).toBe("client");
    expect(requiredScope("POST", "/api/bots/pepper/activity")).not.toBe("client");
  });

  it("lists a person's own threads only, running first, and the routine runs they may see", async () => {
    const base = await serve();
    const alice = await get(base, "/api/bots/pepper/activity", "alice");
    expect(alice.status).toBe(200);
    expect(alice.body.items!.map((item) => item.id)).toEqual(["thread:t-alice", "thread:t-routine"]);
    expect(alice.body.items![0]).toMatchObject({ kind: "session", status: "running", title: "Refactor the parser", threadId: "t-alice", childCount: 1, startedBy: { kind: "person", name: "Alice" } });
    expect(alice.body.items![1]).toMatchObject({ kind: "routine", status: "finished", startedBy: { kind: "routine", name: "Nightly dispatch" } });

    const bob = await get(base, "/api/bots/pepper/activity", "bob");
    expect(bob.body.items!.map((item) => item.id)).toEqual(["thread:t-bob"]);
    expect(bob.body.items![0]).toMatchObject({ status: "failed" });
    expect(JSON.stringify(bob.body)).not.toContain("Refactor the parser");
    expect(JSON.stringify(alice.body)).not.toContain("secret plan");
  });

  it("shows a run-level holder the owner's routine run without its private thread", async () => {
    const base = await serve();
    const carol = await get(base, "/api/bots/pepper/activity", "carol");
    expect(carol.body.items).toEqual([expect.objectContaining({ id: "run:run-1", kind: "routine", title: "Nightly dispatch" })]);
    expect(carol.body.items![0]).not.toHaveProperty("threadId");
    const detail = await get(base, "/api/bots/pepper/activity/item?runId=run-1", "carol");
    expect(detail.status).toBe(200);
    expect(detail.body.item).toMatchObject({ steps: [], files: [], canStop: false });
    expect(detail.body.item).not.toHaveProperty("threadId");
    // Someone without run sees no run at all.
    expect((await get(base, "/api/bots/pepper/activity/item?runId=run-1", "bob")).status).toBe(404);
  });

  it("opens the detail of one's own thread: steps with where they ran, files, payer, sub-agents", async () => {
    const base = await serve();
    const { status, body } = await get(base, "/api/bots/pepper/activity/item?threadId=t-alice", "alice");
    expect(status).toBe(200);
    expect(body.item).toMatchObject({
      engine: { instanceId: "claude", model: "sonnet" },
      via: "subscription",
      payer: "speaker",
      files: ["src/a.ts", "src/b.ts"],
      canStop: true,
    });
    expect(body.item!.steps).toEqual([
      expect.objectContaining({ name: "mcp__sagax-desktop__shell", ok: true, where: "computer" }),
      expect.objectContaining({ name: "Edit", where: "server" }),
    ]);
    expect(body.item!.steps[1]).not.toHaveProperty("ok");
    expect(body.item!.children).toEqual([expect.objectContaining({ kind: "subagent", botName: "Echo", title: "Write the tests", threadId: "t-echo-alice", status: "running" })]);
  });

  it("answers another person's thread exactly like a missing one", async () => {
    const base = await serve();
    expect((await get(base, "/api/bots/pepper/activity/item?threadId=t-bob", "alice")).status).toBe(404);
    expect((await get(base, "/api/bots/pepper/activity/item?threadId=nope", "alice")).status).toBe(404);
    expect((await get(base, "/api/bots/ghost/activity", "alice")).status).toBe(404);
  });

  it("hides a sub-agent's request text when its thread is not the viewer's", async () => {
    const base = await serve();
    const { body } = await get(base, "/api/bots/pepper/activity/item?threadId=t-bob", "bob");
    expect(body.item!.children).toEqual([expect.objectContaining({ botId: "echo", title: "Echo", status: "finished" })]);
    expect(body.item!.children[0]).not.toHaveProperty("threadId");
    expect(JSON.stringify(body)).not.toContain("private ask");
  });

  it("gives the operator (no viewer) everything, and no place labels on a solo server", async () => {
    const base = await serve(deps({ organization: () => false }));
    const list = await get(base, "/api/bots/pepper/activity");
    expect(list.body.items!.map((item) => item.id)).toEqual(["thread:t-alice", "thread:t-bob", "thread:t-routine"]);
    const detail = await get(base, "/api/bots/pepper/activity/item?threadId=t-alice");
    expect(detail.body.item!.steps.every((step) => !("where" in step))).toBe(true);
  });

  it("refuses writes and a detail without a target", async () => {
    const base = await serve();
    expect((await fetch(`${base}/api/bots/pepper/activity`, { method: "POST" })).status).toBe(405);
    expect((await get(base, "/api/bots/pepper/activity/item")).status).toBe(400);
  });
});
