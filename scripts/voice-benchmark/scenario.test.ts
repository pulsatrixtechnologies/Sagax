import { expect, it } from "vitest";

import {
  VOICE_ACCEPTANCE_SCRIPT,
  hashFrames,
  liveVoiceCommand,
  scenarioKinds,
  scenarioLanguages,
  syntheticVoiceFrames,
} from "./scenario.ts";

it("covers 32 bilingual turns, including interruption, correction, topics, tools and stop", () => {
  expect(VOICE_ACCEPTANCE_SCRIPT).toHaveLength(32);
  expect(scenarioLanguages()).toEqual(new Set(["en", "fr-CA"]));
  expect([...scenarioKinds()]).toEqual(expect.arrayContaining([
    "ordinary", "interrupt-thinking", "interrupt-speaking", "correction",
    "concurrent-topic", "tool", "stop",
  ]));
  expect(VOICE_ACCEPTANCE_SCRIPT.filter((turn) => turn.warmup)).toHaveLength(1);
  expect(VOICE_ACCEPTANCE_SCRIPT.filter((turn) => turn.topicId === "topic-a").some((turn) => turn.concurrentWith === "topic-b")).toBe(true);
  expect(VOICE_ACCEPTANCE_SCRIPT.some((turn) => turn.topicId === "topic-b" && turn.kind === "concurrent-topic")).toBe(true);
  const ids = new Set(VOICE_ACCEPTANCE_SCRIPT.map((turn) => turn.id));
  expect(ids.size).toBe(32);
});

it("generates the same PCM every time and refuses a live render without espeak-ng", () => {
  const turn = VOICE_ACCEPTANCE_SCRIPT[0]!;
  expect(hashFrames(syntheticVoiceFrames(turn))).toBe(hashFrames(syntheticVoiceFrames(turn)));
  const english = syntheticVoiceFrames(turn);
  const french = syntheticVoiceFrames(VOICE_ACCEPTANCE_SCRIPT.find((row) => row.language === "fr-CA")!);
  expect(english.length).toBeGreaterThan(8);
  expect(french[0]?.[0]).toBeCloseTo(0.92 / 1000);
  expect(english.at(-1)?.[0]).toBeCloseTo(0.03 / 1000);
  expect(hashFrames(english)).not.toBe(hashFrames(french));
  expect(() => liveVoiceCommand(turn, "/tmp/out.wav", { espeak: "" })).toThrow(/espeak-ng is required/);
});
