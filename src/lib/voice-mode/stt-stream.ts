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
  text: string;
  discard: boolean;
  finalized: boolean;
  resolve?: (text: string) => void;
  timer?: ReturnType<typeof setTimeout>;
}

type Frame = { type: "ready" } | { type: "transcript"; text: string; final: boolean; speechFinal: boolean } | { type: "error"; message: string };

export class LiveTranscriber {
  private socket: WebSocket | null = null;
  private open = false;
  private utterances: Utterance[] = [];
  private current: Utterance | null = null;
  private partialWatchers = new Set<(text: string) => void>();
  private readonly options: LiveTranscriberOptions;
  /** the socket failed: whole-turn uploads */
  streaming = false;

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
        const url = voiceModeListenUrl(this.options.botId, this.options.language(), this.options.threadId());
        socket = this.options.socket?.(url) ?? new WebSocket(url);
      } catch {
        done(false);
        return;
      }
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      const timer = setTimeout(() => done(false), timeoutMs);
      socket.addEventListener("message", (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        let frame: Frame;
        try { frame = JSON.parse(event.data) as Frame; } catch { return; }
        if (frame.type === "ready") {
          clearTimeout(timer);
          this.open = true;
          done(true);
        } else if (frame.type === "transcript") this.heard(frame);
      });
      const lost = () => {
        clearTimeout(timer);
        this.open = false;
        this.streaming = false;
        done(false);
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
    const utterance: Utterance = { frames: [], text: "", discard: false, finalized: false };
    this.current = utterance;
    this.utterances.push(utterance);
    for (const frame of preroll) this.push(frame);
  }

  /** One frame of 16 kHz audio of the current utterance. */
  push(frame: Float32Array): void {
    const utterance = this.current;
    if (!utterance) return;
    utterance.frames.push(frame);
    if (this.open && this.socket?.readyState === 1) {
      const pcm = toPcm16([frame], TARGET_RATE, TARGET_RATE);
      this.socket.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    }
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
    const utterance = this.current;
    this.current = null;
    if (!utterance) return Promise.resolve("");
    utterance.finalized = true;
    return new Promise((resolve) => {
      utterance.resolve = resolve;
      if (!this.open) {
        void this.upload(utterance);
        return;
      }
      this.socket!.send(JSON.stringify({ type: "finalize" }));
      utterance.timer = setTimeout(() => {
        // no final words in time: what we have, else an upload of the turn
        if (utterance.text.trim()) this.settle(utterance);
        else void this.upload(utterance);
      }, this.options.finalTimeoutMs ?? 1500);
    });
  }

  /** The candidate was a noise, or the turn is dropped: forget its words. */
  discard(): void {
    const utterance = this.current;
    this.current = null;
    if (!utterance) return;
    utterance.discard = true;
    utterance.finalized = true;
    if (this.open && this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: "finalize" }));
    utterance.timer = setTimeout(() => this.settle(utterance), this.options.finalTimeoutMs ?? 1500);
  }

  close(): void {
    this.open = false;
    try { this.socket?.close(); } catch { /* closed */ }
    this.socket = null;
    for (const utterance of this.utterances) {
      if (utterance.timer) clearTimeout(utterance.timer);
      utterance.resolve?.("");
    }
    this.utterances = [];
    this.current = null;
  }

  private heard(frame: Extract<Frame, { type: "transcript" }>): void {
    // events belong to the oldest utterance still waiting for its words
    const utterance = this.utterances[0];
    if (!utterance) return;
    if (!frame.final) {
      if (!utterance.discard) for (const fn of Array.from(this.partialWatchers)) fn(`${utterance.text} ${frame.text}`.trim());
      return;
    }
    if (frame.text.trim()) utterance.text = `${utterance.text} ${frame.text.trim()}`.trim();
    if (!utterance.discard) for (const fn of Array.from(this.partialWatchers)) fn(utterance.text);
    // after finalize, the first final event closes the utterance
    if (utterance.finalized) this.settle(utterance);
  }

  private settle(utterance: Utterance): void {
    if (utterance.timer) clearTimeout(utterance.timer);
    const index = this.utterances.indexOf(utterance);
    if (index < 0) return;
    this.utterances.splice(index, 1);
    utterance.resolve?.(utterance.discard ? "" : utterance.text.trim());
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
