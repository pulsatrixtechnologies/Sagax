import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  loadReference,
  main,
  parseVoiceBenchArgs,
  voiceBenchProcessExit,
  writeVoiceBenchFailure,
} from "./cli.ts";

it("parses synthetic hard gates and a real observation", () => {
  expect(parseVoiceBenchArgs([])).toEqual({ profile: "synthetic", enforce: false });
  expect(parseVoiceBenchArgs(["--profile", "real", "--out", "/tmp/voice"])).toEqual({
    profile: "real",
    enforce: false,
    out: "/tmp/voice",
  });
  expect(parseVoiceBenchArgs(["--profile", "real", "--enforce"])).toMatchObject({ profile: "real", enforce: true });
});

it("fails a synthetic run and an enforced real run when gates fail, and records an unenforced real run", () => {
  expect(voiceBenchProcessExit({ profile: "synthetic", enforce: false, passed: false })).toBe(1);
  expect(voiceBenchProcessExit({ profile: "synthetic", enforce: false, passed: true })).toBe(0);
  expect(voiceBenchProcessExit({ profile: "real", enforce: false, passed: false })).toBe(0);
  expect(voiceBenchProcessExit({ profile: "real", enforce: true, passed: false })).toBe(1);
  expect(voiceBenchProcessExit({ profile: "real", enforce: true, passed: true })).toBe(0);
});

it("treats a missing reference as not-provided and reads a sidecar latency", async () => {
  expect(loadReference(undefined)).toEqual({ status: "not-provided" });
  const dir = mkdtempSync(join(tmpdir(), "voice-ref-"));
  const wav = join(dir, "grok.wav");
  await expect(loadReference(wav)).rejects.toThrow(/sidecar/);
  writeFileSync(`${wav}.json`, JSON.stringify({ version: 1, speechEndMs: 1240, firstAudioMs: 1880 }));
  await expect(loadReference(wav)).resolves.toMatchObject({ status: "measured", latencyMs: 640, recordingPath: wav });
});

it("refuses real mode before launching a server when credentials are missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-cli-"));
  const code = await main(["--profile", "real", "--out", dir], {});
  expect(code).toBe(1);
  const partial = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as { passed: boolean; error: string };
  expect(partial.passed).toBe(false);
  expect(partial.error).toMatch(/SAGAX_XAI_VOICE_KEY/);
  expect(partial.error).not.toMatch(/xai-[A-Za-z0-9_-]{8,}/);
});

it("writes a redacted partial report", () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-fail-"));
  writeVoiceBenchFailure(dir, new Error("boom xai-SECRETVALUE123456"));
  const partial = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as { error: string };
  expect(partial.error).toContain("[redacted]");
  expect(partial.error).not.toContain("SECRETVALUE123456");
  expect(readFileSync(join(dir, "report.md"), "utf8")).toMatch(/failed before a report/);
});
