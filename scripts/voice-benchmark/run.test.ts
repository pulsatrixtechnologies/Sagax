import { expect, it } from "vitest";

import { voiceBenchMaxMs } from "./model.ts";
import { runVoiceBenchmark } from "./run.ts";

it("runs the synthetic 32-turn acceptance under the latency gates", async () => {
  const report = await runVoiceBenchmark({ profile: "synthetic" });
  expect(report.turns).toHaveLength(32);
  const slowest = [...report.turns]
    .filter((turn) => typeof turn.stages.total === "number")
    .sort((left, right) => (right.stages.total ?? 0) - (left.stages.total ?? 0))[0];
  expect(
    report.passed,
    JSON.stringify({
      gates: report.gates,
      scenarios: report.scenarios,
      overlaps: report.overlaps,
      unexpectedPaths: report.providerAudit.unexpectedPaths,
      slowest: slowest
        ? { scenarioId: slowest.scenarioId, totalMs: slowest.stages.total, stages: slowest.stages }
        : null,
    }),
  ).toBe(true);
  expect(report.scenarios).toMatchObject({
    interruptions: { pass: true },
    correction: { pass: true },
    concurrentTopics: { pass: true },
    tools: { pass: true },
  });
  expect(report.overlaps).toEqual([]);
  expect(report.providerAudit.unexpectedPaths).toEqual([]);
  expect(report.gates.p50.observedMs).toBeLessThanOrEqual(800);
  expect(report.gates.max.thresholdMs).toBe(voiceBenchMaxMs());
  expect(report.gates.max.observedMs).toBeLessThanOrEqual(voiceBenchMaxMs());
}, 180_000);
