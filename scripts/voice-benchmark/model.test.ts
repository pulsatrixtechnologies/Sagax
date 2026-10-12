import { describe, expect, it } from "vitest";
import {
  compileVoiceBench,
  renderVoiceBenchMarkdown,
  VoiceBenchLedger,
  type CompileVoiceBenchInput,
  type VoiceBenchEvent,
  type VoiceBenchMark,
} from "./model.js";

function mark(
  utteranceId: string,
  mark: VoiceBenchMark,
  atMs: number,
  answerId?: string,
): VoiceBenchEvent {
  return { kind: "mark", utteranceId, mark, atMs, ...(answerId ? { answerId } : {}) };
}

function fixture(options: {
  totals: readonly number[];
  overlap?: boolean;
  warmupTotal?: number;
}): CompileVoiceBenchInput {
  const measuredUtterances = options.totals.map((_, index) => ({
    utteranceId: `u${index + 1}`,
    turnId: `turn-${index + 1}`,
    scenarioId: "ordinary",
    topicId: `topic-${index + 1}`,
    language: index % 2 === 0 ? "en" as const : "fr-CA" as const,
    expected: "complete" as const,
  }));
  const utterances = [
    {
      utteranceId: "warmup",
      turnId: "turn-warmup",
      scenarioId: "warmup",
      topicId: "topic-warmup",
      language: "en" as const,
      warmup: true,
      expected: "complete" as const,
    },
    ...measuredUtterances,
  ];
  const totals = [options.warmupTotal ?? 400, ...options.totals];
  const events = utterances.flatMap((utterance, index) => {
    const speechEnd = 1_000 + index * 5_000;
    const audioStart = speechEnd + totals[index]!;
    const audioEnd = options.overlap && utterance.utteranceId === "u1"
      ? 11_500
      : audioStart + 100;
    const answerId = utterance.utteranceId === "warmup"
      ? "answer-warmup"
      : `answer-${index}`;
    return [
      mark(utterance.utteranceId, "speech-end", speechEnd),
      mark(utterance.utteranceId, "endpoint", speechEnd + 100),
      mark(utterance.utteranceId, "stt-final", speechEnd + 200),
      mark(utterance.utteranceId, "llm-first-token", speechEnd + 250, answerId),
      mark(utterance.utteranceId, "tts-first-byte", speechEnd + 300, answerId),
      mark(utterance.utteranceId, "audio-start", audioStart, answerId),
      mark(utterance.utteranceId, "audio-end", audioEnd, answerId),
      {
        kind: "state" as const,
        utteranceId: utterance.utteranceId,
        atMs: audioEnd,
        state: "completed" as const,
      },
    ];
  });
  return {
    run: {
      runId: "fixture-run",
      commitSha: "deadbeef",
      mode: "synthetic",
      engine: "fake-engine",
      sttProvider: "fake-xai",
      ttsProvider: "fake-xai",
      fixture: {
        scriptRevision: "voice-benchmark-v1",
        endpointDelayMs: 100,
        sttFinalDelayMs: 200,
        llmFirstTokenDelayMs: 250,
        ttsFirstByteDelayMs: 300,
        audioStartDelayMs: 400,
      },
    },
    utterances,
    events,
    expectedTurnCount: utterances.length,
    scenarios: {
      interruptions: { pass: true, observed: 1, required: 1 },
      correction: { pass: true, observed: 1, required: 1 },
      concurrentTopics: { pass: true, observed: 1, required: 1 },
      tools: { pass: true, observed: 1, required: 1 },
    },
    providerAudit: {
      paths: ["/v1/audio/transcriptions", "/v1/tts"],
      pass: true,
    },
  };
}

describe("VoiceBenchLedger", () => {
  it("does not let a later turn replace another utterance's first audio", () => {
    const ledger = new VoiceBenchLedger();
    ledger.record(mark("u1", "speech-end", 100));
    ledger.record(mark("u1", "audio-start", 700, "answer-1"));
    expect(() => ledger.record(mark("u1", "audio-start", 900, "answer-1")))
      .toThrow(/conflicting duplicate/);
    expect(ledger.events()).toContainEqual(mark("u1", "audio-start", 700, "answer-1"));
  });

  it("does not let one answer be attributed to two utterances", () => {
    const ledger = new VoiceBenchLedger();
    ledger.record({
      kind: "mark",
      utteranceId: "u1",
      mark: "llm-first-token",
      atMs: 300,
      answerId: "answer-1",
    });

    expect(() => ledger.record({
      kind: "mark",
      utteranceId: "u2",
      mark: "tts-first-byte",
      atMs: 400,
      answerId: "answer-1",
    })).toThrow(/answer answer-1.*attributed to u1/);
  });

  it("returns event snapshots that cannot mutate the ledger", () => {
    const ledger = new VoiceBenchLedger();
    const event = mark("u1", "speech-end", 100);
    ledger.record(event);
    event.atMs = 200;
    const snapshot = ledger.events()[0] as VoiceBenchEvent;
    snapshot.atMs = 300;

    expect(ledger.events()).toEqual([mark("u1", "speech-end", 100)]);
  });
});

describe("compileVoiceBench", () => {
  it("defaults the acceptance turn-count gate to exactly 32 turns", () => {
    const input = fixture({ totals: [400, 800] });
    delete input.expectedTurnCount;

    expect(compileVoiceBench(input).gates.turnCount).toEqual({
      pass: false,
      expected: 32,
      observed: 3,
    });
  });

  it("uses nearest-rank statistics for the timing summary", () => {
    expect(compileVoiceBench(fixture({ totals: [400, 800, 900] })).summary.total)
      .toEqual({ p50: 800, p90: 900, max: 900 });
  });

  it("passes inclusive latency boundaries and rejects a turn above the maximum", () => {
    expect(compileVoiceBench(fixture({ totals: [400, 800] })).passed).toBe(true);
    expect(compileVoiceBench(fixture({ totals: [800, 2_500] })).passed).toBe(true);
    expect(compileVoiceBench(fixture({ totals: [400, 2_501] })).passed).toBe(false);
  });

  it("uses warm turns after one explicit warm-up for the p50 gate", () => {
    const input = fixture({ totals: [700, 900], warmupTotal: 2_000 });

    const report = compileVoiceBench(input);
    expect(report.gates.p50).toEqual({
      pass: true,
      thresholdMs: 800,
      observedMs: 700,
    });
    expect(report.gates.max.observedMs).toBe(2_000);
  });

  it("requires exactly one explicit warm-up utterance", () => {
    const withoutWarmup = fixture({ totals: [400, 800] });
    const withTwoWarmups = fixture({ totals: [400, 800] });
    withoutWarmup.utterances = withoutWarmup.utterances.map((utterance) => ({
      ...utterance,
      warmup: false,
    }));
    withTwoWarmups.utterances = withTwoWarmups.utterances.map((utterance) => ({
      ...utterance,
      warmup: utterance.utteranceId === "warmup" || utterance.utteranceId === "u1",
    }));

    expect(() => compileVoiceBench(withoutWarmup)).toThrow(/exactly one.*warm-up.*found 0/);
    expect(() => compileVoiceBench(withTwoWarmups)).toThrow(/exactly one.*warm-up.*found 2/);
  });

  it("fails closed when mandatory scenario evidence or provider audit is absent", () => {
    const missingScenario = fixture({ totals: [400] });
    missingScenario.scenarios = {
      interruptions: { pass: true, observed: 1, required: 1 },
      correction: { pass: true, observed: 1, required: 1 },
      concurrentTopics: { pass: true, observed: 1, required: 1 },
    };
    const missingAudit = fixture({ totals: [400] });
    delete missingAudit.providerAudit;
    const failingScenario = fixture({ totals: [400] });
    failingScenario.scenarios = {
      ...failingScenario.scenarios,
      correction: { pass: false, observed: 0, required: 1 },
    };
    const failingAudit = fixture({ totals: [400] });
    failingAudit.providerAudit = { paths: ["/v1/responses"], pass: false };

    const scenarioReport = compileVoiceBench(missingScenario);
    expect(scenarioReport.passed).toBe(false);
    expect(scenarioReport.scenarios.tools).toEqual({
      pass: false,
      observed: 0,
      required: 1,
    });
    const auditReport = compileVoiceBench(missingAudit);
    expect(auditReport.passed).toBe(false);
    expect(auditReport.providerAudit).toEqual({ paths: [], pass: false });
    expect(compileVoiceBench(failingScenario).passed).toBe(false);
    expect(compileVoiceBench(failingAudit).passed).toBe(false);
  });

  it("rejects non-finite or negative fixed fixture delays", () => {
    const negative = fixture({ totals: [400] });
    negative.run.fixture = { ...negative.run.fixture, endpointDelayMs: -1 };
    const nonFinite = fixture({ totals: [400] });
    nonFinite.run.fixture = {
      ...nonFinite.run.fixture,
      ttsFirstByteDelayMs: Number.NaN,
    };

    expect(() => compileVoiceBench(negative))
      .toThrow(/fixture delay endpointDelayMs.*finite nonnegative/);
    expect(() => compileVoiceBench(nonFinite))
      .toThrow(/fixture delay ttsFirstByteDelayMs.*finite nonnegative/);
  });

  it("copies only allowlisted fixture timing metadata into the report", () => {
    const input = fixture({ totals: [400] });
    input.run.fixture = {
      ...input.run.fixture,
      apiKey: "must-not-enter-report",
    } as CompileVoiceBenchInput["run"]["fixture"];

    expect(compileVoiceBench(input).run.fixture).toEqual({
      scriptRevision: "voice-benchmark-v1",
      endpointDelayMs: 100,
      sttFinalDelayMs: 200,
      llmFirstTokenDelayMs: 250,
      ttsFirstByteDelayMs: 300,
      audioStartDelayMs: 400,
    });
  });

  it("rejects a complete turn with a missing required mark", () => {
    const input = fixture({ totals: [400] });
    input.events = input.events.filter((event) =>
      event.utteranceId !== "u1"
      || event.kind !== "mark"
      || event.mark !== "tts-first-byte");

    expect(() => compileVoiceBench(input))
      .toThrow(/missing required mark tts-first-byte.*u1/);
  });

  it("rejects an event attributed to an unknown utterance", () => {
    const input = fixture({ totals: [400] });
    input.events = [...input.events, mark("unknown", "audio-start", 2_000, "answer-x")];

    expect(() => compileVoiceBench(input)).toThrow(/unknown utterance unknown/);
  });

  it("rejects conflicting duplicate marks in compiler input", () => {
    const input = fixture({ totals: [400] });
    input.events = [...input.events, mark("u1", "audio-start", 6_450, "answer-1")];

    expect(() => compileVoiceBench(input)).toThrow(/conflicting duplicate.*audio-start.*u1/);
  });

  it("rejects an interruption target that is not in the run", () => {
    const input = fixture({ totals: [400] });
    input.events = [...input.events, {
      kind: "interruption",
      utteranceId: "u1",
      targetUtteranceId: "unknown",
      atMs: 6_200,
    }];

    expect(() => compileVoiceBench(input)).toThrow(/unknown interruption target unknown/);
  });

  it("rejects TTS bytes attributed before the accepted answer's first token", () => {
    const input = fixture({ totals: [400] });
    input.events = input.events.map((event) =>
      event.kind === "mark"
      && event.utteranceId === "u1"
      && event.mark === "tts-first-byte"
        ? mark("u1", "tts-first-byte", 6_249, "answer-1")
        : event);

    expect(() => compileVoiceBench(input))
      .toThrow(/tts-first-byte.*after llm-first-token.*u1/);
  });

  it("requires a non-empty answer ID on every accepted-answer mark", () => {
    for (const acceptedMark of [
      "llm-first-token",
      "tts-first-byte",
      "audio-start",
      "audio-end",
    ] as const) {
      const input = fixture({ totals: [400] });
      input.events = input.events.map((event) =>
        event.kind === "mark"
        && event.utteranceId === "u1"
        && event.mark === acceptedMark
          ? { ...event, answerId: " " }
          : event);

      expect(() => compileVoiceBench(input))
        .toThrow(new RegExp(`non-empty answerId.*${acceptedMark}.*u1`));
    }
  });

  it("rejects TTS and audio marks attributed to a different answer revision", () => {
    const input = fixture({ totals: [400] });
    input.events = input.events.map((event) => {
      if (event.kind !== "mark" || event.utteranceId !== "u1") return event;
      if (event.mark === "llm-first-token") return { ...event, answerId: "answer-1" };
      if (["tts-first-byte", "audio-start", "audio-end"].includes(event.mark)) {
        return { ...event, answerId: "answer-2" };
      }
      return event;
    });

    expect(() => compileVoiceBench(input))
      .toThrow(/answer revision attribution.*u1/);
  });

  it("rejects audio output attributed before the answer has TTS bytes", () => {
    const input = fixture({ totals: [299] });

    expect(() => compileVoiceBench(input))
      .toThrow(/audio-start.*after tts-first-byte.*u1/);
  });

  it("rejects an audio interval that ends before it starts", () => {
    const input = fixture({ totals: [400] });
    input.events = input.events.map((event) =>
      event.kind === "mark"
      && event.utteranceId === "u1"
      && event.mark === "audio-end"
        ? mark("u1", "audio-end", 6_399, "answer-1")
        : event);

    expect(() => compileVoiceBench(input))
      .toThrow(/audio-end.*after audio-start.*u1/);
  });

  it("keeps speculative negative timings raw and records their lead", () => {
    const input = fixture({ totals: [400] });
    input.events = input.events.map((event) =>
      event.kind === "mark"
      && event.utteranceId === "u1"
      && event.mark === "endpoint"
        ? mark("u1", "endpoint", 5_900)
        : event);

    const report = compileVoiceBench(input);
    const turn = report.turns.find((candidate) => candidate.utteranceId === "u1")!;
    expect(turn.stages.endpoint).toBe(-100);
    expect(turn.transitions[0]).toEqual({
      from: "speech-end",
      to: "endpoint",
      deltaMs: -100,
      leadMs: 100,
    });
  });

  it("rejects an answer recorded as both cancelled and completed", () => {
    const input = fixture({ totals: [400] });
    input.events = [
      ...input.events,
      {
        kind: "cancellation",
        utteranceId: "u1",
        targetUtteranceId: "u1",
        atMs: 6_350,
      },
    ];

    expect(() => compileVoiceBench(input)).toThrow(/cancelled answer u1.*completed/);
  });

  it("keeps a cancelled partial answer out of latency summaries", () => {
    const input = fixture({ totals: [700, 400] });
    input.utterances = input.utterances.map((utterance) => ({
      ...utterance,
      expected: utterance.utteranceId === "u1" ? "cancelled" : "complete",
    }));
    input.events = [
      ...input.events.filter((event) =>
        event.utteranceId !== "u1"
        || (event.kind === "mark"
          && ["speech-end", "endpoint", "stt-final"].includes(event.mark))),
      {
        kind: "cancellation",
        utteranceId: "u2",
        targetUtteranceId: "u1",
        atMs: 11_100,
      },
    ];

    const report = compileVoiceBench(input);
    const turn = report.turns.find((candidate) => candidate.utteranceId === "u1")!;
    expect(turn).toMatchObject({
      utteranceId: "u1",
      cancelled: true,
      stages: {
        endpoint: 100,
        sttFinal: 200,
      },
    });
    expect(turn.spokenInterval).toBeUndefined();
    expect(report.summary.total).toEqual({ p50: 400, p90: 400, max: 400 });
  });

  it("fails the zero-overlap gate when spoken answer intervals intersect", () => {
    const report = compileVoiceBench(fixture({ totals: [400, 400], overlap: true }));

    expect(report.gates.overlap.pass).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.overlaps).toEqual([{
      firstUtteranceId: "u1",
      secondUtteranceId: "u2",
      startMs: 11_400,
      endMs: 11_500,
      durationMs: 100,
    }]);
  });

  it("derives optional reference numbers only from supplied sidecar markers", () => {
    const input = fixture({ totals: [400] });
    input.reference = {
      status: "measured",
      recordingPath: "reference.wav",
      speechEndMs: 100,
      firstAudioMs: 750,
    };

    expect(compileVoiceBench(input).reference).toEqual({
      status: "measured",
      recordingPath: "reference.wav",
      speechEndMs: 100,
      firstAudioMs: 750,
      latencyMs: 650,
      sagaxP50DeltaMs: -250,
    });
  });

  it("rejects invalid reference sidecar markers", () => {
    const input = fixture({ totals: [400] });
    input.reference = {
      status: "measured",
      recordingPath: "reference.wav",
      speechEndMs: 750,
      firstAudioMs: 100,
    };

    expect(() => compileVoiceBench(input)).toThrow(/reference first audio.*after speech end/);
  });
});

describe("renderVoiceBenchMarkdown", () => {
  it("derives the human report from compiled statistics and keeps a missing reference numeric-free", () => {
    const report = compileVoiceBench(fixture({ totals: [400, 800, 900] }));
    const markdown = renderVoiceBenchMarkdown(report);

    expect(markdown).toContain("| Total | 800 | 900 | 900 |");
    expect(markdown).toContain("Reference: not provided.");
    expect(markdown).not.toMatch(/Reference:.*\d+\s*ms/);
  });
});
