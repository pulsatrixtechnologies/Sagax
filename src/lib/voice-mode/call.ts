// A live voice call with a bot, like a phone call: the microphone stays open
// for the whole call (full duplex), the person can talk over the bot and it
// stops at once (barge-in), turns end on a short silence that adapts to the
// person, ambient noise and the bot's own echo do not count as speech, and,
// once enrolled, only the person's own voice does ("Only my voice").
//
//   microphone (getUserMedia: echo cancellation, noise suppression, auto
//   gain, voice isolation where the browser offers it)
//     -> 32 ms frames at 16 kHz
//     -> Silero VAD (on this computer) + echo guard -> turn detector
//     -> while a turn is spoken: PCM streamed to xAI speech to text through
//        the server (GET /voice/listen); finalize the moment it ends
//     -> speaker verification of the turn (on this computer, when enrolled)
//     -> the words go to the BOT as an ordinary message (CallView dispatches
//        the normal send: the bot's engine, tools, memory and approvals)
//   the bot's answer, sentence by sentence as it is written
//     -> POST /voice/stream (xAI text to speech, the person's Voice, Speed and
//        Language) -> Web Audio, the next sentence fetched while this one plays
//
// xAI is ears and a voice only; it never answers. call-machine.ts holds the
// states and decides; this file runs the devices and the effects.
import vadModelUrl from "./models/silero-vad-v5.onnx?url";
import speakerModelUrl from "./models/campplus-sv-en-int8.onnx?url";
import { streamVoiceModeSpeech } from "./api";
import { type CallSettings } from "./call-settings";
import { INITIAL_CALL, step, type CallEffect, type CallEvent, type CallState } from "./call-machine";
import { EchoGuard } from "./echo";
import { loadOrt } from "./onnx";
import { PcmPlayer, type PlaybackCut, type Sentence } from "./player";
import { SentenceStream } from "./sentences";
import { spokenPart } from "./spoken";
import { judge, readVoiceprint, saveVoiceprint, SpeakerEmbedder, voiceprintOf, type Voiceprint } from "./speaker-id";
import { LiveTranscriber } from "./stt-stream";
import { FRAME_MS, TurnDetector } from "./turns";
import { LevelVad, SileroVad, VAD_FRAME, type VoiceProbability } from "./vad";
import type { VoiceModeSettings } from "../../../shared/voice-mode";

const RATE = 16_000;
const PREROLL_FRAMES = 10; // 320 ms before the first voiced frame

export interface TurnMetrics {
  /** the person's last voiced frame (performance.now()) */
  stoppedAt: number;
  /** the turn detector ended the turn */
  endedAt: number;
  /** the words were ready */
  transcribedAt?: number;
  /** sent to the bot */
  sentAt?: number;
  /** the first sentence of the answer was handed to the voice */
  firstSentenceAt?: number;
  /** the first sample of the answer was audible */
  firstAudioAt?: number;
}

export interface BargeInMetrics {
  /** first voiced frame over the bot */
  candidateAt: number;
  /** the bot was ducked (inaudible within the duck ramp) */
  duckedAt?: number;
  /** confirmed: the bot faded out and its queue was dropped */
  cancelledAt?: number;
}

export interface VoiceCallEvents {
  state(state: CallState): void;
  /** words recognized so far in the current turn */
  partial(text: string): void;
  /** an accepted turn: send it to the bot. `interrupted`: the person cut
   * the bot (talked over it, or over its running turn, or pressed
   * interrupt) since the last turn sent; the bot is told (Message.voiceCall). */
  utterance(text: string, metrics: TurnMetrics, turn: { interrupted: boolean; cut?: PlaybackCut }): void;
  /** stop the bot's running turn on the server */
  "interrupt-bot"(): void;
  /** the bot's speech was cut (barge-in, interrupt, hold, end), with what
   * the person heard of it and what they did not */
  "speech-cancelled"(cut: PlaybackCut): void;
  /** a turn from another voice was ignored */
  rejected(reason: "other-voice" | "empty"): void;
  /** the sentence now audible */
  caption(text: string): void;
  error(reason: "mic-denied" | "mic-unavailable" | "speech-failed"): void;
  metrics(turn: TurnMetrics | null, bargeIn: BargeInMetrics | null): void;
}

export interface VoiceCallOptions {
  botId: string;
  threadId: () => string | undefined;
  voice: () => VoiceModeSettings;
  settings: () => CallSettings;
  deviceId?: () => string | undefined;
  /** injected in tests */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createCaptureContext?: () => AudioContext;
  player?: PcmPlayer;
  transcriber?: LiveTranscriber;
  models?: () => Promise<{ vad: VoiceProbability; embedder: SpeakerEmbedder | null }>;
  speech?: typeof streamVoiceModeSpeech;
  /** the enrolled voice (default: this computer's, from localStorage) */
  voiceprint?: Voiceprint | null;
  now?: () => number;
}

type Watchers = { [K in keyof VoiceCallEvents]: Set<VoiceCallEvents[K]> };

/** Constraints that keep the call on the person's voice. Voice isolation is
 * a newer Chromium constraint (macOS voice processing); requested only when
 * the browser lists it, so older versions are not refused. */
export function callAudioConstraints(deviceId?: string, supported: Record<string, boolean> = {}): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(supported.voiceIsolation ? ({ voiceIsolation: true } as MediaTrackConstraints) : {}),
  };
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

export class VoiceCall {
  private readonly o: VoiceCallOptions;
  private readonly now: () => number;
  private state: CallState = INITIAL_CALL;
  private watchers: Watchers = {
    state: new Set(), partial: new Set(), utterance: new Set(), "interrupt-bot": new Set(), "speech-cancelled": new Set(),
    rejected: new Set(), caption: new Set(), error: new Set(), metrics: new Set(),
  };
  private stream: MediaStream | null = null;
  private capture: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private resample: ((input: Float32Array) => Float32Array[]) | null = null;
  readonly player: PcmPlayer;
  readonly transcriber: LiveTranscriber;
  private vad: VoiceProbability = new LevelVad();
  private embedder: SpeakerEmbedder | null = null;
  private voiceprint: Voiceprint | null;
  private readonly turns = new TurnDetector();
  private readonly guard = new EchoGuard();
  private preroll: Float32Array[] = [];
  private chain: Promise<void> = Promise.resolve();
  private backlog = 0;
  private closed = false;
  private pushing = false;
  private turnLevel = { sum: 0, frames: 0 };
  private lastVoicedAt = 0;
  private speechWaiters: Array<(heard: boolean) => void> = [];
  private reply: SentenceStream | null = null;
  private turn: TurnMetrics | null = null;
  private bargeIn: BargeInMetrics | null = null;
  /** the person cut the bot since the last turn sent */
  private cutBot = false;
  /** what they heard of the answer they cut (told to the bot) */
  private lastCut: PlaybackCut | null = null;
  /** the answer's text so far, as last handed to replyProgress */
  private replyText = "";
  private enrolling: { frames: Float32Array[]; levels: number[]; done: (frames: Float32Array[] | null) => void; until: number } | null = null;
  /** the on-device models loaded (else the level detector serves) */
  modelsReady = false;

  constructor(options: VoiceCallOptions) {
    this.o = options;
    this.now = options.now ?? (() => performance.now());
    this.voiceprint = options.voiceprint !== undefined ? options.voiceprint : readVoiceprint();
    this.player = options.player ?? new PcmPlayer();
    this.transcriber = options.transcriber ?? new LiveTranscriber({ botId: options.botId, language: () => options.voice().language, threadId: options.threadId });
    this.player.events = {
      onSentenceStart: (text) => {
        if (this.turn && this.turn.firstAudioAt === undefined && this.turn.sentAt !== undefined) {
          this.turn.firstAudioAt = this.now();
          this.emit("metrics", this.turn, this.bargeIn);
        }
        this.emit("caption", text);
        if (!this.state.botAudible) this.dispatch({ type: "bot-audio-start" });
      },
      onIdle: () => {
        if (this.state.botAudible) this.dispatch({ type: "bot-audio-end" });
        const waiters = this.speechWaiters;
        this.speechWaiters = [];
        for (const resolve of waiters) resolve(true);
      },
      onError: () => this.emit("error", "speech-failed"),
    };
    this.transcriber.onPartial((text) => this.emit("partial", text));
    if (this.voiceprint?.level) this.turns.nearLevel = this.voiceprint.level;
  }

  on<K extends keyof VoiceCallEvents>(name: K, cb: VoiceCallEvents[K]): () => void {
    (this.watchers[name] as Set<VoiceCallEvents[K]>).add(cb);
    return () => (this.watchers[name] as Set<VoiceCallEvents[K]>).delete(cb);
  }

  private emit<K extends keyof VoiceCallEvents>(name: K, ...args: Parameters<VoiceCallEvents[K]>): void {
    for (const fn of Array.from(this.watchers[name]) as Array<(...a: Parameters<VoiceCallEvents[K]>) => void>) fn(...args);
  }

  get current(): CallState {
    return this.state;
  }

  /** The waveform's two sides. */
  get analysers(): { mic: AnalyserNode | null; bot: AnalyserNode | null } {
    return { mic: this.micAnalyser, bot: this.player.output };
  }

  /** The current adaptive endpoint (diagnostics). */
  get endpointMs(): number {
    return this.turns.endpointMs;
  }

  /** "Only my voice" is in force: on, and a voice is enrolled. */
  get verifying(): boolean {
    return Boolean(this.o.settings().onlyMyVoice && this.voiceprint);
  }

  get enrolled(): boolean {
    return this.voiceprint !== null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  /** Open the devices and the ears. Call from the click that starts the call
   * (audio contexts need a gesture). */
  async start(): Promise<void> {
    this.player.open();
    const models = (this.o.models ?? (() => defaultModels(this.voiceprint !== null)))().then(
      ({ vad, embedder }) => {
        this.vad = vad;
        this.embedder = embedder;
        this.modelsReady = true;
      },
      () => {
        // no model: the level detector keeps the call working
        this.modelsReady = false;
      },
    );
    const ears = this.transcriber.connect();
    try {
      await this.openMicrophone();
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.emit("error", denied ? "mic-denied" : "mic-unavailable");
      this.dispatch({ type: "failed" });
      return;
    }
    await Promise.all([models, ears]);
    if (this.closed) return;
    this.dispatch({ type: "connected" });
  }

  /** Try the microphone again (after a refusal was fixed). */
  async retry(): Promise<void> {
    if (this.stream) return;
    try {
      await this.openMicrophone();
      this.dispatch({ type: "connected" });
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.emit("error", denied ? "mic-denied" : "mic-unavailable");
    }
  }

  end(): void {
    this.dispatch({ type: "end" });
  }

  setMuted(muted: boolean): void {
    this.dispatch({ type: "mute", muted });
  }

  get muted(): boolean {
    return this.state.muted;
  }

  hold(): void {
    this.dispatch({ type: "hold" });
  }

  resume(): void {
    this.dispatch({ type: "resume" });
  }

  /** The interrupt button or Space: the bot stops talking. */
  interrupt(): void {
    this.dispatch({ type: "interrupt" });
  }

  /** The bot's turn started or ended on the server. */
  setBotBusy(busy: boolean): void {
    if (this.state.botBusy !== busy) this.dispatch({ type: "bot-busy", busy });
  }

  // ── speaking ───────────────────────────────────────────────────────────

  /** Say a whole text (a prompt, a narration chip, a settled answer).
   * Resolves true once heard, false when cut. */
  say(text: string): Promise<boolean> {
    if (this.state.phase === "held" || this.state.phase === "ended") return Promise.resolve(false);
    const stream = new SentenceStream();
    const sentences = stream.finish(text);
    for (const sentence of sentences) this.enqueue(sentence);
    if (!sentences.length) return Promise.resolve(true);
    return new Promise((resolve) => this.speechWaiters.push(resolve));
  }

  /** The bot's answer while it is written: the whole text so far. */
  replyProgress(text: string): void {
    if (this.state.phase === "held" || this.state.phase === "ended") return;
    this.reply ??= new SentenceStream();
    this.replyText = spokenPart(text);
    for (const sentence of this.reply.feed(this.replyText)) this.enqueue(sentence);
  }

  /** The answer (or this block of it) is complete. */
  replyDone(text: string): Promise<boolean> {
    const stream = this.reply ?? new SentenceStream();
    this.reply = null;
    const rest = stream.finish(spokenPart(text));
    for (const sentence of rest) this.enqueue(sentence);
    if (!this.player.busy) return Promise.resolve(true);
    return new Promise((resolve) => this.speechWaiters.push(resolve));
  }

  /** Characters of the current answer already handed to the voice. */
  get replyPosition(): number {
    return this.reply?.position ?? 0;
  }

  private enqueue(text: string): void {
    if (this.state.phase === "held" || this.state.phase === "ended") return;
    if (this.turn && this.turn.firstSentenceAt === undefined && this.turn.sentAt !== undefined) this.turn.firstSentenceAt = this.now();
    const controller = new AbortController();
    const speech = this.o.speech ?? streamVoiceModeSpeech;
    const sentence: Sentence = {
      text,
      audio: speech(this.o.botId, text, this.o.voice(), this.o.threadId(), controller.signal),
      abort: () => controller.abort(),
    };
    sentence.audio.catch(() => {});
    this.player.enqueue(sentence);
  }

  // ── push to talk ───────────────────────────────────────────────────────

  pushToTalk(down: boolean): void {
    if (this.o.settings().input !== "push" || this.state.muted || this.state.phase === "held") return;
    if (down && !this.pushing) {
      this.pushing = true;
      this.transcriber.begin(this.preroll.slice(-3));
      this.turnLevel = { sum: 0, frames: 0 };
      this.dispatch({ type: "speech-candidate" });
      this.dispatch({ type: "speech-start" });
    } else if (!down && this.pushing) {
      this.pushing = false;
      this.lastVoicedAt = this.now();
      this.beginTurnMetrics(this.lastVoicedAt);
      this.dispatch({ type: "speech-end" });
    }
  }

  // ── enrollment ("Only my voice") ───────────────────────────────────────

  /** Record the person's voice for a few seconds of speech and keep its
   * voiceprint on this computer. `progress` gets 0..1. */
  async enroll(progress: (share: number) => void, seconds = 6, timeoutMs = 25_000): Promise<boolean> {
    if (!this.embedder) {
      try {
        const ort = await loadOrt();
        this.embedder = await SpeakerEmbedder.load(ort, speakerModelUrl);
      } catch {
        return false;
      }
    }
    this.enrollLevels = [];
    const frames = await new Promise<Float32Array[] | null>((done) => {
      this.enrolling = { frames: [], levels: [], done, until: this.now() + timeoutMs };
      const tick = setInterval(() => {
        const enrolling = this.enrolling;
        if (!enrolling) return clearInterval(tick);
        const share = (enrolling.frames.length * FRAME_MS) / (seconds * 1000);
        progress(Math.min(1, share));
        if (share >= 1 || this.now() > enrolling.until) {
          clearInterval(tick);
          this.enrolling = null;
          done(share >= 0.6 ? enrolling.frames : null);
        }
      }, 100);
    });
    const levels = this.enrollLevels;
    if (!frames || !this.embedder) return false;
    // three clips, one voiceprint
    const clipFrames = Math.floor(frames.length / 3);
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < 3; i++) {
      const clip = concat(frames.slice(i * clipFrames, (i + 1) * clipFrames));
      const embedding = await this.embedder.embed(clip);
      if (embedding) embeddings.push(embedding);
    }
    if (!embeddings.length) return false;
    const level = levels.length ? levels.sort((a, b) => a - b)[Math.floor(levels.length / 2)]! : 0;
    this.voiceprint = voiceprintOf(embeddings, level);
    saveVoiceprint(this.voiceprint);
    this.turns.nearLevel = level || undefined;
    progress(1);
    return true;
  }

  private enrollLevels: number[] = [];

  /** Forget the voiceprint (the settings' "Forget my voice"). */
  forgetVoice(): void {
    this.voiceprint = null;
    this.turns.nearLevel = undefined;
  }

  // ── the microphone ─────────────────────────────────────────────────────

  private async openMicrophone(): Promise<void> {
    const getUserMedia = this.o.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    const supported = (typeof navigator !== "undefined" ? navigator.mediaDevices?.getSupportedConstraints?.() : undefined) as Record<string, boolean> | undefined;
    const stream = await getUserMedia({ audio: callAudioConstraints(this.o.deviceId?.(), supported ?? {}), video: false });
    if (this.closed) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    let context: AudioContext;
    let source: MediaStreamAudioSourceNode;
    try {
      context = this.o.createCaptureContext?.() ?? new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
      source = context.createMediaStreamSource(stream);
    } catch {
      // a browser that cannot capture at 16 kHz: its own rate, resampled here
      context = new AudioContext({ latencyHint: "interactive" });
      source = context.createMediaStreamSource(stream);
    }
    if (context.sampleRate !== RATE) this.resample = resampler(context.sampleRate);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const size = context.sampleRate === RATE ? VAD_FRAME : 2048;
    // ScriptProcessor rather than an AudioWorklet: no module file to serve
    // from a bundle that may be drawn on a server's origin
    const processor = context.createScriptProcessor(size, 1, 1);
    processor.onaudioprocess = (event) => this.onAudio(event.inputBuffer.getChannelData(0));
    source.connect(analyser);
    source.connect(processor);
    processor.connect(context.destination);
    for (const track of stream.getAudioTracks()) track.enabled = !this.state.muted && this.state.phase !== "held";
    this.stream = stream;
    this.capture = context;
    this.source = source;
    this.micAnalyser = analyser;
    this.processor = processor;
    if (context.state === "suspended") await context.resume().catch(() => {});
  }

  private release(): void {
    this.closed = true;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.micAnalyser?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    const capture = this.capture;
    this.processor = null;
    this.source = null;
    this.micAnalyser = null;
    this.stream = null;
    this.capture = null;
    void capture?.close().catch(() => {});
    this.transcriber.close();
    // let the end earcon play before the voice closes
    setTimeout(() => void this.player.close(), 400);
    const waiters = this.speechWaiters;
    this.speechWaiters = [];
    for (const resolve of waiters) resolve(false);
  }

  private onAudio(samples: Float32Array): void {
    if (this.closed) return;
    const frames = this.resample ? this.resample(samples) : [new Float32Array(samples)];
    for (const frame of frames) this.frame(frame);
  }

  /** One 32 ms frame at 16 kHz (exposed for tests). */
  frame(frame: Float32Array): void {
    if (this.closed || this.state.muted || this.state.phase === "held") return;
    // a slow computer: drop frames rather than fall behind the person
    if (this.backlog > 6) return;
    this.backlog += 1;
    this.chain = this.chain.then(() => this.process(frame)).catch(() => {}).finally(() => {
      this.backlog -= 1;
    });
  }

  /** Resolves once every frame given so far is processed (tests). */
  settled(): Promise<void> {
    return this.chain;
  }

  private async process(frame: Float32Array): Promise<void> {
    if (this.closed || this.state.muted || this.state.phase === "held") return;
    const level = rms(frame);
    const probability = await this.vad.probability(frame);
    const playback = this.player.level();
    const echo = this.guard.update(level, playback);
    const botAudible = this.state.botAudible || playback > 0.004;

    if (this.enrolling) {
      if (probability > 0.6 && !botAudible) {
        this.enrolling.frames.push(frame);
        this.enrollLevels.push(level);
      }
      return;
    }

    if (this.o.settings().input === "push") {
      if (this.pushing) {
        this.transcriber.push(frame);
        this.turnLevel.sum += level;
        this.turnLevel.frames += 1;
      }
      this.keepPreroll(frame);
      return;
    }

    const event = this.turns.feed({ probability, level, botAudible, echo });
    if (!event) {
      if (this.turns.active) {
        this.transcriber.push(frame);
        if (probability > 0.5) {
          this.lastVoicedAt = this.now();
          this.turnLevel.sum += level;
          this.turnLevel.frames += 1;
        }
      } else this.keepPreroll(frame);
      return;
    }
    switch (event.type) {
      case "candidate":
        this.keepPreroll(frame);
        this.transcriber.begin(this.preroll);
        this.preroll = [];
        this.turnLevel = { sum: level, frames: 1 };
        this.lastVoicedAt = this.now();
        if (event.bargeIn) this.bargeIn = { candidateAt: this.now() };
        this.dispatch({ type: "speech-candidate" });
        return;
      case "start":
        this.transcriber.push(frame);
        this.lastVoicedAt = this.now();
        this.dispatch({ type: "speech-start" });
        return;
      case "cancel":
        this.dispatch({ type: "speech-cancel" });
        return;
      case "end":
        this.beginTurnMetrics(this.lastVoicedAt);
        this.dispatch({ type: "speech-end" });
        return;
    }
  }

  private keepPreroll(frame: Float32Array): void {
    this.preroll.push(frame);
    if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
  }

  private beginTurnMetrics(stoppedAt: number): void {
    this.turn = { stoppedAt, endedAt: this.now() };
  }

  // ── the state machine's effects ────────────────────────────────────────

  private dispatch(event: CallEvent): void {
    const { state, effects } = step(this.state, event);
    const changed = state !== this.state;
    this.state = state;
    // the person cut the bot: the next turn they send says so
    if ((event.type === "speech-start" && state.phase === "interrupted") ||
      (event.type === "interrupt" && effects.some((effect) => effect.type === "cancel-speech"))) this.cutBot = true;
    for (const effect of effects) this.run(effect);
    if (changed) this.emit("state", state);
  }

  private run(effect: CallEffect): void {
    switch (effect.type) {
      case "duck":
        this.player.duck();
        if (this.bargeIn) this.bargeIn.duckedAt = this.now();
        return;
      case "unduck":
        this.player.unduck();
        this.bargeIn = null;
        return;
      case "cancel-speech": {
        // what played by the audio clock, plus what the bot had written but
        // not yet handed to the voice: the person heard none of that
        const played = this.player.playback(this.o.voice().speed);
        const unwritten = this.reply ? this.replyText.slice(this.reply.position).trim() : "";
        const cut: PlaybackCut = { heard: played.heard, unheard: [played.unheard, unwritten].filter(Boolean).join(" ") };
        if (cut.heard || cut.unheard) this.lastCut = cut;
        this.player.resetLedger();
        void this.player.cancel();
        this.reply = null;
        this.replyText = "";
        if (this.bargeIn) {
          this.bargeIn.cancelledAt = this.now();
          this.emit("metrics", this.turn, this.bargeIn);
        }
        const waiters = this.speechWaiters;
        this.speechWaiters = [];
        for (const resolve of waiters) resolve(false);
        this.emit("speech-cancelled", cut);
        return;
      }
      case "interrupt-bot":
        this.emit("interrupt-bot");
        return;
      case "send":
        if (this.turn) {
          this.turn.sentAt = this.now();
          this.emit("metrics", this.turn, this.bargeIn);
        }
        this.emit("utterance", effect.text, this.turn ?? { stoppedAt: this.now(), endedAt: this.now() }, {
          interrupted: this.cutBot,
          ...(this.cutBot && this.lastCut ? { cut: this.lastCut } : {}),
        });
        this.cutBot = false;
        this.lastCut = null;
        // a new answer starts: what it plays is measured from here
        this.player.resetLedger();
        return;
      case "finalize-stt":
        void this.finishTurn();
        return;
      case "cancel-stt":
        this.transcriber.discard();
        this.turns.reset();
        this.pushing = false;
        return;
      case "earcon":
        if (this.o.settings().earcons) this.player.tone(EARCONS[effect.sound]);
        return;
      case "mic":
        for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = effect.open;
        this.turns.reset();
        this.preroll = [];
        return;
      case "release":
        this.release();
        return;
    }
  }

  private async finishTurn(): Promise<void> {
    const audio = this.transcriber.audio();
    const speechLevel = this.turnLevel.frames ? this.turnLevel.sum / this.turnLevel.frames : 0;
    const [text, verdict] = await Promise.all([this.transcriber.finish(), this.verify(audio)]);
    if (this.closed) return;
    if (this.turn) this.turn.transcribedAt = this.now();
    if (!verdict) {
      this.emit("rejected", "other-voice");
      this.dispatch({ type: "utterance-rejected", reason: "other-voice" });
      return;
    }
    if (!text.trim()) {
      this.dispatch({ type: "utterance-rejected", reason: "empty" });
      return;
    }
    // learn the person's level from accepted turns (far-field gate), slowly
    if (speechLevel > 0 && this.verifying) {
      const known = this.turns.nearLevel;
      this.turns.nearLevel = known ? known * 0.8 + speechLevel * 0.2 : speechLevel;
    }
    this.dispatch({ type: "utterance", text });
  }

  /** True when the turn may be the person's (or no check is in force). */
  private async verify(audio: Float32Array): Promise<boolean> {
    if (!this.verifying || !this.embedder || !this.voiceprint) return true;
    const seconds = audio.length / RATE;
    try {
      const embedding = await this.embedder.embed(audio);
      return judge(this.voiceprint, embedding, seconds).accepted;
    } catch {
      return true;
    }
  }
}

const EARCONS: Record<Extract<CallEffect, { type: "earcon" }>["sound"], Array<{ hz: number; ms: number }>> = {
  connected: [{ hz: 660, ms: 90 }, { hz: 880, ms: 140 }],
  interrupted: [{ hz: 520, ms: 60 }],
  rejected: [{ hz: 300, ms: 80 }],
  hold: [{ hz: 440, ms: 120 }, { hz: 440, ms: 120 }],
  resume: [{ hz: 880, ms: 100 }],
  ended: [{ hz: 880, ms: 90 }, { hz: 660, ms: 90 }, { hz: 440, ms: 160 }],
};

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const frame of frames) {
    out.set(frame, at);
    at += frame.length;
  }
  return out;
}

/** Streaming resampler to 16 kHz in 512-sample frames (averaging decimation). */
export function resampler(fromRate: number): (input: Float32Array) => Float32Array[] {
  const ratio = fromRate / RATE;
  let position = 0;
  let pending: number[] = [];
  let carry = new Float32Array(0);
  return (input) => {
    const joined = new Float32Array(carry.length + input.length);
    joined.set(carry, 0);
    joined.set(input, carry.length);
    const out: Float32Array[] = [];
    while (position + ratio <= joined.length) {
      const start = Math.floor(position);
      const end = Math.max(start + 1, Math.floor(position + ratio));
      let sum = 0;
      for (let i = start; i < end; i++) sum += joined[i]!;
      pending.push(sum / (end - start));
      position += ratio;
      if (pending.length === VAD_FRAME) {
        out.push(Float32Array.from(pending));
        pending = [];
      }
    }
    const used = Math.floor(position);
    carry = joined.slice(used);
    position -= used;
    return out;
  };
}

async function defaultModels(withSpeaker: boolean): Promise<{ vad: VoiceProbability; embedder: SpeakerEmbedder | null }> {
  const ort = await loadOrt();
  const [vad, embedder] = await Promise.all([
    SileroVad.load(ort, vadModelUrl),
    withSpeaker ? SpeakerEmbedder.load(ort, speakerModelUrl).catch(() => null) : Promise.resolve(null),
  ]);
  return { vad, embedder };
}
