// Voice acceptance CLI. Synthetic runs always enforce the latency gates.
// A real run records the same gates and exits 0 unless --enforce is set.
// A missing reference sidecar is an error; a missing reference argument is
// recorded as not-provided and never turned into a fabricated number.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { renderVoiceBenchMarkdown, type VoiceBenchReferenceInput, type VoiceBenchReport } from "./model.ts";
import { assertRealVoiceCredentials, runVoiceBenchmark, type VoiceBenchmarkOptions } from "./run.ts";

export interface VoiceBenchArgs {
  profile: "synthetic" | "real";
  enforce: boolean;
  out?: string;
  reference?: string;
}

export interface LoadedReferenceMeasured {
  status: "measured";
  recordingPath: string;
  speechEndMs: number;
  firstAudioMs: number;
  latencyMs: number;
}

export function parseVoiceBenchArgs(argv: readonly string[]): VoiceBenchArgs {
  const args: VoiceBenchArgs = { profile: "synthetic", enforce: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--enforce") args.enforce = true;
    else if (token === "--profile") {
      const profile = argv[++i];
      if (profile !== "synthetic" && profile !== "real") throw new Error(`unknown profile ${profile ?? ""}`);
      args.profile = profile;
    } else if (token === "--out") {
      const out = argv[++i];
      if (!out) throw new Error("--out needs a directory");
      args.out = out;
    } else if (token === "--reference") {
      const reference = argv[++i];
      if (!reference) throw new Error("--reference needs a recording path");
      args.reference = reference;
    } else if (token === "--") continue;
    else throw new Error(`unknown argument ${token}`);
  }
  return args;
}

export function voiceBenchProcessExit(options: { profile: "synthetic" | "real"; enforce: boolean; passed: boolean }): number {
  if (options.profile === "real" && !options.enforce) return 0;
  return options.passed ? 0 : 1;
}

export function loadReference(recordingPath: undefined): { status: "not-provided" };
export function loadReference(recordingPath: string): Promise<LoadedReferenceMeasured>;
export function loadReference(recordingPath?: string): { status: "not-provided" } | Promise<LoadedReferenceMeasured> {
  if (!recordingPath) return { status: "not-provided" };
  return readSidecar(recordingPath);
}

async function readSidecar(recordingPath: string): Promise<LoadedReferenceMeasured> {
  const sidecar = `${recordingPath}.json`;
  let raw: string;
  try {
    raw = readFileSync(sidecar, "utf8");
  } catch {
    throw new Error(`reference sidecar is missing: ${sidecar}`);
  }
  let parsed: { version?: unknown; speechEndMs?: unknown; firstAudioMs?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error(`reference sidecar is not json: ${sidecar}`);
  }
  if (parsed.version !== 1 || typeof parsed.speechEndMs !== "number" || typeof parsed.firstAudioMs !== "number") {
    throw new Error(`reference sidecar is missing version, speechEndMs or firstAudioMs: ${sidecar}`);
  }
  if (parsed.firstAudioMs <= parsed.speechEndMs) {
    throw new Error("reference sidecar first audio marker must be after speech end marker");
  }
  return {
    status: "measured",
    recordingPath,
    speechEndMs: parsed.speechEndMs,
    firstAudioMs: parsed.firstAudioMs,
    latencyMs: parsed.firstAudioMs - parsed.speechEndMs,
  };
}

export function referenceForCompile(reference: { status: "not-provided" } | LoadedReferenceMeasured): VoiceBenchReferenceInput {
  if (reference.status === "not-provided") return reference;
  return {
    status: "measured",
    recordingPath: reference.recordingPath,
    speechEndMs: reference.speechEndMs,
    firstAudioMs: reference.firstAudioMs,
  };
}

function redact(text: string): string {
  return text
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, "xai-[redacted]")
    .replace(/(SAGAX_XAI_VOICE_KEY|XAI_API_KEY)=\S+/g, "$1=[redacted]");
}

export function writeVoiceBenchReport(dir: string, report: VoiceBenchReport): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(joinReport(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(joinReport(dir, "report.md"), renderVoiceBenchMarkdown(report));
}

export function writeVoiceBenchFailure(dir: string, error: unknown): void {
  mkdirSync(dir, { recursive: true });
  const message = redact(error instanceof Error ? error.message : String(error));
  const partial = { version: 1 as const, passed: false, error: message };
  writeFileSync(joinReport(dir, "report.json"), `${JSON.stringify(partial, null, 2)}\n`);
  writeFileSync(joinReport(dir, "report.md"), `# Voice benchmark\n\nRun failed before a report.\n\n${message}\n`);
}

function joinReport(dir: string, name: string): string {
  return join(dir, name);
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let args: VoiceBenchArgs;
  try {
    args = parseVoiceBenchArgs(argv);
  } catch (error) {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    return 1;
  }
  try {
    if (args.profile === "real") assertRealVoiceCredentials(env);
    const loaded = args.reference ? await loadReference(args.reference) : loadReference(undefined);
    const options: VoiceBenchmarkOptions = {
      profile: args.profile,
      reference: referenceForCompile(loaded),
    };
    const report = await runVoiceBenchmark(options);
    if (args.out) writeVoiceBenchReport(args.out, report);
    return voiceBenchProcessExit({ profile: args.profile, enforce: args.enforce, passed: report.passed });
  } catch (error) {
    if (args.out) writeVoiceBenchFailure(args.out, error);
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
