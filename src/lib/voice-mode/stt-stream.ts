// The live call's ears on the server: one WebSocket per call
// (GET /voice/listen) to xAI's streaming speech to text. The person's audio
// is sent while they speak (the turn detector decides when, so silence and
// room noise are never sent or billed), partial words come back as they are
// recognized, and `finish` asks xAI to finalize the utterance the moment the
// turn ends: the words are ready a few hundred milliseconds after the person
// stops, not after an upload. When the socket cannot open (an old server, a
// proxy without WebSockets), each turn is uploaded whole instead
// (POST /voice/transcribe), the call keeps working.
import { encodeWav, TARGET_RATE, toPcm16 } from "./audio";
import { transcribeVoiceMode, voiceModeListenUrl } from "./api";
import { normalizedWords } from "./latency";

/** Confident silence before one `finalize` probe. Four 32 ms frames. */
export const PROBE_AFTER_MS = 128;
/** Page keepalive so a proxy does not drop the listen socket between turns. */
const KEEPALIVE_MS = 15_000;

export interface LiveTranscriberOptions {
  botId: string;
  language: () => string;
  threadId: () => string | undefined;
  /** injected in tests */
  socket?: (url: string) => WebSocket;
  transcribe?: typeof transcribeVoiceMode;
  /** how long to wait for xAI's final words after finalize */
  finalTimeoutMs?: number;
}

interface Utterance {
  frames: Float32Array[];
  /** frames already sent on the socket */
  sent: number;
  text: string;
  discard: boolean;
  finalized: boolean;
  /** xAI said the speaker stopped (speech_final) and no audio was sent since */
  ended: boolean;
  /** the lowest confidence xAI gave a final chunk of it, when it gives one */
  confidence?: number;
  /** the last final chunk kept (a resend of it is not new words) */
  lastChunk?: string;
  /** the latest interim, used when finalize never answers */
  interim?: string;
  /** frames already sent when the last finalize went out */
  closedAt?: number;
  /** a finalize is in flight for `closedAt` */
  probing?: boolean;
  /** that finalize may have punctuated a sentence the person has not finished */
  forced?: boolean;
  resolve?: (words: Heard) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** The words of one utterance, with xAI's confidence when it reports one. */
export interface Heard {
  text: string;
  confidence?: number;
}

type Frame = { type: "ready" } | { type: "transcript"; text: string; final: boolean; speechFinal: boolean; confidence?: number } | { type: "error"; message: string };

/** After a finalize xAI can send again a final chunk it had already closed
 * (then the rest). Appended, that resend doubled the sentence ("Yeah, but I
 * always thought it. Yeah, but I always thought it."), and the turn sent
 * early on its stable words was then sent again as the doubled text. A
 * final chunk of three words or more that repeats the last chunk kept, or the
 * whole utterance so far, is that resend; a short one ("no, no") is the
 * person's own words. */
export function resentChunk(utterance: { text: string; lastChunk?: string }, chunk: string): boolean {
  const words = normalizedWords(chunk).join(" ");
  if (words.split(" ").length < 3 || !utterance.text.trim()) return false;
  return words === normalizedWords(utterance.lastChunk ?? "").join(" ") || words === normalizedWords(utterance.text).join(" ");
}

export class LiveTranscriber {
  private socket: WebSocket | null = null;
  private open = false;
  private utterances: Utterance[] = [];
  private current: Utterance | null = null;
  private partialWatchers = new Set<(text: string) => void>();
  private readonly options: LiveTranscriberOptions;
  /** the socket failed: whole-turn uploads */
  streaming = false;
  /** the language the socket was opened with */
  private language = "";
  /** utterances settled by the timeout before xAI's final words came: the
   * frames that still arrive for them are theirs, never the next turn's */
  private draining = 0;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private reconnects = 0;
  private closing = false;
  /** the partial just notified came from a probe finalize */
  forcedFlush = false;

  constructor(options: LiveTranscriberOptions) {
    this.options = options;
  }

  onPartial(cb: (text: string) => void): () => void {
    this.partialWatchers.add(cb);
    return () => this.partialWatchers.delete(cb);
  }

  /** Open the socket; false means turns will be uploaded whole. */
  connect(timeoutMs = 6000): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.streaming = ok;
        resolve(ok);
      };
      let socket: WebSocket;
      try {
        this.language = this.options.language();
        const url = voiceModeListenUrl(this.options.botId, this.language, this.options.threadId());
        socket = this.options.socket?.(url) ?? new WebSocket(url);
      } catch {
        done(false);
        return;
      }
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      const timer = setTimeout(() => done(false), timeoutMs);
      socket.addEventListener("message", (event: MessageEvent) => {
        if (typeof event.data !== "string" || socket !== this.socket) return;
        let frame: Frame;
        try { frame = JSON.parse(event.data) as Frame; } catch { return; }
        if (frame.type === "ready") {
          clearTimeout(timer);
          this.open = true;
          this.armKeepalive();
          done(true);
          // a turn that began while the socket was (re)opening
          if (this.current) this.flush(this.current);
        } else if (frame.type === "transcript") this.heard(frame);
      });
      const lost = () => {
        if (socket !== this.socket) return;
        clearTimeout(timer);
        const wasOpen = this.open;
        this.open = false;
        this.stopKeepalive();
        done(false);
        // one reconnect after a drop mid-call; the first failure still uploads
        if (wasOpen && !this.closing && this.reconnects < 1 && this.current && !this.current.finalized) {
          this.reconnects += 1;
          this.streaming = false;
          void this.connect().then((ok) => {
            if (ok && this.current) this.flush(this.current);
          });
          return;
        }
        this.streaming = false;
        // anything waiting on the socket is uploaded instead
        for (const utterance of this.utterances) if (utterance.finalized && !utterance.discard) void this.upload(utterance);
      };
      socket.addEventListener("close", lost);
      socket.addEventListener("error", lost);
    });
  }

  /** A turn may be starting: send what was heard just before it too. */
  begin(preroll: Float32Array[]): void {
    if (this.current) return;
    // the person changed the language in the panel: a socket for it, between turns
    if (this.streaming && this.language !== this.options.language() && !this.utterances.length) this.reopen();
    const utterance: Utterance = { frames: [], sent: 0, text: "", discard: false, finalized: false, ended: false };
    this.current = utterance;
    this.utterances.push(utterance);
    for (const frame of preroll) this.push(frame);
  }

  /** One frame of 16 kHz audio of the current utterance. */
  push(frame: Float32Array): void {
    const utterance = this.current;
    if (!utterance) return;
    utterance.frames.push(frame);
    this.flush(utterance);
  }

  private flush(utterance: Utterance): void {
    if (!this.open || this.socket?.readyState !== 1) return;
    while (utterance.sent < utterance.frames.length) {
      const pcm = toPcm16([utterance.frames[utterance.sent]!], TARGET_RATE, TARGET_RATE);
      this.socket.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
      utterance.sent += 1;
      utterance.ended = false;
    }
  }

  /** Silence after the person stopped: one finalize so the last words come
   * back during the endpoint, not after it. A second finalize with no new
   * audio is not sent (that stuck the listen socket). */
  probe(): boolean {
    const utterance = this.current;
    if (!utterance || utterance.discard || utterance.finalized || utterance.probing) return false;
    if (!this.open || this.socket?.readyState !== 1) return false;
    if (utterance.sent === 0 || utterance.closedAt === utterance.sent) return false;
    utterance.probing = true;
    utterance.closedAt = utterance.sent;
    this.socket.send(JSON.stringify({ type: "finalize" }));
    return true;
  }

  /** Stop sending silence: a probe is in flight, or it already closed this audio. */
  get holdingSilence(): boolean {
    const utterance = this.current;
    if (!utterance) return false;
    return Boolean(utterance.probing || (utterance.ended && utterance.closedAt === utterance.sent));
  }

  private armKeepalive(): void {
    if (this.keepalive) return;
    this.keepalive = setInterval(() => {
      if (this.open && this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: "keepalive" }));
    }, KEEPALIVE_MS);
    this.keepalive.unref?.();
  }

  private stopKeepalive(): void {
    if (!this.keepalive) return;
    clearInterval(this.keepalive);
    this.keepalive = null;
  }

  /** A new socket (another language); the old one is let go quietly. */
  private reopen(): void {
    const old = this.socket;
    this.socket = null;
    this.open = false;
    try { old?.close(); } catch { /* closed */ }
    void this.connect();
  }

  /** The audio of the current utterance (speaker verification). */
  audio(): Float32Array {
    const frames = this.current?.frames ?? [];
    const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let at = 0;
    for (const frame of frames) {
      out.set(frame, at);
      at += frame.length;
    }
    return out;
  }

  /** The turn ended: its words. */
  finish(): Promise<string> {
    return this.finishHeard().then((heard) => heard.text);
  }

  /** The turn ended: its words and xAI's confidence in them. */
  finishHeard(): Promise<Heard> {
    const utterance = this.current;
    this.current = null;
    if (!utterance) return Promise.resolve({ text: "" });
    utterance.finalized = true;
    return new Promise((resolve) => {
      utterance.resolve = resolve;
      if (!this.open) {
        void this.upload(utterance);
        return;
      }
      // xAI already closed it (speech_final or a probe) and nothing was sent since:
      // a finalize would have nothing new to say
      if ((utterance.ended || utterance.probing) && utterance.closedAt === utterance.sent && (utterance.text.trim() || utterance.probing)) {
        if (utterance.ended && utterance.text.trim()) {
          this.settle(utterance);
          return;
        }
        this.armFinalTimer(utterance);
        return;
      }
      if (utterance.ended && utterance.text.trim() && utterance.closedAt === undefined) {
        this.settle(utterance);
        return;
      }
      utterance.closedAt = utterance.sent;
      utterance.probing = true;
      this.socket!.send(JSON.stringify({ type: "finalize" }));
      this.armFinalTimer(utterance);
    });
  }

  private armFinalTimer(utterance: Utterance): void {
    utterance.timer = setTimeout(() => {
      const fallback = utterance.text.trim() || utterance.interim?.trim() || "";
      if (fallback) {
        if (!utterance.text.trim()) utterance.text = fallback;
        // its last words may still come: they belong to it, not the next turn
        this.draining += 1;
        this.settle(utterance);
      } else void this.upload(utterance);
    }, this.options.finalTimeoutMs ?? 2500);
  }

  /** The candidate was a noise, or the turn is dropped: forget its words. */
  discard(): void {
    const utterance = this.current;
    this.current = null;
    if (!utterance) return;
    utterance.discard = true;
    utterance.finalized = true;
    if (this.open && this.socket?.readyState === 1 && !utterance.probing) {
      utterance.closedAt = utterance.sent;
      utterance.probing = true;
      this.socket.send(JSON.stringify({ type: "finalize" }));
    }
    utterance.timer = setTimeout(() => {
      if (this.utterances.includes(utterance)) this.draining += 1;
      this.settle(utterance);
    }, this.options.finalTimeoutMs ?? 2500);
  }

  close(): void {
    this.closing = true;
    this.open = false;
    this.stopKeepalive();
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch { /* closed */ }
    for (const utterance of this.utterances) {
      if (utterance.timer) clearTimeout(utterance.timer);
      utterance.resolve?.({ text: "" });
    }
    this.draining = 0;
    this.utterances = [];
    this.current = null;
  }

  private heard(frame: Extract<Frame, { type: "transcript" }>): void {
    // the late words of an utterance the timeout already settled: theirs
    if (this.draining > 0) {
      if (frame.final && frame.speechFinal) this.draining -= 1;
      return;
    }
    // events belong to the oldest utterance still waiting for its words
    const utterance = this.utterances[0];
    if (!utterance) return;
    if (!frame.final) {
      utterance.interim = frame.text;
      utterance.forced = false;
      this.forcedFlush = false;
      if (!utterance.discard) for (const fn of Array.from(this.partialWatchers)) fn(`${utterance.text} ${frame.text}`.trim());
      return;
    }
    if (frame.text.trim() && !resentChunk(utterance, frame.text)) {
      utterance.lastChunk = frame.text.trim();
      utterance.text = `${utterance.text} ${frame.text.trim()}`.trim();
      if (typeof frame.confidence === "number") utterance.confidence = Math.min(utterance.confidence ?? 1, frame.confidence);
    }
    const forced = utterance.probing === true;
    if (forced) utterance.forced = true;
    this.forcedFlush = forced && !utterance.discard;
    if (!utterance.discard) for (const fn of Array.from(this.partialWatchers)) fn(utterance.text);
    // A final chunk is one xAI will not revise, not the end of the
    // utterance: after a finalize, xAI can still send the chunk it had
    // already closed, then the rest. Only speech_final (the answer to the
    // finalize, or its own endpointing) closes it. Closing on the first
    // final chunk cut sentences short ("give me a good prompt to") and
    // handed their last words to the next turn.
    if (!frame.speechFinal) return;
    const covered = utterance.closedAt === undefined || utterance.sent === utterance.closedAt;
    utterance.probing = false;
    if (!covered) return;
    if (utterance.finalized) this.settle(utterance);
    else utterance.ended = true;
  }

  private settle(utterance: Utterance): void {
    if (utterance.timer) clearTimeout(utterance.timer);
    const index = this.utterances.indexOf(utterance);
    if (index < 0) return;
    this.utterances.splice(index, 1);
    utterance.resolve?.(utterance.discard ? { text: "" } : { text: utterance.text.trim(), ...(utterance.confidence !== undefined ? { confidence: utterance.confidence } : {}) });
    utterance.resolve = undefined;
  }

  private async upload(utterance: Utterance): Promise<void> {
    if (utterance.timer) clearTimeout(utterance.timer);
    const wav = encodeWav(toPcm16(utterance.frames, TARGET_RATE, TARGET_RATE), TARGET_RATE);
    try {
      const transcribe = this.options.transcribe ?? transcribeVoiceMode;
      const text = await transcribe(this.options.botId, new Blob([new Uint8Array(wav)], { type: "audio/wav" }), this.options.language(), this.options.threadId());
      utterance.text = text;
    } catch (error) {
      utterance.text = "";
      this.uploadError = error;
    }
    this.settle(utterance);
  }

  /** The last upload's error (a refusal shows the access card). */
  uploadError: unknown = null;
}
