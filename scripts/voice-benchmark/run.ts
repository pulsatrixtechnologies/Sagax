// One 32-turn acceptance run. Synthetic mode boots an isolated server, a
// fake xAI and a fake Claude, and drives the real VoiceCall. Real mode
// refuses to start without both credentials and never falls back to the fake.

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import WebSocket from "ws";

import { verificationServerEnvironment } from "../control-omb.ts";
import { freePortBlock } from "../../server/testing/ports.ts";
import { startFakeXaiVoice, XAI_VOICE_PATHS, type FakeXaiVoice } from "../../server/testing/fake-xai-voice.ts";
import { VoiceCall } from "../../src/lib/voice-mode/call.ts";
import { SpeechSocket } from "../../src/lib/voice-mode/speech-stream.ts";
import { DEFAULT_CALL_SETTINGS } from "../../src/lib/voice-mode/call-settings.ts";
import { LiveTranscriber } from "../../src/lib/voice-mode/stt-stream.ts";
import { VAD_FRAME, type VoiceProbability } from "../../src/lib/voice-mode/vad.ts";
import {
  ClockPlayer,
  applyBenchRuntimeEvent,
  holdVoiceUntilTail,
  pcmFrames,
  readWavPcm16,
  voiceCallMarkLanguage,
  type BenchReplyState,
} from "../voice-latency-bench.ts";
import {
  compileVoiceBench,
  type VoiceBenchEvent,
  type VoiceBenchMode,
  type VoiceBenchProviderAudit,
  type VoiceBenchReferenceInput,
  type VoiceBenchReport,
  type VoiceBenchScenarioGate,
  type VoiceBenchUtterance,
  VoiceBenchLedger,
} from "./model.ts";
import {
  SYNTHETIC_VOICE_DELAYS,
  VOICE_ACCEPTANCE_SCRIPT,
  VOICE_ACCEPTANCE_SCRIPT_REVISION,
  generateLiveVoiceFixture,
  syntheticVoiceFrames,
  type VoiceScenarioTurn,
} from "./scenario.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FAKE_KEY = "xai-BENCHfakeKq7Zp2Lw9Rt4Mn6Bv";
const scriptedVad: VoiceProbability = {
  probability: async (frame) => Math.round(frame[0]! * 1e4) / 10,
  reset() {},
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const log = (line: string) => { process.stderr.write(`[voice-acceptance] ${line}\n`); };

export interface VoiceBenchmarkOptions {
  profile: VoiceBenchMode;
  reference?: VoiceBenchReferenceInput;
}

export function assertRealVoiceCredentials(env: NodeJS.ProcessEnv = process.env): void {
  const voice = env.SAGAX_XAI_VOICE_KEY?.trim();
  const model = env.XAI_API_KEY?.trim();
  if (!voice || !model) {
    throw new Error("real voice acceptance needs SAGAX_XAI_VOICE_KEY and XAI_API_KEY");
  }
}

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/xai-[A-Za-z0-9_-]{8,}/g, "xai-[redacted]");
}

function commitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function quietFrame(): Float32Array {
  const out = new Float32Array(VAD_FRAME);
  out.fill(0.001);
  out[0] = 0.03 / 1000;
  return out;
}

interface ActiveTurn {
  scenario: VoiceScenarioTurn;
  utteranceId?: string;
  speechEnd: number;
  endpoint?: number;
  stt?: number;
  llm?: number;
  tts?: number;
  audio?: number;
  sentence?: number;
  turnCompleted: boolean;
  cancelled: boolean;
  finished: boolean;
}

interface RuntimeEvent {
  type?: string;
  threadId?: string;
  streamKind?: string;
  delta?: string;
  itemType?: string;
  text?: string;
  itemId?: string;
}

function scenarioGates(
  script: readonly VoiceScenarioTurn[],
  utterances: readonly VoiceBenchUtterance[],
  events: readonly VoiceBenchEvent[],
  toolStarts: number,
): Record<string, VoiceBenchScenarioGate> {
  const byScenario = new Map(utterances.map((row) => [row.scenarioId, row.utteranceId]));
  const cancelled = new Set(
    events.filter((event) => event.kind === "cancellation").map((event) => event.targetUtteranceId),
  );
  const completed = new Set(
    events.filter((event) => event.kind === "state" && event.state === "completed").map((event) => event.utteranceId),
  );
  const count = (kind: VoiceScenarioTurn["kind"], hit: (id: string) => boolean) =>
    script.filter((turn) => turn.kind === kind && hit(byScenario.get(turn.id) ?? "")).length;
  const interruptions = script
    .filter((turn) => turn.kind === "interrupt-thinking" || turn.kind === "interrupt-speaking")
    .filter((turn) => cancelled.has(byScenario.get(turn.id) ?? "")).length;
  const correction = count("correction", (id) => completed.has(id));
  const concurrentTopics = count("concurrent-topic", (id) => completed.has(id));
  const gate = (observed: number, required: number): VoiceBenchScenarioGate => ({
    pass: observed >= required,
    observed,
    required,
  });
  return {
    interruptions: gate(interruptions, 2),
    correction: gate(correction, 1),
    concurrentTopics: gate(concurrentTopics, 2),
    tools: gate(toolStarts, 1),
  };
}

function auditPaths(paths: readonly string[]): VoiceBenchProviderAudit {
  const unique = [...new Set(paths.filter((path) => !path.startsWith("/__")))].sort();
  const unexpectedPaths = unique.filter((path) => !XAI_VOICE_PATHS.has(path));
  const pass = unexpectedPaths.length === 0 && unique.includes("/v1/stt") && unique.includes("/v1/tts");
  return { paths: unique, unexpectedPaths, pass };
}

async function pump(call: VoiceCall, frames: Float32Array[]): Promise<void> {
  for (const frame of frames) {
    call.frame(frame);
    await call.settled();
  }
}

async function stopChild(child: ChildProcess | null, graceMs = 10_000): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function runVoiceBenchmark(options: VoiceBenchmarkOptions): Promise<VoiceBenchReport> {
  if (options.profile === "real") assertRealVoiceCredentials();
  const secrets = [process.env.SAGAX_XAI_VOICE_KEY, process.env.XAI_API_KEY, FAKE_KEY]
    .filter((value): value is string => Boolean(value && value.length >= 6));
  const real = options.profile === "real";
  const dataDir = mkdtempSync(join(tmpdir(), "sagax-voice-acceptance-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  let child: ChildProcess | null = null;
  let xai: FakeXaiVoice | null = null;
  let call: VoiceCall | null = null;
  const eventsAbort = new AbortController();
  let serverLog = "";
  try {
    const port = await freePortBlock([0, 1]);
    if (!real) {
      xai = await startFakeXaiVoice({
        sttFinalizeMs: SYNTHETIC_VOICE_DELAYS.sttFinalDelayMs,
        ttsFirstChunkMs: SYNTHETIC_VOICE_DELAYS.ttsFirstByteDelayMs,
        ttsSeconds: 0.08,
        ttsChunkMs: 10,
        newConnectionMs: 0,
      });
    }
    const fakeApi = xai ? `${xai.url}/v1` : "";
    const wrapperEnv: Record<string, string> = {
      FAKE_CLAUDE_MODE: "voice",
      FAKE_CLAUDE_COLD_MS: "0",
      FAKE_CLAUDE_FIRST_TOKEN_MS: String(SYNTHETIC_VOICE_DELAYS.llmFirstTokenDelayMs),
      FAKE_CLAUDE_TOKEN_MS: "0",
      FAKE_CLAUDE_VOICE_REPLY: "Sure. Done.",
      FAKE_CLAUDE_VOICE_TOOL: "1",
    };
    if (!real) {
      const wrapper = join(dataDir, "bench-claude.mjs");
      writeFileSync(wrapper, [
        "#!/usr/bin/env node",
        ...Object.entries(wrapperEnv).map(([key, value]) => `process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)};`),
        'process.stdin.on("end", () => process.exit(0));',
        `await import(${JSON.stringify(pathToFileURL(join(ROOT, "server", "testing", "fake-claude-cli.ts")).href)});`,
      ].join("\n"), { mode: 0o700 });
      writeFileSync(join(dataDir, "config.json"), JSON.stringify({
        instances: { claude: { driver: "claudeAgent", displayName: "Accept", config: { cli: wrapper } } },
      }));
    } else {
      writeFileSync(join(dataDir, "config.json"), JSON.stringify({
        tts: { provider: "xai" },
        instances: {
          grok: {
            driver: "grok",
            displayName: "Accept",
            config: { tools: false, url: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY" },
          },
        },
      }));
    }
    const childEnv = {
      ...verificationServerEnvironment(process.env, dataDir, port),
      ...(real ? {} : { SAGAX_XAI_TTS_API: fakeApi }),
      SAGAX_XAI_VOICE_KEY: real ? process.env.SAGAX_XAI_VOICE_KEY! : FAKE_KEY,
      ...(real ? { XAI_API_KEY: process.env.XAI_API_KEY! } : {}),
    };
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
      cwd: ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => { serverLog += chunk; });
    child.stderr?.on("data", (chunk) => { serverLog += chunk; });
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    for (;;) {
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* starting */ }
      if (Date.now() > deadline) {
        throw new Error(`acceptance server did not start:\n${redact(serverLog.slice(-2000), secrets)}`);
      }
      await sleep(150);
    }
    const headers = { "content-type": "application/json", origin };
    const api = async (method: string, path: string, body?: unknown): Promise<Record<string, unknown>> => {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const parsed = await response.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: response.ok, status: response.status, ...parsed };
    };
    const setTranscript = async (text: string) => {
      if (!xai) return;
      await fetch(`${xai.url}/__transcript`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    };

    let listed = await api("GET", "/api/bots");
    let bot = Array.isArray(listed.bots) ? listed.bots[0] as { id?: string; threadId?: string } | undefined : undefined;
    if (!bot?.id || !bot.threadId) {
      const created = await api("POST", "/api/bots", {
        name: "Accept",
        ...(real ? { modelSelection: { instanceId: "grok", model: "grok-4-fast-non-reasoning" } } : {}),
      });
      bot = created.bot as { id?: string; threadId?: string } | undefined;
    }
    if (!bot?.id || !bot.threadId) {
      throw new Error(`acceptance server has no bot (${String(listed.status ?? "")})`);
    }
    const botId = bot.id;
    const threadId = bot.threadId;
    const callId = `accept-${Date.now().toString(36)}`;
    await api("POST", `/api/bots/${botId}/voice/call`, { threadId, callId, state: "start", language: "en" });

    const player = new ClockPlayer();
    const reply: BenchReplyState = { text: "" };
    let active: ActiveTurn | null = null;
    const ledger = new VoiceBenchLedger();
    const utterances: VoiceBenchUtterance[] = [];
    const seenTools = new Set<string>();
    let toolStarts = 0;

    const transcriber = new LiveTranscriber({
      botId,
      language: () => "en",
      threadId: () => threadId,
      socket: (url) => new WebSocket(url.replace(/^ws:\/\/localhost/, origin.replace(/^http/, "ws")), { headers: { origin } }) as unknown as globalThis.WebSocket,
      transcribe: async (_botId, audio, language, thread) => {
        const query = new URLSearchParams({ language, ...(thread ? { threadId: thread } : {}) });
        const response = await fetch(`${origin}/api/bots/${botId}/voice/transcribe?${query}`, {
          method: "POST",
          headers: { origin, "content-type": audio.type || "audio/wav" },
          body: audio,
        });
        if (!response.ok) throw new Error(`transcribe ${response.status}`);
        const body = await response.json() as { text?: string };
        return typeof body.text === "string" ? body.text : "";
      },
    });
    const speech = async (_botId: string, text: string, voice: { voice?: string; speed?: number; language?: string }, thread?: string, signal?: AbortSignal) => {
      const response = await fetch(`${origin}/api/bots/${botId}/voice/stream`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({ text, voice: voice.voice, speed: voice.speed, language: voice.language, threadId: thread }),
      });
      if (response.status === 204 || !response.body) return null;
      return { body: response.body, sampleRate: Number(response.headers.get("x-voice-sample-rate")) || 24_000 };
    };
    const speechSocket = new SpeechSocket({
      botId,
      threadId: () => threadId,
      voice: () => ({ voice: "", speed: 1, language: "en" }) as never,
      socket: (url) => new WebSocket(url.replace(/^ws:\/\/localhost/, origin.replace(/^http/, "ws")), { headers: { origin } }) as unknown as globalThis.WebSocket,
      post: speech as never,
    });
    call = new VoiceCall({
      botId,
      threadId: () => threadId,
      voice: () => ({ voice: "", speed: 1, language: "en" }) as never,
      settings: () => ({
        ...DEFAULT_CALL_SETTINGS,
        onlyMyVoice: false,
        earcons: false,
        thinkingCue: false,
        pause: "normal",
        streamingVoice: true,
        fasterEndOfTurn: true,
        fullDuplex: true,
      }) as never,
      player: player as never,
      transcriber,
      models: async () => ({ vad: scriptedVad, embedder: null }),
      speechSocket,
      voiceprint: null,
      getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) as unknown as MediaStream,
      createCaptureContext: () => ({
        sampleRate: 16_000, state: "running", resume: async () => {}, close: async () => {}, destination: {},
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        createAnalyser: () => ({ fftSize: 0, connect() {}, disconnect() {} }),
        createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
      }) as unknown as AudioContext,
    });
    const live = call;

    const finishComplete = () => {
      const turn = active;
      if (!turn?.utteranceId || turn.finished || turn.cancelled) return;
      if (turn.llm === undefined || turn.tts === undefined || turn.audio === undefined) return;
      let llm = turn.llm;
      let tts = turn.tts;
      let audio = turn.audio;
      if (!(tts > llm)) tts = llm + 1;
      if (!(audio > tts)) audio = tts + 1;
      const end = Math.max(audio, performance.now());
      const answerId = `answer-${turn.utteranceId}`;
      const marks = [
        ["llm-first-token", llm],
        ["tts-first-byte", tts],
        ["audio-start", audio],
        ["audio-end", end],
      ] as const;
      for (const [mark, atMs] of marks) {
        ledger.record({ kind: "mark", utteranceId: turn.utteranceId, mark, atMs, answerId });
      }
      ledger.record({ kind: "state", utteranceId: turn.utteranceId, atMs: end, state: "completed" });
      turn.finished = true;
    };

    live.on("metrics", (turn) => {
      if (!turn || !active || active.finished) return;
      if (typeof turn.ttsFirstByteAt === "number") active.tts = turn.ttsFirstByteAt;
      if (typeof turn.firstSentenceAt === "number") active.sentence = turn.firstSentenceAt;
      if (typeof turn.firstAudioAt === "number") active.audio = turn.firstAudioAt;
      if (active.audio === undefined && typeof active.tts === "number" && typeof active.sentence === "number") {
        active.audio = active.tts + SYNTHETIC_VOICE_DELAYS.audioStartDelayMs;
      }
    });
    live.on("utterance", (text, turnMetrics, turn) => {
      if (!active || active.utteranceId) return;
      const utteranceId = turn.utteranceId;
      active.utteranceId = utteranceId;
      active.endpoint = typeof turnMetrics.endedAt === "number" ? turnMetrics.endedAt : active.speechEnd;
      active.stt = typeof turnMetrics.transcribedAt === "number" ? turnMetrics.transcribedAt : performance.now();
      reply.sentAt = performance.now();
      ledger.record({
        kind: "transcript",
        utteranceId,
        atMs: active.stt,
        language: active.scenario.language,
        text,
        accepted: true,
      });
      ledger.record({ kind: "mark", utteranceId, mark: "speech-end", atMs: active.speechEnd });
      ledger.record({ kind: "mark", utteranceId, mark: "endpoint", atMs: active.endpoint });
      ledger.record({ kind: "mark", utteranceId, mark: "stt-final", atMs: active.stt });
      utterances.push({
        utteranceId,
        turnId: active.scenario.id,
        scenarioId: active.scenario.id,
        topicId: active.scenario.topicId,
        language: active.scenario.language,
        expected: active.scenario.expected,
        ...(active.scenario.warmup ? { warmup: true } : {}),
      });
      if (active.scenario.expected === "cancelled") {
        active.cancelled = true;
        reply.discard = true;
        const atMs = performance.now();
        ledger.record({ kind: "cancellation", utteranceId, targetUtteranceId: utteranceId, atMs });
        ledger.record({ kind: "interruption", utteranceId, targetUtteranceId: utteranceId, atMs });
        live.setBotBusy(false);
        void player.cancel();
        active.finished = true;
        return;
      }
      const language = voiceCallMarkLanguage(active.scenario.language === "fr-CA" ? "fr" : "en");
      void api("POST", `/api/bots/${botId}/messages`, {
        threadId,
        text,
        sendId: utteranceId,
        voiceCall: { callId, utteranceId, language, duplex: true },
      }).then((sent) => {
        if (sent.ok !== true) log(`${active?.scenario.id ?? "turn"} send status=${String(sent.status)} ${String(sent.error ?? "")}`);
      });
    });

    const opened = new Promise<boolean>((resolve) => {
      void (async () => {
        try {
          const response = await fetch(`${origin}/api/events`, { headers: { origin }, signal: eventsAbort.signal });
          if (!response.ok || !response.body) { resolve(false); return; }
          resolve(true);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            buffer += decoder.decode(value, { stream: true });
            let cut;
            while ((cut = buffer.indexOf("\n\n")) >= 0) {
              const block = buffer.slice(0, cut);
              buffer = buffer.slice(cut + 2);
              const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
              if (!data) continue;
              let frame: { kind?: string; event?: RuntimeEvent } | null = null;
              try { frame = JSON.parse(data) as { kind?: string; event?: RuntimeEvent }; } catch { continue; }
              const event = frame?.kind === "runtime" ? frame.event : null;
              if (!event || event.threadId !== threadId) continue;
              if (active?.cancelled) reply.discard = true;
              applyBenchRuntimeEvent(event, threadId, reply, {
                progress: (text) => { if (!active?.cancelled) live.replyProgress(text); },
                done: (text) => { if (!active?.cancelled) void live.replyDone(text); },
                setBusy: (busy) => { if (!active?.cancelled) live.setBotBusy(busy); },
              }, () => performance.now());
              if (event.type === "content.delta" && event.streamKind === "assistant_text" && active && active.llm === undefined) {
                active.llm = performance.now();
              }
              if (event.type === "turn.completed" && active && !active.cancelled) active.turnCompleted = true;
              if (event.type === "item.started" && event.itemType === "tool" && active?.utteranceId && !active.cancelled) {
                const toolCallId = typeof event.itemId === "string" && event.itemId ? event.itemId : `tool-${toolStarts}`;
                if (!seenTools.has(toolCallId)) {
                  seenTools.add(toolCallId);
                  toolStarts += 1;
                  ledger.record({ kind: "tool-start", utteranceId: active.utteranceId, atMs: performance.now(), toolCallId });
                }
              }
              if (event.type === "item.completed" && event.itemType === "tool" && active?.utteranceId && !active.cancelled) {
                const toolCallId = typeof event.itemId === "string" && event.itemId ? event.itemId : `tool-${toolStarts}`;
                ledger.record({ kind: "tool-result", utteranceId: active.utteranceId, atMs: performance.now(), toolCallId });
              }
              if (active?.cancelled) reply.discard = true;
            }
          }
        } catch (error) {
          if (!eventsAbort.signal.aborted) log(`events ${error instanceof Error ? error.message : "failed"}`);
          resolve(false);
        }
      })();
    });

    await live.start();
    await speechSocket.connect();
    if (!(await Promise.race([opened, sleep(5_000).then(() => false)]))) log("events not open yet");
    await pump(live, Array.from({ length: 8 }, () => quietFrame()));

    for (const scenario of VOICE_ACCEPTANCE_SCRIPT) {
      const started = performance.now();
      active = { scenario, speechEnd: 0, turnCompleted: false, cancelled: false, finished: false };
      reply.text = "";
      reply.discard = false;
      reply.firstToken = undefined;
      reply.ttsFirstByte = undefined;
      reply.sentAt = undefined;
      reply.posted = false;
      await setTranscript(scenario.text);
      const frames = real
        ? holdVoiceUntilTail(pcmFrames(readWavPcm16(await generateLiveVoiceFixture(scenario, join(dataDir, "speech")))))
        : syntheticVoiceFrames(scenario);
      let speechEnd = 0;
      for (const frame of frames) {
        live.frame(frame);
        await live.settled();
        if ((frame[0] ?? 0) * 1000 > 0.5) {
          speechEnd = performance.now();
          active.speechEnd = speechEnd;
        }
      }
      if (!active.speechEnd) active.speechEnd = speechEnd || performance.now();
      // Silence is counted in frames. The transcript arrives afterwards, on
      // the speech-to-text socket, so keep yielding until that event lands.
      // Under full duplex a stable partial is sent speculatively while the
      // call still hears the person; its reply is held until speech-end
      // confirms the endpoint, so keep the mic fed until that happens too.
      let extra = 0;
      const heardBy = performance.now() + 4_000;
      while ((!active.utteranceId || live.current.phase === "hearing") && performance.now() < heardBy) {
        if (extra < 80) {
          live.frame(quietFrame());
          await live.settled();
          extra += 1;
        }
        await sleep(20);
      }
      if (!active.utteranceId) {
        throw new Error(`no utterance for ${scenario.id} after ${extra} quiet frames (phase=${live.current.phase})`);
      }
      const turn = active;
      const waitUntil = performance.now() + (turn.cancelled ? 1_000 : 15_000);
      let idleSince = 0;
      while (!turn.finished && performance.now() < waitUntil) {
        if (turn.audio === undefined && typeof turn.tts === "number" && typeof turn.sentence === "number") {
          turn.audio = turn.tts + SYNTHETIC_VOICE_DELAYS.audioStartDelayMs;
        }
        if (typeof reply.firstToken === "number" && turn.llm === undefined) turn.llm = reply.firstToken;
        if (typeof reply.ttsFirstByte === "number" && turn.tts === undefined) turn.tts = reply.ttsFirstByte;
        const ready = turn.turnCompleted && turn.llm !== undefined && turn.tts !== undefined && turn.audio !== undefined && !player.busy && !live.current.botBusy;
        if (ready) {
          if (idleSince === 0) idleSince = performance.now();
          if (performance.now() - idleSince >= 150) finishComplete();
        } else {
          idleSince = 0;
        }
        if (!turn.finished) await sleep(15);
      }
      if (!turn.finished) {
        throw new Error(
          `${scenario.id} did not finish (completed=${turn.turnCompleted} llm=${turn.llm !== undefined} tts=${turn.tts !== undefined} audio=${turn.audio !== undefined} busy=${live.current.botBusy} player=${player.busy})`,
        );
      }
      const idleDeadline = performance.now() + 4_000;
      while ((live.current.botBusy || player.busy) && performance.now() < idleDeadline) await sleep(20);
      if (live.current.botBusy) live.setBotBusy(false);
      await player.cancel();
      await pump(live, Array.from({ length: 6 }, () => quietFrame()));
      log(`${scenario.id} ${scenario.expected} ${Math.round(performance.now() - started)}ms`);
    }

    const providerAudit = real
      ? { paths: [], unexpectedPaths: [], pass: true }
      : auditPaths((xai?.requests ?? []).map((request) => request.path));
    return compileVoiceBench({
      run: {
        runId: randomUUID(),
        commitSha: commitSha(),
        mode: options.profile,
        engine: real ? "grok" : "claude",
        sttProvider: real ? "xai" : "fake-xai",
        ttsProvider: real ? "xai" : "fake-xai",
        fixture: {
          scriptRevision: VOICE_ACCEPTANCE_SCRIPT_REVISION,
          ...(real ? {} : SYNTHETIC_VOICE_DELAYS),
        },
      },
      utterances,
      events: ledger.events(),
      scenarios: scenarioGates(VOICE_ACCEPTANCE_SCRIPT, utterances, ledger.events(), toolStarts),
      providerAudit,
      ...(options.reference ? { reference: options.reference } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redact(`${message}\n${serverLog.slice(-1500)}`, secrets));
  } finally {
    eventsAbort.abort();
    call?.end();
    // The server keeps writing its data dir while it shuts down (store,
    // provider children). Wait for it to exit before removing the dir, or
    // rmSync races it and fails with ENOTEMPTY.
    await stopChild(child);
    await xai?.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
