export type VoiceBenchMark =
  | "speech-end"
  | "endpoint"
  | "stt-final"
  | "llm-first-token"
  | "tts-first-byte"
  | "audio-start"
  | "audio-end";

export type VoiceBenchLanguage = "en" | "fr-CA";
export type VoiceBenchMode = "synthetic" | "real";
export type VoiceBenchTurnState = "listening" | "thinking" | "speaking" | "completed";

export interface VoiceBenchMarkEvent {
  kind: "mark";
  utteranceId: string;
  mark: VoiceBenchMark;
  atMs: number;
  answerId?: string;
}

export interface VoiceBenchTranscriptEvent {
  kind: "transcript";
  utteranceId: string;
  atMs: number;
  language: VoiceBenchLanguage;
  text: string;
  accepted: boolean;
}

export interface VoiceBenchStateEvent {
  kind: "state";
  utteranceId: string;
  atMs: number;
  state: VoiceBenchTurnState;
}

export interface VoiceBenchToolEvent {
  kind: "tool-start" | "tool-result";
  utteranceId: string;
  atMs: number;
  toolCallId: string;
}

export interface VoiceBenchInterruptionEvent {
  kind: "interruption";
  utteranceId: string;
  atMs: number;
  targetUtteranceId: string;
}

export interface VoiceBenchCancellationEvent {
  kind: "cancellation";
  utteranceId: string;
  atMs: number;
  targetUtteranceId: string;
}

export type VoiceBenchEvent =
  | VoiceBenchMarkEvent
  | VoiceBenchTranscriptEvent
  | VoiceBenchStateEvent
  | VoiceBenchToolEvent
  | VoiceBenchInterruptionEvent
  | VoiceBenchCancellationEvent;

export interface VoiceBenchUtterance {
  utteranceId: string;
  turnId: string;
  scenarioId: string;
  topicId: string;
  language: VoiceBenchLanguage;
  warmup?: boolean;
  expected: "complete" | "cancelled";
}

export interface VoiceBenchFixtureTiming {
  readonly scriptRevision: string;
  readonly endpointDelayMs?: number;
  readonly sttFinalDelayMs?: number;
  readonly llmFirstTokenDelayMs?: number;
  readonly ttsFirstByteDelayMs?: number;
  readonly audioStartDelayMs?: number;
}

export interface VoiceBenchRun {
  runId: string;
  commitSha: string;
  mode: VoiceBenchMode;
  engine: string;
  sttProvider: string;
  ttsProvider: string;
  fixture: VoiceBenchFixtureTiming;
}

export interface VoiceBenchProviderAudit {
  paths: readonly string[];
  pass: boolean;
}

export interface VoiceBenchScenarioGate {
  pass: boolean;
  observed: number;
  required: number;
}

export interface VoiceBenchReferenceMeasured {
  status: "measured";
  recordingPath: string;
  speechEndMs: number;
  firstAudioMs: number;
  latencyMs: number;
  sagaxP50DeltaMs: number;
}

export interface VoiceBenchReferenceNotProvided {
  status: "not-provided";
}

export type VoiceBenchReference = VoiceBenchReferenceMeasured | VoiceBenchReferenceNotProvided;

export type VoiceBenchReferenceInput =
  | VoiceBenchReferenceNotProvided
  | Omit<VoiceBenchReferenceMeasured, "latencyMs" | "sagaxP50DeltaMs">;

export interface CompileVoiceBenchInput {
  run: VoiceBenchRun;
  utterances: readonly VoiceBenchUtterance[];
  events: readonly VoiceBenchEvent[];
  expectedTurnCount?: number;
  scenarios?: Readonly<Record<string, VoiceBenchScenarioGate>>;
  providerAudit?: VoiceBenchProviderAudit;
  reference?: VoiceBenchReferenceInput;
}

export interface VoiceBenchStatistics {
  p50: number;
  p90: number;
  max: number;
}

export type VoiceBenchSummaryKey =
  | "endpoint"
  | "sttFinal"
  | "llmFirstToken"
  | "ttsFirstByte"
  | "firstAudioOut"
  | "total";

const SUMMARY_KEYS = [
  "endpoint",
  "sttFinal",
  "llmFirstToken",
  "ttsFirstByte",
  "firstAudioOut",
  "total",
] as const satisfies readonly VoiceBenchSummaryKey[];

export type VoiceBenchSummary = Record<VoiceBenchSummaryKey, VoiceBenchStatistics>;

export interface VoiceBenchTransition {
  from: VoiceBenchMark;
  to: VoiceBenchMark;
  deltaMs: number;
  leadMs: number;
}

export interface VoiceBenchSpokenInterval {
  utteranceId: string;
  startMs: number;
  endMs: number;
}

export interface VoiceBenchOverlap {
  firstUtteranceId: string;
  secondUtteranceId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface VoiceBenchTurnRow {
  utteranceId: string;
  turnId: string;
  scenarioId: string;
  topicId: string;
  language: VoiceBenchLanguage;
  warmup: boolean;
  cancelled: boolean;
  timestamps: Readonly<Partial<Record<VoiceBenchMark, number>>>;
  stages: Readonly<Partial<Record<VoiceBenchSummaryKey, number>>>;
  transitions: readonly VoiceBenchTransition[];
  spokenInterval?: VoiceBenchSpokenInterval;
}

export interface VoiceBenchThresholdGate {
  pass: boolean;
  thresholdMs: number;
  observedMs: number;
}

export interface VoiceBenchOverlapGate {
  pass: boolean;
  threshold: 0;
  observed: number;
}

export interface VoiceBenchCountGate {
  pass: boolean;
  expected: number;
  observed: number;
}

export interface VoiceBenchGates {
  p50: VoiceBenchThresholdGate;
  max: VoiceBenchThresholdGate;
  overlap: VoiceBenchOverlapGate;
  turnCount: VoiceBenchCountGate;
}

export interface VoiceBenchReport {
  version: 1;
  run: VoiceBenchRun;
  events: readonly VoiceBenchEvent[];
  turns: readonly VoiceBenchTurnRow[];
  summary: VoiceBenchSummary;
  intervals: readonly VoiceBenchSpokenInterval[];
  overlaps: readonly VoiceBenchOverlap[];
  gates: VoiceBenchGates;
  scenarios: Readonly<Record<string, VoiceBenchScenarioGate>>;
  providerAudit: VoiceBenchProviderAudit;
  reference: VoiceBenchReference;
  passed: boolean;
}

export const VOICE_BENCH_THRESHOLDS = {
  p50Ms: 800,
  maxMs: 2500,
} as const;

export const VOICE_BENCH_TURN_COUNT = 32;

export const VOICE_BENCH_MANDATORY_SCENARIOS = [
  "interruptions",
  "correction",
  "concurrentTopics",
  "tools",
] as const;

const ACCEPTED_ANSWER_MARKS = new Set<VoiceBenchMark>([
  "llm-first-token",
  "tts-first-byte",
  "audio-start",
  "audio-end",
]);

const FIXTURE_DELAY_KEYS = [
  "endpointDelayMs",
  "sttFinalDelayMs",
  "llmFirstTokenDelayMs",
  "ttsFirstByteDelayMs",
  "audioStartDelayMs",
] as const satisfies readonly (keyof VoiceBenchFixtureTiming)[];

function eventCopy<T extends VoiceBenchEvent>(event: T): T {
  return { ...event };
}

function sameEvent(left: VoiceBenchEvent, right: VoiceBenchEvent): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value]) => Object.hasOwn(right, key)
      && right[key as keyof VoiceBenchEvent] === value);
}

export class VoiceBenchLedger {
  #events: VoiceBenchEvent[] = [];
  #marks = new Map<string, VoiceBenchMarkEvent>();
  #answers = new Map<string, string>();

  record(event: VoiceBenchEvent): void {
    if (!event.utteranceId || !Number.isFinite(event.atMs)) {
      throw new Error("voice benchmark event requires an utteranceId and finite atMs");
    }

    if (event.kind === "mark") {
      if (ACCEPTED_ANSWER_MARKS.has(event.mark) && !event.answerId?.trim()) {
        throw new Error(
          `non-empty answerId required for ${event.mark} on ${event.utteranceId}`,
        );
      }
      const key = `${event.utteranceId}\0${event.mark}`;
      const existing = this.#marks.get(key);
      if (existing) {
        if (!sameEvent(existing, event)) {
          throw new Error(`conflicting duplicate mark ${event.mark} for ${event.utteranceId}`);
        }
        return;
      }
      if (event.answerId) {
        const attributedTo = this.#answers.get(event.answerId);
        if (attributedTo && attributedTo !== event.utteranceId) {
          throw new Error(`answer ${event.answerId} is already attributed to ${attributedTo}`);
        }
        this.#answers.set(event.answerId, event.utteranceId);
      }
      const copy = eventCopy(event);
      this.#marks.set(key, copy);
      this.#events.push(copy);
      return;
    }

    this.#events.push(eventCopy(event));
  }

  events(): readonly VoiceBenchEvent[] {
    return this.#events.map((event) => eventCopy(event));
  }
}

const MARK_ORDER: readonly VoiceBenchMark[] = [
  "speech-end",
  "endpoint",
  "stt-final",
  "llm-first-token",
  "tts-first-byte",
  "audio-start",
  "audio-end",
];

function nearestRank(values: readonly number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(percentile * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

function markTimes(events: readonly VoiceBenchEvent[], utteranceId: string): Partial<Record<VoiceBenchMark, number>> {
  const timestamps: Partial<Record<VoiceBenchMark, number>> = {};
  for (const event of events) {
    if (event.kind === "mark" && event.utteranceId === utteranceId) {
      timestamps[event.mark] = event.atMs;
    }
  }
  return timestamps;
}

function stageValues(
  timestamps: Partial<Record<VoiceBenchMark, number>>,
): Partial<Record<VoiceBenchSummaryKey, number>> {
  const speechEnd = timestamps["speech-end"];
  if (speechEnd === undefined) return {};
  const stages: Partial<Record<VoiceBenchSummaryKey, number>> = {};
  const assign = (stage: VoiceBenchSummaryKey, mark: VoiceBenchMark): void => {
    const atMs = timestamps[mark];
    if (atMs !== undefined) stages[stage] = atMs - speechEnd;
  };
  assign("endpoint", "endpoint");
  assign("sttFinal", "stt-final");
  assign("llmFirstToken", "llm-first-token");
  assign("ttsFirstByte", "tts-first-byte");
  assign("firstAudioOut", "audio-start");
  assign("total", "audio-start");
  return stages;
}

export function compileVoiceBench(input: CompileVoiceBenchInput): VoiceBenchReport {
  if (!input.run.fixture.scriptRevision.trim()) {
    throw new Error("fixture scriptRevision must be a non-empty string");
  }
  for (const key of FIXTURE_DELAY_KEYS) {
    const delay = input.run.fixture[key];
    if (delay !== undefined && (!Number.isFinite(delay) || delay < 0)) {
      throw new Error(`fixture delay ${key} must be finite nonnegative milliseconds`);
    }
  }
  const fixture = Object.fromEntries([
    ["scriptRevision", input.run.fixture.scriptRevision],
    ...FIXTURE_DELAY_KEYS.flatMap((key) => {
      const value = input.run.fixture[key];
      return value === undefined ? [] : [[key, value] as const];
    }),
  ]) as unknown as VoiceBenchFixtureTiming;
  const run: VoiceBenchRun = {
    runId: input.run.runId,
    commitSha: input.run.commitSha,
    mode: input.run.mode,
    engine: input.run.engine,
    sttProvider: input.run.sttProvider,
    ttsProvider: input.run.ttsProvider,
    fixture,
  };
  const ledger = new VoiceBenchLedger();
  for (const event of input.events) ledger.record(event);
  const events = ledger.events();
  const knownUtterances = new Set(input.utterances.map((utterance) => utterance.utteranceId));
  if (knownUtterances.size !== input.utterances.length) {
    throw new Error("voice benchmark utterance IDs must be unique");
  }
  const warmupCount = input.utterances.filter((utterance) => utterance.warmup === true).length;
  if (warmupCount !== 1) {
    throw new Error(`voice benchmark requires exactly one explicit warm-up; found ${warmupCount}`);
  }
  for (const event of events) {
    if (!knownUtterances.has(event.utteranceId)) {
      throw new Error(`event references unknown utterance ${event.utteranceId}`);
    }
    if (
      (event.kind === "interruption" || event.kind === "cancellation")
      && !knownUtterances.has(event.targetUtteranceId)
    ) {
      throw new Error(`unknown ${event.kind} target ${event.targetUtteranceId}`);
    }
  }
  const turns = input.utterances.map((utterance): VoiceBenchTurnRow => {
    const timestamps = markTimes(events, utterance.utteranceId);
    const answerIds = new Set(
      events.flatMap((event) =>
        event.kind === "mark"
        && event.utteranceId === utterance.utteranceId
        && ["llm-first-token", "tts-first-byte", "audio-start", "audio-end"].includes(event.mark)
        && event.answerId
          ? [event.answerId]
          : []),
    );
    if (answerIds.size > 1) {
      throw new Error(`answer revision attribution changed for ${utterance.utteranceId}`);
    }
    const cancelled = events.some((event) =>
      event.kind === "cancellation" && event.targetUtteranceId === utterance.utteranceId);
    const completed = events.some((event) =>
      event.kind === "state"
      && event.utteranceId === utterance.utteranceId
      && event.state === "completed");
    if (cancelled && completed) {
      throw new Error(`cancelled answer ${utterance.utteranceId} was also completed`);
    }
    if (utterance.expected === "cancelled" && !cancelled) {
      throw new Error(`expected cancellation for ${utterance.utteranceId} was not recorded`);
    }
    if (utterance.expected === "cancelled" && timestamps["speech-end"] === undefined) {
      throw new Error(`missing required mark speech-end for ${utterance.utteranceId}`);
    }
    if (utterance.expected === "complete") {
      if (cancelled) {
        throw new Error(`cancelled answer ${utterance.utteranceId} was expected to complete`);
      }
      for (const required of MARK_ORDER) {
        if (timestamps[required] === undefined) {
          throw new Error(`missing required mark ${required} for ${utterance.utteranceId}`);
        }
      }
    }
    const firstToken = timestamps["llm-first-token"];
    const firstTtsByte = timestamps["tts-first-byte"];
    const audioStart = timestamps["audio-start"];
    const audioEnd = timestamps["audio-end"];
    if (firstToken !== undefined && firstTtsByte !== undefined && firstTtsByte <= firstToken) {
      throw new Error(
        `tts-first-byte must be after llm-first-token for ${utterance.utteranceId}`,
      );
    }
    if (firstTtsByte !== undefined && audioStart !== undefined && audioStart <= firstTtsByte) {
      throw new Error(
        `audio-start must be after tts-first-byte for ${utterance.utteranceId}`,
      );
    }
    if (audioStart !== undefined && audioEnd === undefined) {
      throw new Error(`missing required mark audio-end for ${utterance.utteranceId}`);
    }
    if (audioStart !== undefined && audioEnd !== undefined && audioEnd < audioStart) {
      throw new Error(
        `audio-end must be at or after audio-start for ${utterance.utteranceId}`,
      );
    }
    const transitions = MARK_ORDER.slice(1).flatMap((to, index): VoiceBenchTransition[] => {
      const from = MARK_ORDER[index]!;
      const fromMs = timestamps[from];
      const toMs = timestamps[to];
      if (fromMs === undefined || toMs === undefined) return [];
      const deltaMs = toMs - fromMs;
      return [{ from, to, deltaMs, leadMs: Math.max(0, -deltaMs) }];
    });
    return {
      utteranceId: utterance.utteranceId,
      turnId: utterance.turnId,
      scenarioId: utterance.scenarioId,
      topicId: utterance.topicId,
      language: utterance.language,
      warmup: utterance.warmup === true,
      cancelled,
      timestamps,
      stages: stageValues(timestamps),
      transitions,
      spokenInterval: audioStart !== undefined && audioEnd !== undefined
        ? { utteranceId: utterance.utteranceId, startMs: audioStart, endMs: audioEnd }
        : undefined,
    };
  });
  const measuredTurns = turns.filter((turn) =>
    SUMMARY_KEYS.every((stage) => turn.stages[stage] !== undefined));
  if (measuredTurns.length === 0) {
    throw new Error("voice benchmark has no complete measured turns");
  }
  const warmMeasuredTurns = measuredTurns.filter((turn) => !turn.warmup);
  if (warmMeasuredTurns.length === 0) {
    throw new Error("voice benchmark has no measured turn after warm-up");
  }
  const summary = Object.fromEntries(
    SUMMARY_KEYS.map((stage) => [
      stage,
      {
        p50: nearestRank(warmMeasuredTurns.map((turn) => turn.stages[stage]!), 0.5),
        p90: nearestRank(measuredTurns.map((turn) => turn.stages[stage]!), 0.9),
        max: Math.max(...measuredTurns.map((turn) => turn.stages[stage]!)),
      },
    ]),
  ) as unknown as VoiceBenchSummary;
  const intervals = turns.flatMap((turn) => turn.spokenInterval ? [turn.spokenInterval] : []);
  const overlaps: VoiceBenchOverlap[] = [];
  const sortedIntervals = [...intervals].sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs);
  for (let firstIndex = 0; firstIndex < sortedIntervals.length; firstIndex += 1) {
    const first = sortedIntervals[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < sortedIntervals.length; secondIndex += 1) {
      const second = sortedIntervals[secondIndex]!;
      if (second.startMs >= first.endMs) break;
      const endMs = Math.min(first.endMs, second.endMs);
      overlaps.push({
        firstUtteranceId: first.utteranceId,
        secondUtteranceId: second.utteranceId,
        startMs: second.startMs,
        endMs,
        durationMs: endMs - second.startMs,
      });
    }
  }
  const p50Observed = summary.total.p50;
  const maxObserved = summary.total.max;
  const expectedTurnCount = input.expectedTurnCount ?? VOICE_BENCH_TURN_COUNT;
  const p50Gate: VoiceBenchThresholdGate = {
    pass: p50Observed <= VOICE_BENCH_THRESHOLDS.p50Ms,
    thresholdMs: VOICE_BENCH_THRESHOLDS.p50Ms,
    observedMs: p50Observed,
  };
  const maxGate: VoiceBenchThresholdGate = {
    pass: maxObserved <= VOICE_BENCH_THRESHOLDS.maxMs,
    thresholdMs: VOICE_BENCH_THRESHOLDS.maxMs,
    observedMs: maxObserved,
  };
  const turnCountGate: VoiceBenchCountGate = {
    pass: turns.length === expectedTurnCount,
    expected: expectedTurnCount,
    observed: turns.length,
  };
  const overlapGate: VoiceBenchOverlapGate = {
    pass: overlaps.length === 0,
    threshold: 0,
    observed: overlaps.length,
  };
  const scenarios: Record<string, VoiceBenchScenarioGate> = { ...input.scenarios };
  for (const key of VOICE_BENCH_MANDATORY_SCENARIOS) {
    scenarios[key] ??= { pass: false, observed: 0, required: 1 };
  }
  const scenarioPass = Object.values(scenarios).every((scenario) => scenario.pass);
  const providerAudit = input.providerAudit ?? { paths: [], pass: false };
  const referenceInput = input.reference ?? { status: "not-provided" };
  if (
    referenceInput.status === "measured"
    && (
      !Number.isFinite(referenceInput.speechEndMs)
      || !Number.isFinite(referenceInput.firstAudioMs)
      || referenceInput.firstAudioMs <= referenceInput.speechEndMs
    )
  ) {
    throw new Error("reference first audio marker must be after speech end marker");
  }
  const reference: VoiceBenchReference = referenceInput.status === "not-provided"
    ? referenceInput
    : {
        ...referenceInput,
        latencyMs: referenceInput.firstAudioMs - referenceInput.speechEndMs,
        sagaxP50DeltaMs: p50Observed
          - (referenceInput.firstAudioMs - referenceInput.speechEndMs),
      };
  const passed = p50Gate.pass
    && maxGate.pass
    && overlapGate.pass
    && turnCountGate.pass
    && scenarioPass
    && providerAudit.pass;

  return {
    version: 1,
    run,
    events,
    turns,
    summary,
    intervals,
    overlaps,
    gates: {
      p50: p50Gate,
      max: maxGate,
      overlap: overlapGate,
      turnCount: turnCountGate,
    },
    scenarios,
    providerAudit,
    reference,
    passed,
  };
}

const SUMMARY_LABELS: Readonly<Record<VoiceBenchSummaryKey, string>> = {
  endpoint: "Endpoint",
  sttFinal: "STT final",
  llmFirstToken: "LLM first token",
  ttsFirstByte: "TTS first byte",
  firstAudioOut: "First audio out",
  total: "Total",
};

function markdownTiming(value: number): string {
  return String(Math.max(0, value));
}

function markdownPass(pass: boolean): string {
  return pass ? "PASS" : "FAIL";
}

export function renderVoiceBenchMarkdown(report: VoiceBenchReport): string {
  const lines = [
    "# Voice benchmark",
    "",
    `- Run: \`${report.run.runId}\``,
    `- Commit: \`${report.run.commitSha}\``,
    `- Profile: \`${report.run.mode}\``,
    `- Result: **${markdownPass(report.passed)}**`,
    "",
    "## Timing summary (ms)",
    "",
    "| Stage | p50 | p90 | max |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const stage of Object.keys(SUMMARY_LABELS) as VoiceBenchSummaryKey[]) {
    const summary = report.summary[stage];
    lines.push(
      `| ${SUMMARY_LABELS[stage]} | ${markdownTiming(summary.p50)} | ${markdownTiming(summary.p90)} | ${markdownTiming(summary.max)} |`,
    );
  }
  lines.push(
    "",
    "## Gates",
    "",
    `- p50 total ≤ ${report.gates.p50.thresholdMs} ms: **${markdownPass(report.gates.p50.pass)}** (${report.gates.p50.observedMs} ms)`,
    `- every turn ≤ ${report.gates.max.thresholdMs} ms: **${markdownPass(report.gates.max.pass)}** (${report.gates.max.observedMs} ms)`,
    `- spoken overlaps = ${report.gates.overlap.threshold}: **${markdownPass(report.gates.overlap.pass)}** (${report.gates.overlap.observed})`,
    `- turn count = ${report.gates.turnCount.expected}: **${markdownPass(report.gates.turnCount.pass)}** (${report.gates.turnCount.observed})`,
    "",
    "## Reference",
    "",
  );
  if (report.reference.status === "not-provided") {
    lines.push("Reference: not provided.");
  } else {
    lines.push(
      `Reference latency: ${report.reference.latencyMs} ms.`,
      `Sagax p50 delta: ${report.reference.sagaxP50DeltaMs} ms.`,
    );
  }
  return `${lines.join("\n")}\n`;
}
