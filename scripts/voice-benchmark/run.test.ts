import { expect, it } from "vitest";

import { runVoiceBenchmark } from "./run.ts";

it("runs the synthetic 32-turn acceptance under the latency gates", async () => {
  const report = await runVoiceBenchmark({ profile: "synthetic" });
  expect(report.turns).toHaveLength(32);
  expect(report.passed).toBe(true);
  expect(report.scenarios).toMatchObject({
    interruptions: { pass: true },
    correction: { pass: true },
    concurrentTopics: { pass: true },
    tools: { pass: true },
  });
  expect(report.overlaps).toEqual([]);
  expect(report.providerAudit.unexpectedPaths).toEqual([]);
  expect(report.gates.p50.observedMs).toBeLessThanOrEqual(800);
  expect(report.gates.max.observedMs).toBeLessThanOrEqual(2500);
}, 180_000);
