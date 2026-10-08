// The streaming voice's page side (speech-stream.ts) against a fake of the
// server's socket: open and stream, a cancel on barge-in, a clause failed by
// a dropped socket spoken over POST, two errors or a server fallback switch
// the call to POST, a socket that does not open in 1.5 s too; and the
// clause splitting without the 36 character wait.
import { afterEach, describe, expect, it, vi } from "vitest";

import { SentenceStream, STREAMING_CLAUSES } from "./sentences";
import { SPEECH_OPEN_MS, SpeechSocket } from "./speech-stream";

class FakeServer {
  readyState = 0;
  binaryType = "blob";
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  constructor(readonly url: string) {}
  addEventListener(type: string, cb: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  fire(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  ready() {
    this.readyState = 1;
    this.text({ type: "ready", sampleRate: 24_000 });
  }
  text(frame: Record<string, unknown>) {
    this.fire("message", { data: JSON.stringify(frame) });
  }
  audio(bytes: number) {
    this.fire("message", { data: new Uint8Array(bytes).fill(1).buffer });
  }
  says() {
    return this.sent.filter((m) => m.type === "say");
  }
}

const voice = { voice: "ara", speed: 1, language: "fr" };
const tick = () => new Promise((r) => setTimeout(r, 0));

function make(options: { openMs?: number } = {}) {
  const servers: FakeServer[] = [];
  const post = vi.fn(async (_b: string, text: string) => ({
    body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(`post:${text}`)); c.close(); } }),
    sampleRate: 24_000,
  }));
  const log = vi.fn();
  const socket = new SpeechSocket({
    botId: "b-1", threadId: () => "t-1", voice: () => voice,
    socket: (url) => {
      const server = new FakeServer(url);
      servers.push(server);
      return server as unknown as WebSocket;
    },
    post, log, ...(options.openMs !== undefined ? { openMs: options.openMs } : {}),
  });
  return { socket, servers, post, log, server: () => servers.at(-1)! };
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<number> {
  const reader = body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.byteLength;
  }
}

afterEach(() => vi.useRealTimers());

describe("streaming voice socket (page side)", () => {
  it("opens with the voice, speed and language, and streams each clause between start and done", async () => {
    const { socket, server, post } = make();
    const opened = socket.connect();
    expect(server().url).toContain("/api/bots/b-1/voice/speech?");
    expect(server().url).toMatch(/language=fr&speed=1&voice=ara&threadId=t-1/);
    server().ready();
    expect(await opened).toBe(true);
    const first = socket.speak("b-1", "Bonjour,", voice, "t-1");
    const second = socket.speak("b-1", "voici la suite.", voice, "t-1");
    await tick();
    expect(server().says().map((m) => m.text)).toEqual(["Bonjour,", "voici la suite."]);
    const [a, b] = server().says().map((m) => m.id as string);
    server().text({ type: "start", id: a });
    const audio = await first;
    expect(audio?.sampleRate).toBe(24_000);
    server().audio(4800);
    server().audio(4800);
    server().text({ type: "done", id: a });
    expect(await readAll(audio!.body)).toBe(9600);
    server().text({ type: "skip", id: b });
    expect(await second).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(socket.streaming).toBe(true);
  });

  it("a clause said while the socket opens waits for it, then goes", async () => {
    const { socket, server } = make();
    void socket.connect();
    void socket.speak("b-1", "Tout de suite.", voice, "t-1");
    await tick();
    expect(server().says()).toEqual([]);
    server().ready();
    expect(server().says().map((m) => m.text)).toEqual(["Tout de suite."]);
  });

  it("barge-in: an aborted clause is cancelled on the server and nothing of it plays after", async () => {
    const { socket, server } = make();
    void socket.connect();
    server().ready();
    const controller = new AbortController();
    const speech = socket.speak("b-1", "Une longue phrase.", voice, "t-1", controller.signal);
    await tick();
    const id = server().says()[0]!.id;
    server().text({ type: "start", id });
    const audio = (await speech)!;
    const reader = audio.body.getReader();
    server().audio(1000);
    expect((await reader.read()).value!.byteLength).toBe(1000);
    controller.abort();
    expect(server().sent.at(-1)).toEqual({ type: "cancel", id });
    // late frames of the cleared clause are dropped
    server().audio(1000);
    expect((await reader.read()).done).toBe(true);
  });

  it("the player letting go of a body (a cut) cancels the clause too", async () => {
    const { socket, server } = make();
    void socket.connect();
    server().ready();
    const speech = socket.speak("b-1", "Encore.", voice, "t-1");
    await tick();
    const id = server().says()[0]!.id;
    server().text({ type: "start", id });
    await (await speech)!.body.cancel();
    expect(server().sent.at(-1)).toEqual({ type: "cancel", id });
  });

  it("a dropped socket's clause with no audio yet is spoken over POST; one cut mid-way just ends", async () => {
    const { socket, server, post } = make();
    void socket.connect();
    server().ready();
    const heard = socket.speak("b-1", "Déjà entendue.", voice, "t-1");
    const waiting = socket.speak("b-1", "Pas encore.", voice, "t-1");
    await tick();
    const [a, b] = server().says().map((m) => m.id as string);
    server().text({ type: "start", id: a });
    const audio = (await heard)!;
    server().audio(2000);
    server().text({ type: "error", ids: [a, b] });
    expect(await readAll(audio.body)).toBe(2000);
    const rescued = (await waiting)!;
    expect(new TextDecoder().decode(new Uint8Array(await new Response(rescued.body).arrayBuffer()))).toBe("post:Pas encore.");
    expect(post).toHaveBeenCalledTimes(1);
    // one error: still streaming
    expect(socket.streaming).toBe(true);
  });

  it("a second error in the call: POST for the rest of it, logged once", async () => {
    const { socket, server, post, log } = make();
    void socket.connect();
    server().ready();
    void socket.speak("b-1", "Un.", voice, "t-1");
    await tick();
    server().text({ type: "error", ids: [server().says()[0]!.id] });
    void socket.speak("b-1", "Deux.", voice, "t-1");
    await tick();
    server().text({ type: "error", ids: [server().says()[1]!.id] });
    expect(socket.streaming).toBe(false);
    expect(server().closed).toBe(true);
    await socket.speak("b-1", "Trois.", voice, "t-1");
    expect(post.mock.calls.map((c) => c[1])).toEqual(["Un.", "Deux.", "Trois."]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toMatch(/failed 2 times/);
  });

  it("the server's fallback (its reconnects ran out) switches the call to POST", async () => {
    const { socket, server, post } = make();
    void socket.connect();
    server().ready();
    const pending = socket.speak("b-1", "En attente.", voice, "t-1");
    await tick();
    server().text({ type: "fallback" });
    expect(socket.streaming).toBe(false);
    await pending;
    expect(post).toHaveBeenCalledWith("b-1", "En attente.", voice, "t-1", undefined);
  });

  it("a socket that does not open within 1.5 s: POST for the call", async () => {
    vi.useFakeTimers();
    const { socket, post, log } = make();
    const opened = socket.connect();
    const pending = socket.speak("b-1", "Lent.", voice, "t-1");
    await vi.advanceTimersByTimeAsync(SPEECH_OPEN_MS - 10);
    expect(socket.streaming).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(await opened).toBe(false);
    expect(socket.streaming).toBe(false);
    await pending;
    expect(post).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toMatch(/did not open within 1500 ms/);
  });

  it("a socket that closes: POST for the call", async () => {
    const { socket, server, post } = make();
    void socket.connect();
    server().ready();
    server().fire("close", {});
    expect(socket.streaming).toBe(false);
    await socket.speak("b-1", "Après.", voice, "t-1");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("another voice mid-call: a new socket for it between answers, POST while a clause is in flight", async () => {
    const { socket, servers, post } = make();
    void socket.connect();
    servers[0]!.ready();
    const eve = { ...voice, voice: "eve" };
    const busy = socket.speak("b-1", "En cours.", voice, "t-1");
    await tick();
    await socket.speak("b-1", "Autre voix.", eve, "t-1");
    expect(post).toHaveBeenCalledTimes(1);
    expect(servers).toHaveLength(1);
    servers[0]!.text({ type: "skip", id: servers[0]!.says()[0]!.id });
    await busy;
    // nothing in flight: a socket with Eve, and the clause waits for it
    const next = socket.speak("b-1", "Avec Eve.", eve, "t-1");
    expect(servers).toHaveLength(2);
    expect(servers[0]!.closed).toBe(true);
    expect(servers[1]!.url).toContain("voice=eve");
    servers[1]!.ready();
    expect(servers[1]!.says().map((m) => m.text)).toEqual(["Avec Eve."]);
    servers[1]!.text({ type: "skip", id: servers[1]!.says()[0]!.id });
    expect(await next).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("hang-up closes the socket and ends what was in flight", async () => {
    const { socket, server } = make();
    void socket.connect();
    server().ready();
    const pending = socket.speak("b-1", "Fin.", voice, "t-1");
    socket.close();
    expect(await pending).toBeNull();
    expect(server().closed).toBe(true);
  });
});

describe("clauses without the 36 character wait (streaming voice)", () => {
  it("the first clause goes at its first comma once it has two words", () => {
    const stream = new SentenceStream(STREAMING_CLAUSES);
    expect(stream.feed("Bien sûr, ")).toEqual(["Bien sûr,"]);
    expect(stream.feed("Bien sûr, il fait beau aujourd'hui à Montréal")).toEqual([]);
    // the POST path still waits for about six words
    expect(new SentenceStream().feed("Bien sûr, il fait")).toEqual([]);
  });

  it("a one word opener is not a clause on its own", () => {
    const stream = new SentenceStream(STREAMING_CLAUSES);
    expect(stream.feed("Well, ")).toEqual([]);
    expect(stream.feed("Well, it is sunny, ")).toEqual(["Well, it is sunny,"]);
  });

  it("sentences still end at their punctuation, and later short ones still join", () => {
    const stream = new SentenceStream(STREAMING_CLAUSES);
    expect(stream.feed("Sure. It is sunny. ")).toEqual(["Sure."]);
    expect(stream.finish("Sure. It is sunny. Yes.")).toEqual(["It is sunny. Yes."]);
  });
});
