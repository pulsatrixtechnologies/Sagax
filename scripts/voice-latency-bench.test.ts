// Runs the voice call latency bench (scripts/voice-latency-bench.ts) when
// SAGAX_VOICE_BENCH=1; skipped otherwise (it takes about a minute and a
// half of real time). Writes the turns and their p50/p90 to BENCH_OUT.
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";

import { runVoiceLatencyBench, summarize } from "./voice-latency-bench.ts";

it.skipIf(process.env.SAGAX_VOICE_BENCH !== "1")("measures a call's latency stage by stage", async () => {
  const { turns, serverLog } = await runVoiceLatencyBench();
  const report = {
    turns,
    first: turns[0],
    warm: summarize(turns.slice(1)),
    all: summarize(turns),
    server: serverLog.split("\n").filter((line) => /\[voice-latency\]|relaunch/.test(line)),
  };
  if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(report, null, 2));
  expect(turns.every((turn) => typeof turn.total === "number")).toBe(true);
}, 600_000);
