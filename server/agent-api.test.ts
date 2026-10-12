import { describe, expect, it } from "vitest";

import {
  AGENT_TOOL_NAMES, AGENT_TOOL_POLICY, COLD_PAGE_SIZE, createAgentApi, ENTRY_TEXT_MAX, decodeCursor, encodeCursor, FIND_LIMIT_MAX,
  matchScore, SEND_FILES_MAX, signHandle, verifyHandle,
  type AgentApiDeps, type AgentCaller, type AgentScope, type AgentSummary, type AuditEntry, type FileInput, type StoredMessage, type TurnState,
} from "./agent-api.ts";

const SECRET = Buffer.alloc(32, 7);
const ALL: AgentScope[] = ["agents.read", "agents.send", "agents.create"];

/** A small Sagax: agents, conversations, a fake runtime that answers a
 * prompt a few polls later, and a virtual clock. */
function world(options: { replyAfterPolls?: number; reply?: (prompt: string) => string; reachable?: (caller: AgentCaller, agent: AgentSummary) => boolean } = {}) {
  let clock = 1_791_500_000_000;
  let ids = 0;
  const agents: AgentSummary[] = [
    { id: "bot-a", name: "Alpha", description: "Answers questions about invoices", status: "idle" },
    { id: "bot-b", name: "Beta", description: "Dispatch and scheduling of technicians", status: "idle" },
    { id: "bot-c", name: "Gamma Reports", description: "Writes weekly reports", status: "running" },
  ];
  const threads = new Map<string, { agentId: string; owner: string; title: string; hidden: boolean }>();
  const messages = new Map<string, StoredMessage[]>();
  const state = new Map<string, TurnState>();
  const pending = new Map<string, { polls: number; prompt: string }>();
  const audits: Array<{ caller: string; entry: AuditEntry }> = [];
  const notified: string[] = [];
  const interrupted: string[] = [];
  const turnStateCalls: string[] = [];
  const posted: Array<{ threadId: string; files: FileInput[] }> = [];
  const add = (threadId: string, message: Omit<StoredMessage, "id" | "at">) => {
    const row = { ...message, id: `m${++ids}`, at: clock++ } as StoredMessage;
    messages.set(threadId, [...(messages.get(threadId) ?? []), row]);
    return row;
  };
  const tick = () => {
    for (const [threadId, job] of pending) {
      job.polls -= 1;
      if (job.polls <= 0) {
        pending.delete(threadId);
        const text = (options.reply ?? ((p) => `echo: ${p}`))(job.prompt);
        if (text) add(threadId, { role: "bot", kind: "text", text });
        state.set(threadId, "idle");
      }
    }
  };
  const key = (caller: AgentCaller) => `${caller.kind}:${caller.id}`;
  const deps: AgentApiDeps = {
    agents: (caller) => agents.filter((agent) => (options.reachable ? options.reachable(caller, agent) : true)),
    async createAgent(_caller, input) {
      const agent = { id: `bot-${++ids}`, name: input.name, description: input.description, status: "idle" as const };
      agents.push(agent);
      return agent;
    },
    threads: (caller, agentId) => [...threads].filter(([, t]) => t.agentId === agentId && t.owner === key(caller)).map(([threadId, t]) => ({ threadId, title: t.title, hidden: t.hidden })),
    messages: (threadId) => messages.get(threadId) ?? [],
    turnState: (_agentId, threadId) => {
      turnStateCalls.push(threadId);
      return state.get(threadId) ?? "idle";
    },
    async conversation(caller, agentId) {
      const found = [...threads].find(([, t]) => t.agentId === agentId && t.owner === key(caller));
      if (found) return { threadId: found[0] };
      const threadId = `t${++ids}`;
      threads.set(threadId, { agentId, owner: key(caller), title: `${caller.name} via agent API`, hidden: true });
      return { threadId };
    },
    async post(_caller, _agentId, threadId, prompt, files) {
      posted.push({ threadId, files });
      const row = add(threadId, { role: "user", kind: "text", text: prompt });
      state.set(threadId, "running");
      pending.set(threadId, { polls: options.replyAfterPolls ?? 3, prompt });
      return { messageId: row.id };
    },
    async interrupt(_agentId, threadId) {
      interrupted.push(threadId);
      pending.delete(threadId);
      state.set(threadId, "idle");
    },
    notify: (caller, agent, result) => notified.push(`${agent.id}:${result.finished}:${result.reply}${caller.speakerPrincipalId ? `:as:${caller.speakerPrincipalId}` : ""}`),
    audit: (caller, entry) => audits.push({ caller: key(caller), entry }),
    secret: SECRET,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      tick();
    },
  };
  return { deps, api: createAgentApi(deps), agents, threads, messages, state, audits, notified, interrupted, turnStateCalls, posted, add, advance: (ms: number) => { clock += ms; }, settle: async () => { for (let i = 0; i < 50; i++) await deps.sleep!(400); } };
}

const bot = (id: string, scopes: AgentScope[] = ALL): AgentCaller => ({ kind: "bot", id, name: id, scopes: new Set(scopes), via: "agents-mcp", sourceThreadId: `src-${id}` });
const person = (id: string, scopes: AgentScope[] = ALL): AgentCaller => ({ kind: "person", id, name: id, scopes: new Set(scopes), via: "perspicax-mcp" });

describe("agent API policy", () => {
  it("declares ten tools, each with a scope, an access level and a read-only flag", () => {
    expect(AGENT_TOOL_NAMES).toHaveLength(10);
    for (const name of AGENT_TOOL_NAMES) {
      const policy = AGENT_TOOL_POLICY[name];
      expect(policy.readOnly).toBe(policy.access === "read");
      expect(policy.rate).toBeGreaterThan(0);
    }
    expect(AGENT_TOOL_POLICY.create_agent.access).toBe("admin");
    expect(AGENT_TOOL_POLICY.send_prompt.scope).toBe("agents.send");
  });

  it("refuses a tool whose scope the caller lacks, and audits the refusal", async () => {
    const w = world();
    const r = await w.api.call(bot("bot-x", ["agents.read"]), "send_prompt", { agent_id: "bot-a", prompt: "hi" });
    expect(r.status).toBe(403);
    expect(r.body.scope).toBe("agents.send");
    expect(w.audits.at(-1)!.entry).toMatchObject({ tool: "send_prompt", outcome: "refused", code: "forbidden_scope" });
    expect(w.posted).toHaveLength(0);
  });

  it("rate-limits per caller and tool", async () => {
    const w = world();
    const caller = person("pr_1");
    for (let i = 0; i < AGENT_TOOL_POLICY.create_agent.rate; i++) {
      expect((await w.api.call(caller, "create_agent", { name: `Bot ${i}` })).status).toBe(200);
    }
    const over = await w.api.call(caller, "create_agent", { name: "One more" });
    expect(over.status).toBe(429);
    expect(over.body.retry_after_ms).toBeGreaterThan(0);
    // another caller is not affected
    expect((await w.api.call(person("pr_2"), "create_agent", { name: "Other" })).status).toBe(200);
  });

  it("audits every call without the prompt or the reply", async () => {
    const w = world();
    await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "top secret plan", mode: "blocking" });
    const row = w.audits.at(-1)!;
    expect(row.entry).toMatchObject({ tool: "send_prompt", agentId: "bot-a", outcome: "ok" });
    expect(JSON.stringify(row)).not.toContain("top secret");
    expect(row.entry.detail).toMatchObject({ mode: "blocking", onBusy: "supersede", files: 0, access: "write" });
  });

  it("refuses unknown tools and unknown parameters", async () => {
    const w = world();
    expect((await w.api.call(bot("x"), "delete_agent", {})).status).toBe(404);
    const r = await w.api.call(bot("x"), "list_agents", { foo: 1 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("foo");
  });
});

describe("list_agents / find_agents", () => {
  it("list_agents answers id, name, description and status of reachable agents only", async () => {
    const w = world({ reachable: (caller, agent) => caller.id !== "outsider" || agent.id === "bot-b" });
    const r = await w.api.call(bot("bot-x"), "list_agents", {});
    expect(r.body.agents).toEqual(w.agents.map(({ id, name, description, status }) => ({ id, name, description, status })));
    const isolated = await w.api.call(bot("outsider"), "list_agents", {});
    expect((isolated.body.agents as AgentSummary[]).map((a) => a.id)).toEqual(["bot-b"]);
  });

  it("find_agents ranks name over description, keeps best matches, filters status, caps limit at 64", async () => {
    const w = world();
    const r = await w.api.call(bot("x"), "find_agents", { query: "reports" });
    expect((r.body.agents as AgentSummary[]).map((a) => a.id)).toEqual(["bot-c"]);
    const desc = await w.api.call(bot("x"), "find_agents", { query: "technicians" });
    expect((desc.body.agents as AgentSummary[]).map((a) => a.id)).toEqual(["bot-b"]);
    const idle = await w.api.call(bot("x"), "find_agents", { query: "reports", status: "idle" });
    expect(idle.body.agents).toEqual([]);
    expect((await w.api.call(bot("x"), "find_agents", { query: "a", limit: FIND_LIMIT_MAX + 1 })).status).toBe(400);
    expect((await w.api.call(bot("x"), "find_agents", { query: "a", status: "busy" })).status).toBe(400);
    expect((await w.api.call(bot("x"), "find_agents", {})).status).toBe(400);
    expect(matchScore(w.agents[0]!, "alpha")).toBeGreaterThan(matchScore(w.agents[0]!, "invoices"));
  });

  it("find_agents never reveals an agent outside the caller's reach", async () => {
    const w = world({ reachable: (_caller, agent) => agent.id !== "bot-c" });
    const r = await w.api.call(bot("x"), "find_agents", { query: "reports" });
    expect(r.body.agents).toEqual([]);
  });
});

describe("create_agent", () => {
  it("creates one agent per call, says it greets the user, refuses a duplicate name", async () => {
    const w = world();
    const r = await w.api.call(person("pr_1"), "create_agent", { name: "Delta", description: "Handles quotes" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ agent: { name: "Delta", description: "Handles quotes", status: "idle" }, greeted: true });
    expect(String(r.body.note)).toContain("never quote its id");
    const dup = await w.api.call(person("pr_1"), "create_agent", { name: "delta" });
    expect(dup.status).toBe(409);
    expect((await w.api.call(person("pr_1"), "create_agent", { name: "two\nlines" })).status).toBe(400);
    expect((await w.api.call(person("pr_1"), "create_agent", { names: ["a", "b"] })).status).toBe(400);
  });

  it("needs the agents.create scope", async () => {
    const w = world();
    expect((await w.api.call(bot("x", ["agents.read", "agents.send"]), "create_agent", { name: "Nope" })).status).toBe(403);
  });
});

describe("send_prompt / await_turn", () => {
  it("fire_and_forget returns a handle once accepted, in the caller's hidden conversation", async () => {
    const w = world();
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "hello" });
    expect(r.body).toMatchObject({ accepted: true, mode: "fire_and_forget", finished: false, agent_id: "bot-a" });
    expect(String(r.body.handle)).toMatch(/^turn_/);
    expect(w.threads.get(String(r.body.thread_id))).toMatchObject({ hidden: true, owner: "bot:bot-x" });
  });

  it("blocking waits for the reply; empty reply with finished=true means no text", async () => {
    const w = world();
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "2+2?", mode: "blocking", timeout_ms: 30_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished", reply: "echo: 2+2?" });
    const silent = world({ reply: () => "" });
    const s = await silent.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "be quiet", mode: "blocking" });
    expect(s.body).toMatchObject({ finished: true, reply: "", note: "The turn finished without text." });
  });

  it("blocking past timeout_ms answers the handle; await_turn resumes without re-sending", async () => {
    const w = world({ replyAfterPolls: 20 });
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "slow", mode: "blocking", timeout_ms: 1_000 });
    expect(r.body).toMatchObject({ finished: false, status: "running" });
    expect(String(r.body.next)).toContain("never send the prompt again");
    const sent = w.posted.length;
    const a = await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-a", handle: r.body.handle, timeout_ms: 60_000 });
    expect(a.body).toMatchObject({ finished: true, reply: "echo: slow", handle: r.body.handle });
    expect(w.posted.length).toBe(sent);
  });

  it("async returns a handle and notifies at turn end", async () => {
    const w = world();
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "later", mode: "async" });
    expect(r.body).toMatchObject({ accepted: true, finished: false, mode: "async" });
    await w.settle();
    expect(w.notified).toEqual(["bot-a:true:echo: later"]);
  });

  it("async notify keeps the person the source turn spoke for (wake mounts their connectors)", async () => {
    const w = world();
    await w.api.call({ ...bot("bot-x"), speakerPrincipalId: "person-jc" }, "send_prompt", { agent_id: "bot-a", prompt: "later", mode: "async" });
    await w.settle();
    expect(w.notified).toEqual(["bot-a:true:echo: later:as:person-jc"]);
  });

  it("on_busy: supersede interrupts (default), reject refuses, queue leaves the running turn", async () => {
    const w = world({ replyAfterPolls: 50 });
    const caller = bot("bot-x");
    await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "first" });
    const rejected = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "second", on_busy: "reject" });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("busy");
    await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "third", on_busy: "queue" });
    expect(w.interrupted).toEqual([]);
    await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "fourth" });
    expect(w.interrupted).toHaveLength(1);
    expect((await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "x", on_busy: "later" })).status).toBe(400);
  });

  it("validates mode, timeout, prompt and files (8 max, workspace-relative, 25 MiB)", async () => {
    const w = world();
    const c = bot("bot-x");
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", mode: "sync" })).status).toBe(400);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", timeout_ms: 999 })).status).toBe(400);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "" })).status).toBe(400);
    const nine = Array.from({ length: SEND_FILES_MAX + 1 }, (_, i) => `f${i}.txt`);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", files: nine })).status).toBe(400);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", files: ["../etc/passwd"] })).status).toBe(400);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", files: ["/abs.txt"] })).status).toBe(400);
    const big = "A".repeat(Math.ceil((25 * 1024 * 1024 + 16) * 4 / 3));
    expect((await w.api.call(person("p"), "send_prompt", { agent_id: "bot-a", prompt: "x", files: [{ path: "big.bin", content_base64: big }] })).status).toBe(413);
    const okFiles = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", files: ["docs/a.md", "b.csv"] });
    expect(okFiles.body.files).toBe(2);
    expect(w.posted.at(-1)!.files.map((f) => f.path)).toEqual(["docs/a.md", "b.csv"]);
  });

  it("an agent outside reach is unknown; a handle answers only its caller and agent", async () => {
    const w = world({ reachable: (caller, agent) => caller.id !== "bot-y" || agent.id !== "bot-a" });
    expect((await w.api.call(bot("bot-y"), "send_prompt", { agent_id: "bot-a", prompt: "x" })).status).toBe(404);
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "x" });
    expect((await w.api.call(bot("bot-z"), "await_turn", { agent_id: "bot-a", handle: r.body.handle })).body.code).toBe("bad_handle");
    expect((await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-b", handle: r.body.handle })).body.code).toBe("bad_handle");
    expect((await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-a", handle: `${String(r.body.handle)}x` })).body.code).toBe("bad_handle");
  });

  it("await_turn without a handle waits for the in-flight turn, else returns the last message", async () => {
    const w = world();
    const c = bot("bot-x");
    const none = await w.api.call(c, "await_turn", { agent_id: "bot-a" });
    expect(none.body).toMatchObject({ finished: true, reply: "" });
    await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ping" });
    const waited = await w.api.call(c, "await_turn", { agent_id: "bot-a" });
    expect(waited.body).toMatchObject({ finished: true, reply: "echo: ping" });
    const idle = await w.api.call(c, "await_turn", { agent_id: "bot-a" });
    expect(idle.body).toMatchObject({ finished: true, status: "idle", reply: "echo: ping" });
  });

  it("handles are signed and expire", () => {
    const body = { a: "bot-a", t: "t1", m: "m1", i: 1000, c: "bot:x" };
    const handle = signHandle(SECRET, body);
    expect(verifyHandle(SECRET, handle, 2000)).toEqual(body);
    expect(verifyHandle(Buffer.alloc(32, 8), handle, 2000)).toBeNull();
    expect(verifyHandle(SECRET, handle, 1000 + 8 * 24 * 3_600_000)).toBeNull();
  });
});

describe("transcripts", () => {
  async function seeded() {
    const w = world();
    const c = bot("bot-x");
    for (const prompt of ["one", "two", "three"]) {
      await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt, mode: "blocking" });
    }
    return { w, c };
  }

  it("read_transcript returns every entry the caller may read, oldest first, never tool I/O", async () => {
    const { w, c } = await seeded();
    const tid = [...w.threads.keys()][0]!;
    w.add(tid, { role: "bot", kind: "activity", tool: { name: "Bash", ok: false } });
    w.add(tid, { role: "bot", kind: "reasoning", text: "private thoughts" });
    const r = await w.api.call(c, "read_transcript", { agent_id: "bot-a" });
    const entries = r.body.entries as Array<{ text: string; kind: string; role: string }>;
    expect(entries.map((e) => e.text)).toEqual(["one", "echo: one", "two", "echo: two", "three", "echo: three", "Bash (failed)"]);
    expect(entries.at(-1)!.kind).toBe("tool");
    expect(JSON.stringify(r.body)).not.toContain("private thoughts");
    // another caller reads none of it
    expect((await w.api.call(bot("bot-y"), "read_transcript", { agent_id: "bot-a" })).body.entries).toEqual([]);
  });

  it("read_latest_page pages backwards with sequence cursors", async () => {
    const { w, c } = await seeded();
    const first = await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 4 });
    expect((first.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["two", "echo: two", "three", "echo: three"]);
    const second = await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 4, cursor: first.body.next_cursor });
    expect((second.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["one", "echo: one"]);
    expect(second.body.next_cursor).toBeNull();
    expect((await w.api.call(c, "read_latest_page", { agent_id: "bot-a", cursor: "nope" })).status).toBe(400);
    expect((await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 0 })).status).toBe(400);
  });

  it("an answer stays under the byte budget and continues with next_cursor", async () => {
    const { w, c } = await seeded();
    const tid = [...w.threads.keys()][0]!;
    for (let n = 0; n < 70; n++) w.add(tid, { role: "bot", kind: "text", text: `${String(n).padStart(2, "0")}:${"x".repeat(ENTRY_TEXT_MAX + 50)}` });
    const r = await w.api.call(c, "read_transcript", { agent_id: "bot-a" });
    expect(Buffer.byteLength(JSON.stringify(r.body))).toBeLessThan(1024 * 1024);
    expect(r.body.truncated).toBe(true);
    expect(String(r.body.next)).toContain("next_cursor");
    const entries = r.body.entries as Array<{ text: string }>;
    expect(entries.at(-1)!.text.endsWith("\n[...]")).toBe(true);
    // the rest is reachable page by page, nothing lost or repeated
    const seen = entries.map((e) => e.text.slice(0, 3));
    let cursor = r.body.next_cursor as string | null;
    while (cursor) {
      const page = await w.api.call(c, "read_transcript_cold", { agent_id: "bot-a", cursor });
      expect(Buffer.byteLength(JSON.stringify(page.body))).toBeLessThan(1024 * 1024);
      seen.unshift(...(page.body.entries as Array<{ text: string }>).map((e) => e.text.slice(0, 3)));
      cursor = page.body.next_cursor as string | null;
    }
    expect(seen.length).toBe(6 + 70);
    expect(new Set(seen.slice(6)).size).toBe(70);
  });

  it("read_latest_page_with_threads adds per-thread counts", async () => {
    const { w, c } = await seeded();
    const r = await w.api.call(c, "read_latest_page_with_threads", { agent_id: "bot-a", limit: 2 });
    expect(r.body.threads).toEqual([expect.objectContaining({ count: 6, in_page: 2, hidden: true, status: "idle" })]);
  });

  it("read_transcript_page bounds by unix ms (inclusive) and a cursor", async () => {
    const { w, c } = await seeded();
    const all = (await w.api.call(c, "read_transcript", { agent_id: "bot-a" })).body.entries as Array<{ at: number; text: string }>;
    const r = await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 10, before_ms: all[3]!.at, after_ms: all[1]!.at });
    expect((r.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["echo: one", "two", "echo: two"]);
    const paged = await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 2, before_ms: all[3]!.at, after_ms: all[1]!.at });
    expect((paged.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["two", "echo: two"]);
    const rest = await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 2, before_ms: all[3]!.at, after_ms: all[1]!.at, cursor: paged.body.next_cursor });
    expect((rest.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["echo: one"]);
    expect((await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 2 })).status).toBe(400);
    expect((await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", before_ms: 5 })).status).toBe(400);
    expect((await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 2, before_ms: 5, after_ms: 9 })).status).toBe(400);
  });

  it("read_transcript_cold reads the stored transcript without touching live state", async () => {
    const { w, c } = await seeded();
    for (let i = 0; i < 60; i++) w.add([...w.threads.keys()][0]!, { role: "bot", kind: "text", text: `n${i}` });
    w.turnStateCalls.length = 0;
    const page = await w.api.call(c, "read_transcript_cold", { agent_id: "bot-a" });
    expect((page.body.entries as unknown[]).length).toBe(COLD_PAGE_SIZE);
    expect(page.body.cold).toBe(true);
    const next = await w.api.call(c, "read_transcript_cold", { agent_id: "bot-a", cursor: page.body.next_cursor });
    expect((next.body.entries as unknown[]).length).toBe(66 - COLD_PAGE_SIZE);
    expect(w.turnStateCalls).toEqual([]);
  });

  it("cursors round-trip and reject garbage", () => {
    const key = { at: 5, threadId: "t-1", id: "m_9" };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
    expect(decodeCursor("c1.zzz")).toBeNull();
    expect(decodeCursor("x")).toBeNull();
  });
});

describe("end to end: two bots", () => {
  it("bot A sends async to bot B, awaits the turn, then reads B's latest page", async () => {
    const w = world({ replyAfterPolls: 5, reply: (p) => `B did: ${p}` });
    const a = bot("bot-a");
    const listed = await w.api.call(a, "find_agents", { query: "dispatch" });
    const target = (listed.body.agents as AgentSummary[])[0]!;
    expect(target.id).toBe("bot-b");
    const sent = await w.api.call(a, "send_prompt", { agent_id: target.id, prompt: "schedule Bob on Monday", mode: "async" });
    expect(sent.body.accepted).toBe(true);
    const awaited = await w.api.call(a, "await_turn", { agent_id: target.id, handle: sent.body.handle, timeout_ms: 30_000 });
    expect(awaited.body).toMatchObject({ finished: true, reply: "B did: schedule Bob on Monday" });
    const latestPage = await w.api.call(a, "read_latest_page", { agent_id: target.id, limit: 5 });
    expect((latestPage.body.entries as Array<{ role: string; text: string }>).map((e) => [e.role, e.text])).toEqual([
      ["user", "schedule Bob on Monday"],
      ["agent", "B did: schedule Bob on Monday"],
    ]);
    // the conversation is hidden and belongs to A
    expect(w.threads.get(String(sent.body.thread_id))).toMatchObject({ hidden: true, owner: "bot:bot-a", agentId: "bot-b" });
    expect(w.audits.map((row) => row.entry.tool)).toEqual(["find_agents", "send_prompt", "await_turn", "read_latest_page"]);
  });
});
