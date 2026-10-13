// One live call's streaming voice (GET /api/bots/<id>/voice/speech): the
// page's socket on one side, xAI's streaming text to speech socket
// (server/tts/grok.ts openSpeechStream) on the other. The page sends each
// clause of the bot's answer as it is written; each one is an xAI utterance
// (`text.delta`, `text.done`), spoken one after the other on the same open
// socket, its PCM forwarded to the page as binary frames between `start`
// and `done`. A lead token (`say` with `more: true`) sends `text.delta`
// without `text.done`; `append` grows it; `finish` ends it. A cancelled
// clause (barge-in, hold, hang-up) is dropped from
// the queue, or, when it is the one speaking, cleared at xAI (`text.clear`,
// confirmed by `audio.clear`): nothing of it reaches the page after.
//
// Stability: a dropped xAI socket fails the clauses in flight (the page
// speaks them over POST /voice/stream) and is reopened with a backoff, at
// most SPEECH_RECONNECTS times in a row; after that the page is told to use
// POST for the rest of the call (`fallback`), logged once. A clause with no
// progress for SPEECH_STALL_MS, or a clear not confirmed in SPEECH_CLEAR_MS,
// counts as a dropped socket. Pure of HTTP: the route (voice-mode.ts) wires
// the sockets, the tests drive it with fakes.
import type { SpeechStream, SpeechStreamHandlers } from "./tts/grok.ts";

/** Reconnect attempts in a row before the call falls back to POST. */
export const SPEECH_RECONNECTS = 3;
/** The waits before each reconnect attempt. */
export const SPEECH_BACKOFF_MS = [250, 750, 2_000] as const;
/** A clause without any audio progress this long: the socket is stuck. */
export const SPEECH_STALL_MS = 8_000;
/** A `text.clear` not confirmed this soon: the socket is stuck. */
export const SPEECH_CLEAR_MS = 2_000;
/** A clause id from the page. */
export const SPEECH_ID = /^[\w-]{1,64}$/;
/** xAI closes a streaming socket around 600 s. Rotate while idle before that,
 * so the next clause is not the one that discovers the socket is gone. */
export const SPEECH_SOCKET_AGE_MS = 540_000;

/** What the server says to the page (JSON text frames; audio is binary). */
export type SpeechFrame =
  | { type: "ready"; sampleRate: number }
  | { type: "start"; id: string }
  | { type: "done"; id: string }
  | { type: "skip"; id: string }
  /** these clauses failed (the socket dropped): speak them another way */
  | { type: "error"; ids: string[] }
  /** the socket is gone for this call: POST /voice/stream from now on */
  | { type: "fallback" };

export interface SpeechSessionDeps {
  /** open xAI's socket (voice, speed and language already fixed) */
  open(handlers: SpeechStreamHandlers): SpeechStream;
  /** the clause made speakable (code, links and markdown out) */
  speakable(text: string): string;
  /** characters sent to xAI (the usage ledger) */
  usage(characters: number): void;
  sendText(frame: SpeechFrame): void;
  sendBinary(pcm: Uint8Array): void;
  /** close the page's socket */
  closePage(code: number): void;
  log(line: string): void;
  sampleRate: number;
  backoffMs?: readonly number[];
  stallMs?: number;
  clearMs?: number;
  /** override the idle rotation (tests) */
  maxAgeMs?: number;
}

export interface SpeechSession {
  /** true once xAI's socket first opened, false when it did not */
  ready: Promise<boolean>;
  /** a text frame from the page */
  message(text: string): void;
  /** the page left (or the route gives up): close everything */
  close(): void;
}

interface Clause {
  id: string;
  text: string;
  cancelled?: boolean;
  /** page opened this utterance on a lead token (`more: true`) */
  more?: boolean;
  /** page sent `finish` (text.done). A complete `say` starts finished. */
  finished?: boolean;
}

export function createSpeechSession(deps: SpeechSessionDeps): SpeechSession {
  const backoff = deps.backoffMs ?? SPEECH_BACKOFF_MS;
  const stallMs = deps.stallMs ?? SPEECH_STALL_MS;
  const clearMs = deps.clearMs ?? SPEECH_CLEAR_MS;
  const maxAgeMs = deps.maxAgeMs ?? SPEECH_SOCKET_AGE_MS;
  let upstream: SpeechStream | null = null;
  let open = false;
  let failures = 0;
  let closed = false;
  let gone = false;
  let rotating = false;
  let aged = false;
  let ageTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: Clause[] = [];
  let current: Clause | null = null;
  let clearing = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let resolveReady!: (ok: boolean) => void;
  const ready = new Promise<boolean>((resolve) => { resolveReady = resolve; });

  const send = (frame: SpeechFrame) => {
    if (!closed) deps.sendText(frame);
  };
  const disarm = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };
  const clearAge = () => {
    if (ageTimer) clearTimeout(ageTimer);
    ageTimer = null;
  };
  const scheduleAge = () => {
    clearAge();
    aged = false;
    ageTimer = setTimeout(() => {
      ageTimer = null;
      aged = true;
      rotateIfIdle();
    }, maxAgeMs);
    ageTimer.unref?.();
  };
  /** The socket is old and nothing is in flight: reconnect without counting
   * a failure, so a long call does not fall back to POST. */
  const rotateIfIdle = () => {
    if (!aged || closed || current || clearing || queue.length || !open || !upstream) return;
    aged = false;
    rotating = true;
    upstream.close();
  };
  /** no progress for `ms`: treat the socket as dropped */
  const arm = (ms: number) => {
    disarm();
    watchdog = setTimeout(() => {
      watchdog = null;
      upstream?.close();
    }, ms);
    watchdog.unref?.();
  };

  const pump = () => {
    if (closed || !open || current || clearing || !upstream) return;
    const next = queue.shift();
    if (!next) {
      rotateIfIdle();
      return;
    }
    current = next;
    deps.usage(next.text.length);
    send({ type: "start", id: next.id });
    if (next.more) {
      upstream.delta(next.text);
      if (next.finished) upstream.done();
    } else {
      upstream.speak(next.text);
    }
    arm(stallMs);
  };

  const finish = () => {
    disarm();
    if (current) send({ type: "done", id: current.id });
    current = null;
    clearing = false;
    pump();
  };

  const lost = (socket: SpeechStream) => {
    if (socket !== upstream) return;
    disarm();
    if (rotating) {
      rotating = false;
      upstream = null;
      open = false;
      if (closed) return;
      connect();
      return;
    }
    const wasOpen = open;
    upstream = null;
    open = false;
    clearing = false;
    if (!wasOpen) resolveReady(false);
    const ids = [...(current && !current.cancelled ? [current.id] : []), ...queue.map((clause) => clause.id)];
    current = null;
    queue = [];
    if (closed) return;
    if (ids.length) send({ type: "error", ids });
    failures += 1;
    if (failures > SPEECH_RECONNECTS) {
      gone = true;
      deps.log("[voice-mode] xAI streaming speech dropped; this call speaks over POST /voice/stream from now on");
      send({ type: "fallback" });
      closed = true;
      deps.closePage(1000);
      return;
    }
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, backoff[Math.min(failures - 1, backoff.length - 1)] ?? 1_000);
    retry.unref?.();
  };

  const connect = () => {
    if (closed) return;
    let socket: SpeechStream | null = null;
    const mine = () => socket !== null && socket === upstream;
    socket = deps.open({
      onAudio: (pcm) => {
        if (!mine() || !current || current.cancelled) return;
        deps.sendBinary(pcm);
        arm(stallMs);
      },
      onDone: () => {
        // a cleared clause's own done may come before audio.clear: wait for it
        if (!mine() || clearing) return;
        finish();
      },
      onCleared: () => {
        if (!mine()) return;
        finish();
      },
      onError: () => {
        // xAI may close after an error, or not: either way this socket is done
        if (mine()) socket?.close();
      },
      onClose: () => {
        if (socket) lost(socket);
      },
    });
    upstream = socket;
    socket.ready.then(() => {
      if (!mine() || closed) return;
      open = true;
      failures = 0;
      resolveReady(true);
      scheduleAge();
      pump();
    }, () => {});
  };

  const cancel = (id: string) => {
    const queued = queue.findIndex((clause) => clause.id === id);
    if (queued >= 0) {
      queue.splice(queued, 1);
      send({ type: "done", id });
      return;
    }
    if (!current || current.id !== id || current.cancelled) return;
    current.cancelled = true;
    if (!upstream || !open) return finish();
    clearing = true;
    upstream.clear();
    arm(clearMs);
  };

  connect();

  return {
    ready,
    message(text) {
      if (closed) return;
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return; }
      if (!parsed || typeof parsed !== "object") return;
      const frame = parsed as { type?: unknown; id?: unknown; text?: unknown; more?: unknown };
      const id = frame.id;
      if (typeof id !== "string" || !SPEECH_ID.test(id)) return;
      if (frame.type === "cancel") return cancel(id);
      if (frame.type === "append") {
        if (typeof frame.text !== "string" || !frame.text) return;
        if (current && current.id === id && !current.cancelled) {
          current.text += frame.text;
          deps.usage(frame.text.length);
          if (open) upstream?.delta(frame.text);
          return;
        }
        const queued = queue.find((clause) => clause.id === id);
        if (queued) queued.text += frame.text;
        return;
      }
      if (frame.type === "finish") {
        if (current && current.id === id && !current.cancelled) {
          current.finished = true;
          if (open) upstream?.done();
          return;
        }
        const queued = queue.find((clause) => clause.id === id);
        if (queued) queued.finished = true;
        return;
      }
      if (frame.type !== "say" || typeof frame.text !== "string") return;
      if (gone) return send({ type: "error", ids: [id] });
      const clean = deps.speakable(frame.text);
      if (!clean) return send({ type: "skip", id });
      const more = frame.more === true;
      queue.push({ id, text: clean, more, finished: !more });
      pump();
    },
    close() {
      if (closed) return;
      closed = true;
      disarm();
      clearAge();
      if (retry) clearTimeout(retry);
      retry = null;
      resolveReady(false);
      const socket = upstream;
      upstream = null;
      socket?.close();
    },
  };
}
