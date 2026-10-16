// The streaming voice's page side (speech-stream.ts) against a fake of the
// server's socket: open and stream, a cancel on barge-in, a clause failed by
// a dropped socket spoken over POST, two errors or a server fallback switch
// the call to POST, a socket that does not open in 1.5 s too; and the
// clause splitting without the 36 character wait.
import { afterEach, describe, expect, it, vi } from "vitest";

import { SentenceStream, STREAMING_CLAUSES } from "./sentences";
import { SPEECH_OPEN_MS, SpeechSocket, unheardRest } from "./speech-stream";

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

function make(options: { openMs?: number; pingMs?: number } = {}) {
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
    post, log, ...(options.openMs !== undefined ? { openMs: options.openMs } : {}), ...(options.pingMs !== undefined ? { pingMs: options.pingMs } : {}),
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

  it("an utterance opens with say more:true, then append and finish, and audio can start before finish", async () => {
    const { socket, server } = make();
    void socket.connect();
    server().ready();
    const lead = socket.begin("b-1", "Four", voice, "t-1");
    await tick();
    expect(server().sent).toEqual([{ type: "say", id: "c1", text: "Four", more: true }]);
    server().text({ type: "start", id: "c1" });
    const audio = (await lead)!;
    server().audio(400);
    socket.append(" is");
    socket.finish();
    expect(server().sent.slice(1)).toEqual([
      { type: "append", id: "c1", text: " is" },
      { type: "finish", id: "c1" },
    ]);
    server().audio(400);
    server().text({ type: "done", id: "c1" });
    expect(await readAll(audio.body)).toBe(800);
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

  it("a dropped socket's clause with no audio yet is spoken over POST; one cut mid-way goes on from what its audio did not cover", async () => {
    const { socket, server, post } = make();
    void socket.connect();
    server().ready();
    const heard = socket.speak("b-1", "Une phrase assez longue pour être coupée au milieu.", voice, "t-1");
    const waiting = socket.speak("b-1", "Pas encore.", voice, "t-1");
    await tick();
    const [a, b] = server().says().map((m) => m.id as string);
    server().text({ type: "start", id: a });
    const audio = (await heard)!;
    // one second of audio: at least 10 characters said, inside the only clause: all of it again
    server().audio(48_000);
    server().text({ type: "error", ids: [a, b] });
    const bytes = new Uint8Array(await new Response(audio.body).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(48_000);
    expect(new TextDecoder().decode(bytes.subarray(48_000))).toBe("post:Une phrase assez longue pour être coupée au milieu.");
    const rescued = (await waiting)!;
    expect(new TextDecoder().decode(new Uint8Array(await new Response(rescued.body).arrayBuffer()))).toBe("post:Pas encore.");
    expect(post).toHaveBeenCalledTimes(2);
    // one error: still streaming
    expect(socket.streaming).toBe(true);
  });

  it("a server that answered pings and then goes silent (a half-dead socket) switches the call to POST", async () => {
    vi.useFakeTimers();
    const { socket, server, post, log } = make({ pingMs: 1_000 });
    void socket.connect();
    server().ready();
    const answer = socket.begin("b-1", "Un instant,", voice, "t-1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server().sent.at(-1)).toEqual({ type: "ping" });
    server().text({ type: "pong" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.streaming).toBe(true);
    // nothing answers now
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.streaming).toBe(false);
    expect(String(log.mock.calls[0]![0])).toMatch(/stopped answering/);
    socket.finish();
    await answer;
    expect(post).toHaveBeenCalled();
  });

  it("a server that never answers pings (older) is not dropped for it", async () => {
    vi.useFakeTimers();
    const { socket, server } = make({ pingMs: 1_000 });
    void socket.connect();
    server().ready();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(socket.streaming).toBe(true);
  });

  it("a whole text said while an answer's utterance is open goes over POST, never queued behind it", async () => {
    const { socket, server, post } = make();
    void socket.connect();
    server().ready();
    void socket.begin("b-1", "Je regarde", voice, "t-1");
    await tick();
    await socket.speak("b-1", "Voulez-vous approuver?", voice, "t-1");
    expect(post).toHaveBeenCalledWith("b-1", "Voulez-vous approuver?", voice, "t-1", undefined);
    expect(server().says()).toHaveLength(1);
    socket.finish();
    // once it is finished, a whole text goes over the socket again
    void socket.speak("b-1", "Merci.", voice, "t-1");
    await tick();
    expect(server().says().map((m) => m.text)).toEqual(["Je regarde", "Merci."]);
  });

  it("an open utterance the server ended (its idle end) opens again on the next words, into the same audio", async () => {
    const { socket, server } = make();
    void socket.connect();
    server().ready();
    const answer = socket.begin("b-1", "Un instant,", voice, "t-1");
    await tick();
    server().text({ type: "start", id: "c1" });
    const audio = (await answer)!;
    const read = new Response(audio.body).arrayBuffer();
    server().audio(100);
    server().text({ type: "done", id: "c1" });
    socket.append(" voici le billet.");
    expect(server().sent.at(-1)).toEqual({ type: "say", id: "c1", text: "voici le billet.", more: true });
    server().text({ type: "start", id: "c1" });
    server().audio(50);
    socket.finish();
    expect(server().sent.at(-1)).toEqual({ type: "finish", id: "c1" });
    server().text({ type: "done", id: "c1" });
    expect((await read).byteLength).toBe(150);
  });

  it("an open utterance the server ended, then finished with nothing more, just ends", async () => {
    const { socket, server } = make();
    void socket.connect();
    server().ready();
    const answer = socket.begin("b-1", "Un instant.", voice, "t-1");
    await tick();
    server().text({ type: "start", id: "c1" });
    const audio = (await answer)!;
    server().text({ type: "done", id: "c1" });
    socket.finish();
    expect(await new Response(audio.body).arrayBuffer()).toHaveProperty("byteLength", 0);
    expect(server().sent.some((m) => m.type === "finish")).toBe(false);
  });

  it("an answer is one utterance: begin, appends, one finish; a socket failing mid-answer goes on over POST, a sentence at a time", async () => {
    const { socket, server, post } = make();
    void socket.connect();
    server().ready();
    const answer = socket.begin("b-1", "Bonjour,", voice, "t-1");
    await tick();
    socket.append(" il fait beau.");
    expect(server().sent).toEqual([
      { type: "say", id: "c1", text: "Bonjour,", more: true },
      { type: "append", id: "c1", text: " il fait beau." },
    ]);
    server().text({ type: "start", id: "c1" });
    const audio = (await answer)!;
    const read = new Response(audio.body).arrayBuffer();
    // 1.5 s of audio covers at least 15 characters: back to the clause appended at 8
    server().audio(72_000);
    server().text({ type: "error", ids: ["c1"] });
    socket.append(" Autre");
    socket.append(" chose?");
    socket.append(" Oui");
    await tick();
    socket.finish();
    const bytes = new Uint8Array(await read);
    expect(new TextDecoder().decode(bytes.subarray(72_000))).toBe("post:il fait beau.post:Autre chose?post:Oui");
    expect(post.mock.calls.map((call) => call[1])).toEqual(["il fait beau.", "Autre chose?", "Oui"]);
    // the socket never heard of the appends after the error
    expect(server().sent.filter((m) => m.type === "append")).toHaveLength(1);
    expect(server().sent.some((m) => m.type === "finish")).toBe(false);
  });

  it("a new answer's begin finishes the last one's utterance", async () => {
    const { socket, server } = make();
    void socket.connect();
    server().ready();
    void socket.begin("b-1", "Un,", voice, "t-1");
    void socket.begin("b-1", "Deux,", voice, "t-1");
    await tick();
    expect(server().sent.map((m) => `${m.type}:${m.id}`)).toEqual(["say:c1", "finish:c1", "say:c2"]);
  });

  it("an answer begun on POST (the socket not open) still grows and ends", async () => {
    const { socket, post } = make();
    const answer = socket.begin("b-1", "Bonjour,", voice, "t-1");
    socket.append(" ça va?");
    socket.finish();
    const audio = (await answer)!;
    expect(new TextDecoder().decode(new Uint8Array(await new Response(audio.body).arrayBuffer()))).toBe("post:Bonjour, ça va?");
    expect(post).toHaveBeenCalledTimes(1);
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
    await tick();
    expect(post.mock.calls.map((c) => c[1]).sort()).toEqual(["Deux.", "Trois.", "Un."]);
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

  it("retune while idle reopens on the new voice before the next clause", async () => {
    const { socket, servers } = make();
    void socket.connect();
    servers[0]!.ready();
    const faster = { ...voice, speed: 1.25 };
    socket.retune(faster);
    expect(servers).toHaveLength(2);
    expect(servers[0]!.closed).toBe(true);
    expect(servers[1]!.url).toContain("speed=1.25");
    servers[1]!.ready();
    const next = socket.speak("b-1", "Vite.", faster, "t-1");
    await tick();
    expect(servers[1]!.says().map((m) => m.text)).toEqual(["Vite."]);
    servers[1]!.text({ type: "skip", id: servers[1]!.says()[0]!.id });
    expect(await next).toBeNull();
  });

  it("retune while a clause is open leaves that socket alone", async () => {
    const { socket, servers } = make();
    void socket.connect();
    servers[0]!.ready();
    const busy = socket.speak("b-1", "En cours.", voice, "t-1");
    await tick();
    socket.retune({ ...voice, speed: 1.25 });
    expect(servers).toHaveLength(1);
    expect(servers[0]!.closed).toBe(false);
    servers[0]!.text({ type: "skip", id: servers[0]!.says()[0]!.id });
    expect(await busy).toBeNull();
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

  it("a one word punctuated opener is a clause", () => {
    const well = new SentenceStream(STREAMING_CLAUSES);
    expect(well.feed("Well, ")).toEqual(["Well,"]);
    expect(well.feed("Well, it is sunny, ")).toEqual([]);
    expect(new SentenceStream(STREAMING_CLAUSES).feed("Sure, ")).toEqual(["Sure,"]);
  });

  it("an unpunctuated one word is not a clause", () => {
    const stream = new SentenceStream(STREAMING_CLAUSES);
    expect(stream.feed("Well ")).toEqual([]);
    expect(stream.feed("Well it is sunny")).toEqual(["Well it"]);
  });

  it("sentences still end at their punctuation; a short one is never held back", () => {
    const stream = new SentenceStream(STREAMING_CLAUSES);
    expect(stream.feed("Sure. It is sunny. ")).toEqual(["Sure.", "It is sunny."]);
    expect(stream.finish("Sure. It is sunny. Yes.")).toEqual(["Yes."]);
    // over POST, later short sentences still join
    const post = new SentenceStream();
    expect(post.feed("Sure, it is a long first clause. It is sunny. ")).toEqual(["Sure, it is a long first clause."]);
  });

  it("the first clause goes at a space after two words, even without a comma", () => {
    const stream = new SentenceStream(STREAMING_CLAUSES);
    expect(stream.feed("It is sunny today in Montreal")).toEqual(["It is"]);
    expect(stream.feed("It is sunny today in Montreal this afternoon")).toEqual([]);
    // the POST path still waits for punctuation or the six-word comma cut
    expect(new SentenceStream().feed("It is sunny today in Montreal")).toEqual([]);
  });

  it("counts words by whitespace: an apostrophe does not split a word", () => {
    expect(new SentenceStream(STREAMING_CLAUSES).feed("C'est fait. ")).toEqual(["C'est fait."]);
    expect(new SentenceStream(STREAMING_CLAUSES).feed("C'est ")).toEqual([]);
    expect(new SentenceStream(STREAMING_CLAUSES).feed("Aujourd'hui, ")).toEqual(["Aujourd'hui,"]);
    // a lone dash or emoji is not a word
    expect(new SentenceStream(STREAMING_CLAUSES).feed("Oui \u2014 bien")).toEqual([]);
  });
});

describe("unheardRest (a rescue over POST)", () => {
  it("assumes a slow voice and backs up to the start of the clause reached: words repeat, none is skipped", () => {
    const text = "Le billet est fermé. Je regarde la facture maintenant et je reviens.";
    // 2 s at 10 characters a second: 20 characters, inside the first sentence
    expect(unheardRest(text, 2)).toBe(text);
    // 3 s: past the first sentence's end, back to the second's start
    expect(unheardRest(text, 3)).toBe("Je regarde la facture maintenant et je reviens.");
    // an appended clause's start counts too
    expect(unheardRest("Bonjour, il fait beau aujourd'hui", 1.5, 1, [0, 8])).toBe("il fait beau aujourd'hui");
    expect(unheardRest(text, 0)).toBe(text);
    expect(unheardRest(text, 60)).toBe("");
  });
});
