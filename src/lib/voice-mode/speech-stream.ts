// The live call's voice on one socket ("Streaming voice", on by default):
// GET /voice/speech opens, for the whole call, a server socket to xAI's
// streaming text to speech. An answer is one xAI utterance: its first words
// open it (`begin`: `say` with `more: true`), every later clause grows it
// (`append`), and it ends when the answer does (`finish`), so the voice
// keeps one intonation and no gap between clauses (tts-lead.ts decides
// what goes). Its PCM comes back as binary frames between `start` and
// `done`, handed to the player exactly like a POST /voice/stream body. A
// whole text can still be one utterance on its own (`speak`). An utterance
// the player drops (barge-in, hold, hang-up, a reissued turn) is cancelled
// on the server, which clears it at xAI (`text.clear`), so nothing of it
// plays after.
//
// Safety nets: the socket must say `ready` within SPEECH_OPEN_MS, else the
// call speaks over POST /voice/stream; a socket that errors
// SPEECH_MAX_ERRORS times in one call, closes, or that the server gives up
// on (`fallback`, after its own reconnect attempts) does the same for the
// rest of the call, logged once. An utterance the socket failed goes on
// over POST into the same body: what its audio received did not cover yet
// (estimated by speaking rate, cut at a word before that point, so a word
// may be said twice but none is skipped), then what the answer appends,
// a sentence at a time. Changing the voice, speed or language opens a new
// socket between answers (an utterance begun while one is in flight goes
// over POST).
import { streamVoiceModeSpeech, voiceModeSpeechUrl } from "./api";
import type { VoiceModeSettings } from "../../../shared/voice-mode";

/** The socket must be ready this soon, else POST for the call. */
export const SPEECH_OPEN_MS = 1_500;
/** Errors in one call after which POST speaks for the rest of it. */
export const SPEECH_MAX_ERRORS = 2;
/** A ping this often while the socket is open; a server that answered
 * pings before and then says nothing for a whole period is gone (a
 * half-dead socket after a network switch or sleep never closes). */
export const SPEECH_PING_MS = 10_000;

type Audio = { body: ReadableStream<Uint8Array>; sampleRate: number } | null;
type Speak = typeof streamVoiceModeSpeech;

type Frame =
  | { type: "ready"; sampleRate?: number }
  | { type: "start"; id: string }
  | { type: "done"; id: string }
  | { type: "skip"; id: string }
  | { type: "error"; ids: string[] }
  | { type: "fallback" }
  | { type: "pong" };

export interface SpeechSocketOptions {
  botId: string;
  threadId: () => string | undefined;
  voice: () => VoiceModeSettings;
  /** injected in tests */
  socket?: (url: string) => WebSocket;
  post?: Speak;
  /** once, when the call falls back to POST (default: console.info) */
  log?: (line: string) => void;
  openMs?: number;
  /** override SPEECH_PING_MS (tests) */
  pingMs?: number;
}

interface Clause {
  id: string;
  text: string;
  settings: VoiceModeSettings;
  threadId?: string;
  signal?: AbortSignal;
  body: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  resolve: (audio: Audio) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  started: boolean;
  heard: boolean;
  ended: boolean;
  cancelled: boolean;
  /** open: the answer may still append to it */
  more: boolean;
  /** PCM bytes the socket delivered for it */
  bytes: number;
  /** where each appended clause starts in `text` (a rescue backs up to one) */
  marks: number[];
  /** spoken over POST from here on (the socket failed it) */
  post?: { buffer: string; chain: Promise<void> };
  /** the server ended it while the answer may still grow: the next words
   * open it again there (a new `say` under the same id, same body) */
  reopen?: boolean;
}

/** A sentence ends here: what is buffered for POST goes. */
const SENTENCE_END = /[.!?…]["'»)\]]*\s*$/;

const settingsKey = (settings: VoiceModeSettings) => `${settings.voice}|${settings.speed}|${settings.language}`;

export class SpeechSocket {
  private readonly o: SpeechSocketOptions;
  private socket: WebSocket | null = null;
  private state: "idle" | "opening" | "open" | "failed" = "idle";
  private errors = 0;
  private logged = false;
  private sampleRate = 24_000;
  private key = "";
  private next = 0;
  private clauses = new Map<string, Clause>();
  private current: Clause | null = null;
  /** the answer's open utterance (`begin`, until `finish`) */
  private openClause: Clause | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private opened: Promise<boolean> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  /** the server answers pings (an older one never does: no check then) */
  private pongs = false;
  /** something came from the server since the last ping */
  private heardSince = true;

  constructor(options: SpeechSocketOptions) {
    this.o = options;
  }

  /** The call speaks over this socket (not fallen back to POST). */
  get streaming(): boolean {
    return this.state !== "failed";
  }

  /** Open the socket (at the call's start, so the first clause finds it open). */
  connect(settings: VoiceModeSettings = this.o.voice()): Promise<boolean> {
    if (this.state === "failed") return Promise.resolve(false);
    if (this.opened && (this.state === "opening" || this.state === "open")) return this.opened;
    this.state = "opening";
    this.key = settingsKey(settings);
    this.opened = new Promise<boolean>((resolve) => {
      let socket: WebSocket;
      try {
        const url = voiceModeSpeechUrl(this.o.botId, settings, this.o.threadId());
        socket = this.o.socket?.(url) ?? new WebSocket(url);
      } catch {
        this.fail("the streaming voice could not open");
        resolve(false);
        return;
      }
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (socket === this.socket && this.state === "opening") this.fail(`the streaming voice did not open within ${this.o.openMs ?? SPEECH_OPEN_MS} ms`);
        resolve(this.state === "open");
      }, this.o.openMs ?? SPEECH_OPEN_MS);
      socket.addEventListener("message", (event: MessageEvent) => {
        if (socket !== this.socket) return;
        this.heardSince = true;
        if (typeof event.data !== "string") return this.audio(event.data as ArrayBuffer);
        let frame: Frame;
        try { frame = JSON.parse(event.data) as Frame; } catch { return; }
        if (frame.type === "pong") {
          this.pongs = true;
          return;
        }
        if (frame.type === "ready") {
          if (this.timer) clearTimeout(this.timer);
          this.timer = null;
          if (typeof frame.sampleRate === "number" && frame.sampleRate > 0) this.sampleRate = frame.sampleRate;
          this.state = "open";
          resolve(true);
          this.startPing(socket);
          // clauses said while it was opening
          for (const clause of this.clauses.values()) if (!clause.cancelled && !clause.started && !clause.post) {
            this.send(clause.more ? { type: "say", id: clause.id, text: clause.text, more: true } : { type: "say", id: clause.id, text: clause.text });
          }
          return;
        }
        this.frame(frame);
      });
      const lost = () => {
        if (socket !== this.socket) return;
        resolve(false);
        this.fail("the streaming voice closed");
      };
      socket.addEventListener("close", lost);
      socket.addEventListener("error", lost);
    });
    return this.opened;
  }

  /** One clause's speech; the same contract as POST /voice/stream
   * (streamVoiceModeSpeech), so the player plays either alike. */
  speak: Speak = (botId, text, settings, threadId, signal) => this.enqueue(botId, text, settings, threadId, signal, false);

  /** Open the answer's utterance with its first words: `text.delta` only,
   * audio starts at once. `append` grows it, `finish` ends it. */
  begin: Speak = (botId, text, settings, threadId, signal) => this.enqueue(botId, text, settings, threadId, signal, true);

  private enqueue(botId: string, text: string, settings: VoiceModeSettings, threadId: string | undefined, signal: AbortSignal | undefined, more: boolean): Promise<Audio> {
    const post = this.o.post ?? streamVoiceModeSpeech;
    let viaPost = this.state === "failed" || this.state === "idle";
    if (!viaPost && settingsKey(settings) !== this.key) {
      if ([...this.clauses.values()].some((clause) => !clause.ended)) viaPost = true;
      else {
        this.reopen(settings);
        viaPost = !this.streaming;
      }
    }
    // a whole text over POST is one request; an open one goes on over POST
    // a whole text while an answer's utterance is open: over POST, so it is
    // never queued behind that utterance on the server (the player still
    // plays it after the answer)
    if (!more && this.openClause && !this.openClause.ended && !this.openClause.cancelled) viaPost = true;
    if (viaPost && !more) return post(botId, text, settings, threadId, signal);
    if (signal?.aborted) return Promise.resolve(null);
    this.next += 1;
    const id = `c${this.next}`;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => { controller = c; },
      cancel: () => this.cancel(id),
    });
    return new Promise<Audio>((resolve, reject) => {
      const clause: Clause = {
        id, text, settings, ...(threadId ? { threadId } : {}), ...(signal ? { signal } : {}), body, controller,
        resolve, reject, settled: false, started: false, heard: false, ended: false, cancelled: false, more, bytes: 0, marks: [0],
      };
      clause.controller = controller;
      this.clauses.set(id, clause);
      if (more) {
        // a new answer: the last one's utterance is done growing
        if (this.openClause && this.openClause !== clause) this.finish();
        this.openClause = clause;
      }
      signal?.addEventListener("abort", () => this.cancel(id), { once: true });
      if (viaPost) {
        clause.text = "";
        this.toPost(clause, text);
      } else if (this.state === "open") {
        this.send(more ? { type: "say", id, text, more: true } : { type: "say", id, text });
      }
    });
  }

  /** More words of the open utterance (xAI `text.delta`). */
  append(text: string): void {
    const clause = this.openClause;
    if (!clause || !text || clause.cancelled || clause.ended) return;
    if (clause.post) return this.toPost(clause, text);
    if (/^\s/.test(text)) clause.marks.push(clause.text.length);
    clause.text += text;
    if (clause.reopen) {
      clause.reopen = false;
      this.send({ type: "say", id: clause.id, text: text.trimStart(), more: true });
      return;
    }
    this.send({ type: "append", id: clause.id, text });
  }

  /** The answer is complete: its utterance ends (xAI `text.done`). */
  finish(): void {
    const clause = this.openClause;
    this.openClause = null;
    if (!clause || clause.cancelled || clause.ended) return;
    clause.more = false;
    if (clause.post) return this.endPost(clause);
    // ended on the server and nothing came since: it is over here too
    if (clause.reopen) return this.end(clause, null);
    this.send({ type: "finish", id: clause.id });
  }

  /** Voice, speed or language changed. Reopen now when nothing is in
   * flight, so the next clause finds the socket already on the new voice
   * instead of paying the reconnect before its first audio. */
  retune(settings: VoiceModeSettings): void {
    if (this.state !== "open" && this.state !== "opening") return;
    if (settingsKey(settings) === this.key) return;
    if ([...this.clauses.values()].some((clause) => !clause.ended)) return;
    this.reopen(settings);
  }

  /** The call ended. */
  close(): void {
    this.stopPing();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    this.state = "failed";
    this.logged = true;
    for (const clause of this.clauses.values()) this.end(clause, null);
    this.clauses.clear();
    try { socket?.close(); } catch { /* closed */ }
  }

  private send(message: Record<string, unknown>): void {
    try {
      if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
    } catch { /* closing */ }
  }

  private reopen(settings: VoiceModeSettings): void {
    this.stopPing();
    this.pongs = false;
    const old = this.socket;
    this.socket = null;
    this.opened = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clauses.clear();
    this.current = null;
    this.openClause = null;
    this.state = "idle";
    try { old?.close(); } catch { /* closed */ }
    void this.connect(settings);
  }

  private frame(frame: Frame): void {
    if (frame.type === "fallback") return this.fail("the server gave up on xAI's streaming voice");
    if (frame.type === "error") {
      this.errors += 1;
      for (const id of frame.ids) {
        const clause = this.clauses.get(id);
        if (clause) this.rescue(clause);
      }
      if (this.errors >= SPEECH_MAX_ERRORS) this.fail(`the streaming voice failed ${this.errors} times`);
      return;
    }
    if (frame.type === "ready" || frame.type === "pong") return;
    const clause = this.clauses.get(frame.id);
    if (!clause || clause.post) return;
    if (frame.type === "start") {
      clause.started = true;
      this.current = clause;
      if (!clause.settled) {
        clause.settled = true;
        clause.resolve({ body: clause.body, sampleRate: this.sampleRate });
      }
    } else if (frame.type === "skip") {
      this.end(clause, null);
    } else if (frame.type === "done") {
      if (this.current === clause) this.current = null;
      // the server ended an utterance the answer has not finished (its 20 s
      // idle end with something queued behind it): keep it, and let the
      // next words open it there again
      if (clause.more && clause === this.openClause && !clause.cancelled) {
        clause.reopen = true;
        return;
      }
      this.end(clause, null);
    }
  }

  private audio(data: ArrayBuffer): void {
    const clause = this.current;
    if (!clause || clause.cancelled || clause.ended || clause.post || !data.byteLength) return;
    clause.heard = true;
    clause.bytes += data.byteLength;
    try { clause.controller?.enqueue(new Uint8Array(data)); } catch { /* the player let go */ }
  }

  /** Done with a clause: its stream ends, and a clause never started
   * resolves `audio` (nothing to say, or the POST's answer). */
  private end(clause: Clause, audio: Audio): void {
    if (!clause.ended) {
      clause.ended = true;
      try { clause.controller?.close(); } catch { /* already closed */ }
    }
    if (!clause.settled) {
      clause.settled = true;
      clause.resolve(audio);
    }
    this.clauses.delete(clause.id);
    if (this.current === clause) this.current = null;
    if (this.openClause === clause) this.openClause = null;
  }

  private cancel(id: string): void {
    const clause = this.clauses.get(id);
    if (!clause || clause.cancelled) return;
    clause.cancelled = true;
    this.send({ type: "cancel", id });
    this.end(clause, null);
  }

  /** The socket failed this utterance: it goes on over POST, from what
   * its audio did not cover yet. */
  private rescue(clause: Clause): void {
    if (clause.cancelled || clause.ended || clause.post) return;
    const rest = clause.heard ? unheardRest(clause.text, clause.bytes / 2 / this.sampleRate, clause.settings.speed, clause.marks) : clause.text;
    if (this.current === clause) this.current = null;
    clause.text = "";
    this.toPost(clause, rest);
    if (!clause.more) this.endPost(clause);
  }

  /** Words of an utterance spoken over POST: a sentence at a time, into
   * its body, one request after the other. */
  private toPost(clause: Clause, text: string): void {
    clause.post ??= { buffer: "", chain: Promise.resolve() };
    clause.post.buffer += text;
    clause.text += text;
    if (SENTENCE_END.test(clause.post.buffer)) this.flushPost(clause);
  }

  private flushPost(clause: Clause): void {
    const post = clause.post!;
    const text = post.buffer.trim();
    post.buffer = "";
    if (!text) return;
    const speak = this.o.post ?? streamVoiceModeSpeech;
    post.chain = post.chain.then(async () => {
      if (clause.cancelled) return;
      let audio: Audio;
      try {
        audio = await speak(this.o.botId, text, clause.settings, clause.threadId, clause.signal);
      } catch (error) {
        if (!clause.settled) {
          clause.settled = true;
          clause.reject(error);
        }
        return;
      }
      if (!clause.settled) {
        clause.settled = true;
        clause.resolve({ body: clause.body, sampleRate: audio?.sampleRate ?? this.sampleRate });
      }
      if (!audio) return;
      const reader = audio.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (clause.cancelled) {
          void reader.cancel().catch(() => {});
          break;
        }
        clause.controller?.enqueue(value);
      }
    }).catch(() => {});
  }

  /** The utterance over POST is complete: its body ends after the last
   * request (nothing said at all: it resolves null). */
  private endPost(clause: Clause): void {
    this.flushPost(clause);
    void clause.post!.chain.then(() => this.end(clause, null));
  }

  /** POST for the rest of the call; what is in flight is rescued. */
  /** Ping while open: a server that answered before and then sent
   * nothing for a whole period is gone, even if its socket never closes. */
  private startPing(socket: WebSocket): void {
    this.stopPing();
    this.heardSince = true;
    this.ping = setInterval(() => {
      if (socket !== this.socket || this.state !== "open") return this.stopPing();
      if (this.pongs && !this.heardSince) return this.fail("the streaming voice stopped answering");
      this.heardSince = false;
      this.send({ type: "ping" });
    }, this.o.pingMs ?? SPEECH_PING_MS);
  }

  private stopPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }

  private fail(reason: string): void {
    if (this.state === "failed") return;
    this.stopPing();
    this.state = "failed";
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (!this.logged) {
      this.logged = true;
      (this.o.log ?? ((line: string) => console.info(line)))(`[voice] ${reason}: this call speaks over POST /voice/stream from now on`);
    }
    for (const clause of this.clauses.values()) this.rescue(clause);
    try { socket?.close(); } catch { /* closed */ }
  }
}

/** A slow speaking rate (characters per second): what received audio
 * covers is never overestimated, so a rescue never skips words. */
export const RESCUE_CHARS_PER_SECOND = 10;

/** What of an utterance its received audio (`seconds`) does not cover yet,
 * at a slow speaking rate, from the start of the clause that point falls in
 * (a sentence end, or where an appended clause began, `marks`): words may be
 * said twice, never skipped. */
export function unheardRest(text: string, seconds: number, speed = 1, marks: number[] = [0]): string {
  const covered = Math.floor(seconds * RESCUE_CHARS_PER_SECOND * Math.max(0.5, speed));
  if (covered <= 0) return text.trim();
  if (covered >= text.trim().length) return "";
  let start = 0;
  for (const mark of marks) if (mark <= covered && mark > start) start = mark;
  const sentence = /[.!?…]["'»)\]]*\s+/g;
  for (let match = sentence.exec(text); match && match.index + match[0].length <= covered; match = sentence.exec(text)) {
    start = Math.max(start, match.index + match[0].length);
  }
  return text.slice(start).trim();
}
