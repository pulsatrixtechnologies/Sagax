// Where a call's ears come from.
//
// `nativeSpeechEngine` is the macOS dictation helper (Speech.app, the solo
// Mac app only). `XaiSpeechEngine` is voice mode: the microphone of this
// window (getUserMedia, the same on macOS, Windows and a browser), a small
// endpointer, then one recorded turn sent to the server, which transcribes
// it with xAI (server/voice-mode.ts). Both speak the same events, so the
// call loop in CallView.tsx is the same for either.
import { Endpointer, TARGET_RATE, encodeWav, rms, toPcm16 } from "./audio";
import { VoiceModeRefused, transcribeVoiceMode } from "./api";

export interface TranscriptLine {
  text?: string;
  partial?: boolean;
  error?: string;
}

export interface SpeechEndInfo {
  code: number | null;
  reason?: string;
}

export interface SpeechEngine {
  start(options: { endpointMs?: number }): Promise<void>;
  stop(): Promise<void>;
  onTranscript(cb: (line: TranscriptLine) => void): () => void;
  onEnd(cb: (info: SpeechEndInfo) => void): () => void;
}

/** The macOS dictation helper behind window.ogb. */
export const nativeSpeechEngine: SpeechEngine = {
  start: (options) => window.ogb?.speechStart(options) ?? Promise.reject(new Error("dictation unavailable")),
  stop: () => window.ogb?.speechStop() ?? Promise.resolve(),
  onTranscript: (cb) => window.ogb?.onSpeechTranscript(cb) ?? (() => {}),
  onEnd: (cb) => window.ogb?.onSpeechEnd(cb) ?? (() => {}),
};

export interface XaiSpeechOptions {
  botId: string;
  threadId?: () => string | undefined;
  language: () => string;
  /** The microphone to use; empty: the system default. */
  deviceId?: () => string | undefined;
  /** injected in tests */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createContext?: () => AudioContext;
  transcribe?: typeof transcribeVoiceMode;
}

/** End reasons the bar explains. */
export type XaiEndReason = "mic-denied" | "mic-unavailable" | "transcribe-failed" | "voice_no_access";

const FRAME = 2048;

export class XaiSpeechEngine implements SpeechEngine {
  private readonly options: XaiSpeechOptions;
  private transcriptWatchers = new Set<(line: TranscriptLine) => void>();
  private endWatchers = new Set<(info: SpeechEndInfo) => void>();
  private levelWatchers = new Set<(level: number) => void>();
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private capture: { endpointer: Endpointer; frames: Float32Array[]; preroll: Float32Array[] } | null = null;
  private generation = 0;
  private pending: { endpointMs?: number } | null = null;
  private request: AbortController | null = null;
  private mutedNow = false;
  /** The last refusal, for the bar's access card. */
  refusal: VoiceModeRefused | null = null;

  constructor(options: XaiSpeechOptions) {
    this.options = options;
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  /** The analyser of the live microphone, for the waveform. */
  get levels(): AnalyserNode | null {
    return this.analyser;
  }

  onTranscript(cb: (line: TranscriptLine) => void): () => void {
    this.transcriptWatchers.add(cb);
    return () => this.transcriptWatchers.delete(cb);
  }

  onEnd(cb: (info: SpeechEndInfo) => void): () => void {
    this.endWatchers.add(cb);
    return () => this.endWatchers.delete(cb);
  }

  onLevel(cb: (level: number) => void): () => void {
    this.levelWatchers.add(cb);
    return () => this.levelWatchers.delete(cb);
  }

  /** Mute keeps the call; the microphone stops hearing until unmuted. */
  setMuted(muted: boolean): void {
    if (this.mutedNow === muted) return;
    this.mutedNow = muted;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted;
    if (muted) {
      if (this.capture) {
        this.pending = { endpointMs: undefined };
        this.capture = null;
      }
    } else if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      void this.start(pending);
    }
  }

  async start(options: { endpointMs?: number }): Promise<void> {
    const mine = ++this.generation;
    this.request?.abort();
    this.request = null;
    if (this.mutedNow) {
      this.pending = options;
      return;
    }
    this.pending = null;
    try {
      await this.open();
    } catch (error) {
      if (mine !== this.generation) return;
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.emitEnd({ code: 1, reason: denied ? "mic-denied" : "mic-unavailable" });
      throw error;
    }
    if (mine !== this.generation) return;
    this.capture = { endpointer: new Endpointer({ endpointMs: options.endpointMs ?? 850 }), frames: [], preroll: [] };
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.capture = null;
    this.pending = null;
    this.request?.abort();
    this.request = null;
  }

  /** Release the microphone (the call ended). */
  async close(): Promise<void> {
    await this.stop();
    this.processor?.disconnect();
    this.source?.disconnect();
    this.analyser?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    const context = this.context;
    this.processor = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.context = null;
    await context?.close().catch(() => {});
  }

  private async open(): Promise<void> {
    if (this.stream && this.context) {
      if (this.context.state === "suspended") await this.context.resume().catch(() => {});
      return;
    }
    const getUserMedia = this.options.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    const deviceId = this.options.deviceId?.();
    const stream = await getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const context = this.options.createContext?.() ?? new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    // ScriptProcessor rather than an AudioWorklet: no module file to serve
    // from a bundle that may be drawn on a server's origin.
    const processor = context.createScriptProcessor(FRAME, 1, 1);
    processor.onaudioprocess = (event) => this.frame(event.inputBuffer.getChannelData(0), context.sampleRate);
    source.connect(analyser);
    source.connect(processor);
    // a processor only runs while connected; its output is silence
    processor.connect(context.destination);
    for (const track of stream.getAudioTracks()) track.enabled = !this.mutedNow;
    this.stream = stream;
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    this.processor = processor;
    if (context.state === "suspended") await context.resume().catch(() => {});
  }

  /** One frame of microphone audio (exposed for tests). */
  frame(samples: Float32Array, rate: number): void {
    const level = this.mutedNow ? 0 : rms(samples);
    for (const fn of Array.from(this.levelWatchers)) fn(level);
    const capture = this.capture;
    if (!capture || this.mutedNow) return;
    const copy = new Float32Array(samples);
    const frameMs = (samples.length / rate) * 1000;
    const before = capture.endpointer.state;
    const state = capture.endpointer.feed(level, frameMs);
    if (before === "waiting") {
      capture.preroll.push(copy);
      // keep about half a second before speech starts
      while (capture.preroll.length * frameMs > 500) capture.preroll.shift();
      if (state !== "waiting") {
        capture.frames.push(...capture.preroll);
        capture.preroll = [];
        this.emitTranscript({ text: "", partial: true });
      }
      return;
    }
    capture.frames.push(copy);
    if (state === "ended") {
      this.capture = null;
      void this.finish(capture.frames, rate);
    }
  }

  private async finish(frames: Float32Array[], rate: number): Promise<void> {
    const mine = this.generation;
    const wav = encodeWav(toPcm16(frames, rate, TARGET_RATE), TARGET_RATE);
    const controller = new AbortController();
    this.request = controller;
    const transcribe = this.options.transcribe ?? transcribeVoiceMode;
    try {
      const text = await transcribe(
        this.options.botId,
        new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
        this.options.language(),
        this.options.threadId?.(),
        controller.signal,
      );
      if (mine !== this.generation) return;
      this.refusal = null;
      this.emitTranscript({ text, partial: false });
      this.emitEnd({ code: 0 });
    } catch (error) {
      if (mine !== this.generation || controller.signal.aborted) return;
      if (error instanceof VoiceModeRefused) {
        this.refusal = error;
        this.emitEnd({ code: 1, reason: "voice_no_access" });
        return;
      }
      this.emitEnd({ code: 1, reason: "transcribe-failed" });
    } finally {
      if (this.request === controller) this.request = null;
    }
  }

  private emitTranscript(line: TranscriptLine): void {
    for (const fn of Array.from(this.transcriptWatchers)) fn(line);
  }

  private emitEnd(info: SpeechEndInfo): void {
    for (const fn of Array.from(this.endWatchers)) fn(info);
  }
}
