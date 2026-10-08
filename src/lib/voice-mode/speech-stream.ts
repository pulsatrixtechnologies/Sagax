// The live call's voice on one socket ("Streaming voice", on by default):
// GET /voice/speech opens, for the whole call, a server socket to xAI's
// streaming text to speech. Each clause of the bot's answer is sent the
// moment it is written (`say`), spoken one after the other, and its PCM
// comes back as binary frames between `start` and `done`, handed to the
// player exactly like a POST /voice/stream body. A clause the player drops
// (barge-in, hold, hang-up, a reissued turn) is cancelled on the server,
// which clears it at xAI (`text.clear`), so nothing of it plays after.
//
// Safety nets: the socket must say `ready` within SPEECH_OPEN_MS, else the
// call speaks over POST /voice/stream; a socket that errors
// SPEECH_MAX_ERRORS times in one call, closes, or that the server gives up
// on (`fallback`, after its own reconnect attempts) does the same for the
// rest of the call, logged once. A clause the socket failed before any of
// its audio arrived is spoken over POST instead; one cut mid-way ends where
// it was cut (never said twice). Changing the voice, speed or language opens
// a new socket between answers (a clause said while one is in flight goes
// over POST).
import { streamVoiceModeSpeech, voiceModeSpeechUrl } from "./api";
import type { VoiceModeSettings } from "../../../shared/voice-mode";

/** The socket must be ready this soon, else POST for the call. */
export const SPEECH_OPEN_MS = 1_500;
/** Errors in one call after which POST speaks for the rest of it. */
export const SPEECH_MAX_ERRORS = 2;

type Audio = { body: ReadableStream<Uint8Array>; sampleRate: number } | null;
type Speak = typeof streamVoiceModeSpeech;

type Frame =
  | { type: "ready"; sampleRate?: number }
  | { type: "start"; id: string }
  | { type: "done"; id: string }
  | { type: "skip"; id: string }
  | { type: "error"; ids: string[] }
  | { type: "fallback" };

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
}

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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private opened: Promise<boolean> | null = null;

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
        if (typeof event.data !== "string") return this.audio(event.data as ArrayBuffer);
        let frame: Frame;
        try { frame = JSON.parse(event.data) as Frame; } catch { return; }
        if (frame.type === "ready") {
          if (this.timer) clearTimeout(this.timer);
          this.timer = null;
          if (typeof frame.sampleRate === "number" && frame.sampleRate > 0) this.sampleRate = frame.sampleRate;
          this.state = "open";
          resolve(true);
          // clauses said while it was opening
          for (const clause of this.clauses.values()) if (!clause.cancelled && !clause.started) this.send({ type: "say", id: clause.id, text: clause.text });
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
  speak: Speak = (botId, text, settings, threadId, signal) => {
    const post = this.o.post ?? streamVoiceModeSpeech;
    if (this.state === "failed" || this.state === "idle") return post(botId, text, settings, threadId, signal);
    if (settingsKey(settings) !== this.key) {
      // another voice, speed or language: a new socket when nothing is in
      // flight (this clause waits for it); else POST until then
      if ([...this.clauses.values()].some((clause) => !clause.ended)) return post(botId, text, settings, threadId, signal);
      this.reopen(settings);
      if (!this.streaming) return post(botId, text, settings, threadId, signal);
    }
    if (signal?.aborted) return Promise.resolve(null);
    this.next += 1;
    const id = `c${this.next}`;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => { controller = c; },
      // the player let go of it (a cut): stop it at xAI
      cancel: () => this.cancel(id),
    });
    return new Promise<Audio>((resolve, reject) => {
      const clause: Clause = {
        id, text, settings, ...(threadId ? { threadId } : {}), ...(signal ? { signal } : {}), body, controller,
        resolve, reject, settled: false, started: false, heard: false, ended: false, cancelled: false,
      };
      clause.controller = controller;
      this.clauses.set(id, clause);
      signal?.addEventListener("abort", () => this.cancel(id), { once: true });
      if (this.state === "open") this.send({ type: "say", id, text });
    });
  };

  /** The call ended. */
  close(): void {
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
    const old = this.socket;
    this.socket = null;
    this.opened = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clauses.clear();
    this.current = null;
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
    if (frame.type === "ready") return;
    const clause = this.clauses.get(frame.id);
    if (!clause) return;
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
      this.end(clause, null);
    }
  }

  private audio(data: ArrayBuffer): void {
    const clause = this.current;
    if (!clause || clause.cancelled || clause.ended || !data.byteLength) return;
    clause.heard = true;
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
  }

  private cancel(id: string): void {
    const clause = this.clauses.get(id);
    if (!clause || clause.cancelled) return;
    clause.cancelled = true;
    this.send({ type: "cancel", id });
    this.end(clause, null);
  }

  /** The socket failed this clause: over POST if none of it was heard. */
  private rescue(clause: Clause): void {
    if (clause.cancelled || clause.ended) return;
    if (clause.heard) return this.end(clause, null);
    const post = this.o.post ?? streamVoiceModeSpeech;
    const request = post(this.o.botId, clause.text, clause.settings, clause.threadId, clause.signal);
    this.clauses.delete(clause.id);
    if (this.current === clause) this.current = null;
    if (!clause.settled) {
      clause.settled = true;
      clause.ended = true;
      request.then(clause.resolve, clause.reject);
      return;
    }
    // already handed to the player: the POST's audio flows into the same body
    clause.ended = true;
    void request.then(async (audio) => {
      if (!audio) return;
      const reader = audio.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || clause.cancelled) break;
        clause.controller?.enqueue(value);
      }
    }).catch(() => {}).finally(() => {
      try { clause.controller?.close(); } catch { /* closed */ }
    });
  }

  /** POST for the rest of the call; what is in flight is rescued. */
  private fail(reason: string): void {
    if (this.state === "failed") return;
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
