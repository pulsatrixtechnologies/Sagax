// A Live call, end to end: boots the real harness against the fake GPT-Live
// (server/testing/fake-openai-live.ts) and the fake claude CLI, starts a call
// the way a client does, and plays the voice's side of it over the sideband.
// What is pinned here is the wiring the unit tests cannot see: the route
// creates the session with the restricted data channel, the controller
// attaches, a delegation becomes a user message "via call" on the bot's
// thread, the bot's answer comes back as spoken commentary on that
// delegation, and hanging up (or losing the sideband) ends the call for
// every client — with one summary line in the log and no words in it.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_COPY } from "../shared/live-approval.ts";
import type { LiveCallState } from "../shared/wire.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOpenAiLive, type FakeOpenAiLive } from "./testing/fake-openai-live.ts";
import { freePortBlock } from "./testing/ports.ts";
import { openSse } from "./testing/sse.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const LIVE_KEY = "sk-fake-e2e";
const SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("Live call e2e", () => {
  let child: ChildProcess;
  let home = "";
  let base = "";
  let output = "";
  let live: FakeOpenAiLive;

  /** Everything the harness printed: stdout is where server.log comes from. */
  const serverOutput = () => output;
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const createBot = async (instanceId = "claude", model = "claude-fake"): Promise<{ id: string; threadId: string }> => {
    const { bot } = (await post("/api/bots", {})).body as { bot: { id: string; threadId: string } };
    const res = await fetch(`${base}/api/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelSelection: { instanceId, model } }),
    });
    expect(res.status).toBe(200);
    return bot;
  };
  const isBusy = async (botId: string): Promise<boolean> => {
    const { bots } = (await (await fetch(`${base}/api/bots`)).json()) as { bots: Array<{ id: string; busy?: boolean }> };
    return bots.find((bot) => bot.id === botId)?.busy === true;
  };
  const spokenTurnsLogged = () => serverOutput().split("text=(spoken)").length - 1;
  /** Starts a call and returns it with the fake's record of its session. */
  const startCall = async (botId: string, client: LiveCallState["client"] = "desktop") => {
    const before = live.sessions.length;
    const started = await post("/api/live/session", { botId, sdp: SDP, client });
    expect(started.status).toBe(201);
    const { call } = started.body as { call: LiveCallState };
    const session = live.sessions[before];
    expect(session).toBeDefined();
    return { started, call, session };
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    live = await startFakeOpenAiLive();
    home = mkdtempSync(join(tmpdir(), "omb-live-call-"));
    mkdirSync(join(home, ".openmausbot"), { recursive: true });
    writeFileSync(
      join(home, ".openmausbot", "config.json"),
      JSON.stringify({
        instances: {
          claude: {
            driver: "claudeAgent",
            environment: { FAKE_CLAUDE_REPLIES: JSON.stringify(["Six times seven is 42."]) },
            config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
          },
          // cannot steer and never finishes: a request made while it works waits in the queue
          acp: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "hang" }, config: { cli: FAKE_ACP, fullAuto: true } },
          // every turn asks permission to run a command
          asks: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_ACP, fullAuto: false } },
          questions: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "question" }, config: { cli: FAKE_ACP, fullAuto: false } },
        },
      }),
    );
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home,
        USERPROFILE: home,
        SAGAX_PORT: String(port),
        SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_OPENAI_LIVE_URL: live.url,
        SAGAX_OPENAI_LIVE_KEY: LIVE_KEY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));
    // Generous: a loaded machine can take most of a minute to boot the harness.
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. output:\n${output}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. output:\n${output}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 120_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await live?.stop();
    if (home) await removeTempDir(home);
  });

  it("runs a spoken request through the bot and speaks the answer", async () => {
    const bot = await createBot();
    const sse = await openSse(`${base}/api/events`);
    try {
      const { started, call, session } = await startCall(bot.id);
      // the key goes to OpenAI and nowhere else
      expect(JSON.stringify(started.body)).not.toContain(LIVE_KEY);
      expect(call).toMatchObject({ botId: bot.id, threadId: bot.threadId, client: "desktop" });
      // the client's data channel may only hang up
      expect(session.body).toMatchObject({ session: { client: { data_channel: { allowed_client_events: ["session.close"] } } } });
      await live.waitForAttach(session.id);
      await sse.until((frame) => frame.kind === "live.call" && frame.call?.callId === call.callId && frame.call?.status === "live");

      live.emit(session.id, { type: "session.input_transcript.delta", delta: "what is six times seven", start_ms: 100, end_ms: 900 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 950, delegation: { id: "del_1", target: "client", type: "delegation" } });

      const asked = await sse.until(
        (frame) => frame.kind === "message" && frame.threadId === bot.threadId && frame.message?.role === "user" && frame.message?.via === "call",
      );
      expect(asked.message.text).toBe("what is six times seven");
      const spoken = await live.waitForCommand(session.id, (c) => c.type === "session.commentary.append" && String(c.content).includes("42"), 20_000);
      expect(spoken.delegation_id).toBe("del_1");

      const ended = await post("/api/live/call/end", { callId: call.callId });
      expect(ended).toMatchObject({ status: 200, body: { call: { status: "ended", endReason: "hung-up" } } });
      expect(session.commands.some((c) => c.type === "session.close")).toBe(true);
      await sse.until((frame) => frame.kind === "live.call" && frame.call?.callId === call.callId && frame.call?.status === "ended");
      // The summary line is printed as the call finishes; the pipe can
      // deliver it a moment after the HTTP answer.
      await expect.poll(serverOutput, { timeout: 5_000 }).toMatch(/\[live\] call ended bot=\S+ .*client=desktop .*end=hung-up/);
      // the turn ran and was logged, without the words that started it
      expect(serverOutput()).toContain("text=(spoken)");
      expect(serverOutput()).not.toMatch(/six times seven/i);
      expect(serverOutput()).not.toContain(LIVE_KEY);
      expect(JSON.stringify(sse.frames)).not.toContain(LIVE_KEY);
    } finally {
      sse.close();
    }
  }, 40_000);

  it("answers 409 with the running call to a second client", async () => {
    const bot = await createBot();
    const { call, session } = await startCall(bot.id);
    await live.waitForAttach(session.id);

    const second = await post("/api/live/session", { botId: bot.id, sdp: SDP, client: "ios" });
    expect(second.status).toBe(409);
    expect((second.body as { activeCall: LiveCallState }).activeCall).toMatchObject({ callId: call.callId, client: "desktop" });
    // the refused start did not reach OpenAI
    expect(live.sessions.at(-1)).toBe(session);

    const ended = await post("/api/live/call/end", { callId: call.callId });
    expect(ended).toMatchObject({ status: 200, body: { call: { callId: call.callId, status: "ended" } } });
  }, 40_000);

  it("queues a spoken request while the bot is busy, and the drained turn still keeps the words out of the log", async () => {
    const bot = await createBot("acp", "fake-model");
    const sse = await openSse(`${base}/api/events`);
    try {
      expect((await post(`/api/bots/${bot.id}/messages`, { text: "first" })).status).toBe(202);
      await expect.poll(() => isBusy(bot.id), { timeout: 20_000 }).toBe(true);
      const { call, session } = await startCall(bot.id);
      await live.waitForAttach(session.id);

      live.emit(session.id, { type: "session.input_transcript.delta", delta: "spell the word banana", start_ms: 100, end_ms: 900 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 950, delegation: { id: "del_q", target: "client", type: "delegation" } });
      await sse.until(
        (frame) => frame.kind === "bot.queued" && (frame.queues?.[bot.threadId] ?? []).some((item: { text?: string }) => item.text === "spell the word banana"),
        20_000,
      );

      // Stop frees the thread: the spoken line leaves the queue as its own turn
      const logged = spokenTurnsLogged();
      await post(`/api/bots/${bot.id}/interrupt`, {});
      const drained = await sse.until(
        (frame) => frame.kind === "message" && frame.threadId === bot.threadId && frame.message?.text === "spell the word banana",
        20_000,
      );
      expect(drained.message).toMatchObject({ role: "user", via: "call" });
      await expect.poll(spokenTurnsLogged, { timeout: 10_000 }).toBeGreaterThan(logged);
      expect(serverOutput()).not.toMatch(/banana/i);

      await post(`/api/bots/${bot.id}/interrupt`, {});
      await expect.poll(() => isBusy(bot.id), { timeout: 20_000 }).toBe(false);
      expect(await post("/api/live/call/end", { callId: call.callId })).toMatchObject({ status: 200 });
    } finally {
      sse.close();
    }
  }, 60_000);

  it("stops waiting for a queued spoken request once it is cancelled in the chat", async () => {
    const bot = await createBot("acp", "fake-model");
    const sse = await openSse(`${base}/api/events`);
    try {
      const { call, session } = await startCall(bot.id);
      await live.waitForAttach(session.id);
      // a spoken request starts a turn that does not finish on its own
      live.emit(session.id, { type: "session.input_transcript.delta", delta: "check the build", start_ms: 100, end_ms: 900 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 950, delegation: { id: "del_a", target: "client", type: "delegation" } });
      await expect.poll(() => isBusy(bot.id), { timeout: 20_000 }).toBe(true);
      // the next one waits in the queue
      live.emit(session.id, { type: "session.input_transcript.delta", delta: "and the tests", start_ms: 2_000, end_ms: 2_800 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 2_850, delegation: { id: "del_b", target: "client", type: "delegation" } });
      const waiting = await sse.until(
        (frame) => frame.kind === "bot.queued" && (frame.queues?.[bot.threadId] ?? []).some((item: { text?: string }) => item.text === "and the tests"),
        20_000,
      );
      const { queueId } = (waiting.queues[bot.threadId] as Array<{ queueId: string; text: string }>).find((item) => item.text === "and the tests")!;

      // cancelled in the chat (editing a queued line cancels it too), it never arrives
      const cancelled = await fetch(`${base}/api/bots/${bot.id}/queue/${queueId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: bot.threadId }),
      });
      expect(cancelled.status).toBe(200);
      // Stop ends the first request's turn without an answer: with nothing
      // left waiting, the voice says where the result is
      await post(`/api/bots/${bot.id}/interrupt`, {});
      await live.waitForCommand(session.id, (c) => c.type === "session.commentary.append" && c.content === LIVE_COPY.noAnswer, 20_000);
      expect(await post("/api/live/call/end", { callId: call.callId })).toMatchObject({ status: 200 });
    } finally {
      sse.close();
    }
  }, 60_000);

  // A phone reaches the harness through the companion, as this computer's
  // own requests: only the companion can say the phone was unpaired.
  it("ends a phone's call, and refuses it another, once the companion says it was unpaired", async () => {
    const bot = await createBot();
    const phone = { "x-openmausbot-companion": "1", "x-openmausbot-companion-device": "phone-e2e" };
    const sse = await openSse(`${base}/api/events`);
    try {
      const before = live.sessions.length;
      const started = await post("/api/live/session", { botId: bot.id, sdp: SDP, client: "ios" }, phone);
      expect(started.status).toBe(201);
      const { call } = started.body as { call: LiveCallState };
      const session = live.sessions[before];
      await live.waitForAttach(session.id);
      await sse.until((frame) => frame.kind === "live.call" && frame.call?.callId === call.callId && frame.call?.status === "live");

      // another phone's unpairing is not this call's business
      expect(await post("/api/live/device-revoked", {}, { ...phone, "x-openmausbot-companion-device": "phone-other" }))
        .toEqual({ status: 200, body: { call: null } });
      expect(await post("/api/live/device-revoked", {}, phone)).toMatchObject({ status: 200, body: { call: { callId: call.callId } } });
      await live.waitForCommand(session.id, (c) => c.type === "session.close", 5_000);
      const ended = await sse.until(
        (frame) => frame.kind === "live.call" && frame.call?.callId === call.callId && frame.call?.status === "ended",
        10_000,
      );
      expect(ended.call).toMatchObject({ endReason: "signed-out", error: LIVE_COPY.unpaired });
      const again = await post("/api/live/session", { botId: bot.id, sdp: SDP, client: "ios" }, phone);
      expect(again.status).toBe(401);
      await expect.poll(serverOutput, { timeout: 5_000 }).toMatch(/\[live\] call ended .*client=ios .*end=signed-out/);
    } finally {
      sse.close();
    }
  }, 40_000);

  // A worker such as the Slack relay sends through the guarded route, for
  // someone else and as this computer. The caller did not type that line, so
  // the voice never reads it (or its answer) back as "what you typed".
  it("never reads back a line a worker relayed into the call's chat as the caller's own", async () => {
    const bot = await createBot();
    const { call, session } = await startCall(bot.id);
    type Line = { id: string; role: string; text?: string; relayed?: boolean; requestMessageId?: string; turnTerminal?: boolean };
    const lines = async () => ((await (await fetch(`${base}/api/threads/${bot.threadId}/messages`)).json()) as { messages: Line[] }).messages;
    try {
      await live.waitForAttach(session.id);
      const page = (await (await fetch(`${base}/api/threads/${bot.threadId}/messages?limit=0`)).json()) as { activeLeafId?: string | null };
      const relayed = await post(`/api/bots/${bot.id}/messages/guarded`, {
        threadId: bot.threadId, sendId: "slackjob_live_call_relay_1", text: "relayed from Slack",
        expectedActiveLeafId: page.activeLeafId ?? null, onBehalfOf: { email: "ada@example.test", name: "Ada" },
      });
      expect(relayed.status, JSON.stringify(relayed.body)).toBe(202);
      const relayedId = (relayed.body as { message: { id: string } }).message.id;
      // the bot answers it in the chat, and the thread is free again
      await expect.poll(async () => (await lines()).some((m) => m.requestMessageId === relayedId && m.turnTerminal), { timeout: 20_000 }).toBe(true);
      await expect.poll(() => isBusy(bot.id), { timeout: 20_000 }).toBe(false);

      // A line the caller typed is read back; the relayed one before it was not.
      expect((await post(`/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "typed on the desktop", sendId: "typed-live-call-e2e-0001" })).status).toBe(202);
      await live.waitForCommand(session.id, (c) => c.type === "session.commentary.append" && String(c.content).includes("typed on the desktop"), 20_000);
      const said = session.commands.filter((c) => c.type === "session.commentary.append").map((c) => String(c.content));
      expect(said).toHaveLength(1);
      expect(said[0]).not.toContain("relayed from Slack");

      const stored = await lines();
      expect(stored.find((m) => m.id === relayedId)).toMatchObject({ role: "user", relayed: true });
      expect(stored.find((m) => m.text === "typed on the desktop")?.relayed).toBeUndefined();
    } finally {
      await post("/api/live/call/end", { callId: call.callId });
    }
  }, 60_000);

  // A card approved by voice says so, on the card and in the decision log.
  it("approves a card by voice and marks it as decided on the call", async () => {
    const bot = await createBot("asks", "fake-model");
    const { call, session } = await startCall(bot.id);
    try {
      await live.waitForAttach(session.id);
      live.emit(session.id, { type: "session.input_transcript.delta", delta: "run the check", start_ms: 100, end_ms: 900 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 950, delegation: { id: "del_p", target: "client", type: "delegation" } });
      await live.waitForCommand(session.id, (c) => c.type === "session.instructions.append" && String(c.content).includes("May I?"), 20_000);
      live.emit(session.id, { type: "session.input_transcript.delta", delta: "yes", start_ms: 5_000, end_ms: 5_300 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 5_400, delegation: { id: "del_y", target: "client", type: "delegation" } });
      type Card = { requestId?: string; answered?: string; answeredBy?: unknown };
      const approved = async () => {
        const { messages } = (await (await fetch(`${base}/api/threads/${bot.threadId}/messages`)).json()) as { messages: Array<{ card?: Card }> };
        return messages.find((m) => m.card?.requestId && m.card.answered === "allow")?.card;
      };
      await expect.poll(approved, { timeout: 20_000 }).toMatchObject({ answeredBy: { kind: "loopback", via: "call" } });
      const requestId = (await approved())!.requestId;
      const decision = async () => ((await (await fetch(`${base}/api/decisions`)).json()) as { decisions: Array<{ requestId?: string; decision: string; via?: string }> })
        .decisions.find((row) => row.requestId === requestId && row.decision === "user-approved");
      await expect.poll(decision, { timeout: 10_000 }).toMatchObject({ via: "call" });
    } finally {
      await post("/api/live/call/end", { callId: call.callId });
    }
  }, 60_000);

  it("reports a rejected question answer honestly and can retry it after the provider settles", async () => {
    const bot = await createBot("questions", "fake-model");
    const { call, session } = await startCall(bot.id);
    try {
      await live.waitForAttach(session.id);
      live.emit(session.id, { type: "session.input_transcript.delta", delta: "ask me which color", start_ms: 100, end_ms: 900 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 950, delegation: { id: "del_question", target: "client" } });
      await live.waitForCommand(session.id, (c) => c.type === "session.instructions.append" && String(c.content).includes("Which color"), 20_000);
      type Line = { id: string; role: string; replyToId?: string; via?: string; card?: { requestId?: string; answered?: string; answeredText?: string; answeredBy?: unknown } };
      const lines = async (): Promise<Line[]> => ((await (await fetch(`${base}/api/threads/${bot.threadId}/messages`)).json()) as { messages: Line[] }).messages;
      const original = (await lines()).find((m) => m.card?.requestId)!;
      live.emit(session.id, { type: "session.input_transcript.delta", delta: "Purple", start_ms: 5_000, end_ms: 5_300 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 5_400, delegation: { id: "del_rejected", target: "client" } });
      await live.waitForCommand(session.id, (c) => c.type === "session.commentary.append" && String(c.content).includes("could not be saved"), 5_000);
      expect((await lines()).find((m) => m.id === original.id)?.card).not.toHaveProperty("answeredText");
      expect(session.commands.some((c) => c.type === "session.thinking.append" && c.content === LIVE_COPY.answerPassed)).toBe(false);
      await expect.poll(() => isBusy(bot.id), { timeout: 5_000 }).toBe(false);

      live.emit(session.id, { type: "session.input_transcript.delta", delta: "Blue", start_ms: 8_000, end_ms: 8_300 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 8_400, delegation: { id: "del_retry", target: "client" } });
      await expect.poll(async () => (await lines()).find((m) => m.id === original.id)?.card, { timeout: 10_000 }).toMatchObject({ answered: "answer", answeredText: "Blue", answeredBy: { kind: "loopback", via: "call" } });
      expect((await lines()).find((m) => m.role === "user" && m.replyToId === original.id)).toMatchObject({ via: "call" });
      expect(serverOutput()).not.toContain("text=Blue");
    } finally {
      await post("/api/bots/" + bot.id + "/interrupt", { threadId: bot.threadId });
      await post("/api/live/call/end", { callId: call.callId });
    }
  }, 40_000);

  it("delivers a spoken answer to a persistent question after its turn is stopped", async () => {
    const bot = await createBot("questions", "fake-model");
    const { call, session } = await startCall(bot.id);
    try {
      await live.waitForAttach(session.id);
      live.emit(session.id, { type: "session.input_transcript.delta", delta: "ask me which color", start_ms: 100, end_ms: 900 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 950, delegation: { id: "del_stopped_question", target: "client" } });
      await live.waitForCommand(session.id, (c) => c.type === "session.instructions.append" && String(c.content).includes("Which color"), 20_000);
      type Line = { id: string; role: string; replyToId?: string; via?: string; card?: { requestId?: string; answered?: string; answeredText?: string; answeredBy?: unknown } };
      const lines = async (): Promise<Line[]> => ((await (await fetch(`${base}/api/threads/${bot.threadId}/messages`)).json()) as { messages: Line[] }).messages;
      const original = (await lines()).find((m) => m.card?.requestId)!;
      expect((await post(`/api/bots/${bot.id}/interrupt`, { threadId: bot.threadId })).status).toBe(200);
      await expect.poll(() => isBusy(bot.id), { timeout: 5_000 }).toBe(false);
      live.emit(session.id, { type: "session.input_transcript.delta", delta: "Green", start_ms: 5_000, end_ms: 5_300 });
      live.emit(session.id, { type: "session.delegation.created", offset_ms: 5_400, delegation: { id: "del_late", target: "client" } });
      await expect.poll(async () => (await lines()).find((m) => m.id === original.id)?.card, { timeout: 5_000 }).toMatchObject({ answered: "answer", answeredText: "Green", answeredBy: { kind: "loopback", via: "call" } });
      expect((await lines()).find((m) => m.role === "user" && m.replyToId === original.id)).toMatchObject({ via: "call" });
      expect(serverOutput()).not.toContain("text=Green");
    } finally {
      await post(`/api/bots/${bot.id}/interrupt`, { threadId: bot.threadId });
      await post("/api/live/call/end", { callId: call.callId });
    }
  }, 40_000);

  it("ends the call and tells clients when the sideband drops", async () => {
    const bot = await createBot();
    const sse = await openSse(`${base}/api/events`);
    try {
      const { call, session } = await startCall(bot.id);
      await live.waitForAttach(session.id);
      await sse.until((frame) => frame.kind === "live.call" && frame.call?.callId === call.callId && frame.call?.status === "live");

      live.dropSideband(session.id);

      const ended = await sse.until(
        (frame) => frame.kind === "live.call" && frame.call?.callId === call.callId && frame.call?.status === "ended",
      );
      expect(ended).toMatchObject({ botId: bot.id, threadId: bot.threadId, call: { endReason: "sideband-lost" } });
      // a client that connects now sees no call, and the slot is free again
      const current = await (await fetch(`${base}/api/live/call`)).json();
      expect(current).toEqual({ call: null });
      await expect.poll(serverOutput, { timeout: 5_000 }).toContain("end=sideband-lost");
    } finally {
      sse.close();
    }
  }, 40_000);
});
