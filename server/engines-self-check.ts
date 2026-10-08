// The engines baked into this server's image (engines.lock.json, installed by
// scripts/install-engines.mjs), checked once at startup.
//
// The image's engines step writes a manifest (SAGAX_ENGINES_MANIFEST): which
// engine CLIs it installed, at which pinned version, and which engines it
// deliberately does not carry, with the reason. At boot each installed CLI
// runs `--version` once; the result is logged and becomes the engine's
// installed state for every instance that runs that CLI by its default name,
// so neither a turn nor a page load ever probes it again. An engine the
// manifest lists as not preinstalled reads "Not available on this server"
// (with the reason) instead of "Not installed". Without a manifest (the
// desktop app, a source checkout, an image built before the lock) nothing
// here applies and the per-instance probes keep their old behaviour.
import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

import { findCliCandidates } from "./env-path.ts";
import { execCli } from "./procs.ts";

export interface ManifestEngine {
  id: string;
  name: string;
  drivers: string[];
  kind: string;
  /** The pinned version from engines.lock.json. */
  version: string;
  bin: string;
  /** What `--version` printed when the image was built. */
  reported?: string;
}

export interface ManifestUnavailable {
  id: string;
  name: string;
  drivers: string[];
  reason: string;
}

export interface EngineManifest {
  lockVersion?: number;
  engineSet?: string;
  arch?: string;
  installed: ManifestEngine[];
  notPreinstalled: ManifestUnavailable[];
}

export interface EngineCheck {
  id: string;
  name: string;
  drivers: string[];
  bin: string;
  pinned: string;
  /** First line of `--version` at this boot, when it started. */
  version?: string;
  path?: string;
  ok: boolean;
  error?: string;
}

const VERSION_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** The manifest at `path`, or null when there is none or it is unreadable. */
export function readEngineManifest(path: string | undefined = process.env.SAGAX_ENGINES_MANIFEST): EngineManifest | null {
  if (!path?.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const installed = (Array.isArray(raw.installed) ? raw.installed : []).flatMap((item): ManifestEngine[] => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.bin !== "string" || !item.bin) return [];
    return [{
      id: item.id,
      name: typeof item.name === "string" ? item.name : item.id,
      drivers: strings(item.drivers),
      kind: typeof item.kind === "string" ? item.kind : "",
      version: typeof item.version === "string" ? item.version : "",
      bin: item.bin,
      ...(typeof item.reported === "string" ? { reported: item.reported } : {}),
    }];
  });
  const notPreinstalled = (Array.isArray(raw.notPreinstalled) ? raw.notPreinstalled : []).flatMap((item): ManifestUnavailable[] => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.reason !== "string") return [];
    return [{ id: item.id, name: typeof item.name === "string" ? item.name : item.id, drivers: strings(item.drivers), reason: item.reason }];
  });
  return {
    ...(typeof raw.lockVersion === "number" ? { lockVersion: raw.lockVersion } : {}),
    ...(typeof raw.engineSet === "string" ? { engineSet: raw.engineSet } : {}),
    ...(typeof raw.arch === "string" ? { arch: raw.arch } : {}),
    installed,
    notPreinstalled,
  };
}

export type VersionProbe = (path: string) => Promise<string>;

/** `<cli> --version`, its first non-empty line. */
export const probeVersion: VersionProbe = (path) => new Promise((resolve, reject) => {
  execCli(path, ["--version"], { timeout: VERSION_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 64 * 1024, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout, stderr) => {
    if (error) return reject(error);
    const line = stripVTControlCharacters(`${stdout}\n${stderr ?? ""}`).split(/\r?\n/).map((part) => part.trim()).find(Boolean);
    resolve((line ?? "").slice(0, 200));
  });
});

export class EngineSelfCheck {
  private readonly byDriver = new Map<string, EngineCheck>();
  private readonly unavailableByDriver = new Map<string, ManifestUnavailable>();

  readonly manifest: EngineManifest | null;
  readonly checks: readonly EngineCheck[];

  constructor(manifest: EngineManifest | null, checks: readonly EngineCheck[] = []) {
    this.manifest = manifest;
    this.checks = checks;
    for (const check of checks) for (const driver of check.drivers) this.byDriver.set(driver, check);
    for (const entry of manifest?.notPreinstalled ?? []) for (const driver of entry.drivers) this.unavailableByDriver.set(driver, entry);
  }

  /** The startup result for an instance of `driverKind` that runs `cli`;
   * null when the image did not install that CLI or the instance runs
   * another command (a per-instance override is probed as before). */
  forInstance(driverKind: string, cli: string | null | undefined): EngineCheck | null {
    const check = this.byDriver.get(driverKind);
    if (!check || !cli || cli.trim() !== check.bin) return null;
    return check;
  }

  /** Why this server's image does not carry the engine, when it says so. */
  notAvailableReason(driverKind: string): string | undefined {
    return this.unavailableByDriver.get(driverKind)?.reason;
  }
}

/** Run every installed engine's `--version` once and log the result. */
export async function runEngineSelfCheck(
  manifest: EngineManifest | null,
  options: { probe?: VersionProbe; find?: (bin: string) => string[]; log?: (line: string) => void } = {},
): Promise<EngineSelfCheck> {
  if (!manifest) return new EngineSelfCheck(null);
  const probe = options.probe ?? probeVersion;
  const find = options.find ?? findCliCandidates;
  const log = options.log ?? ((line: string) => console.log(line));
  const checks = await Promise.all(manifest.installed.map(async (engine): Promise<EngineCheck> => {
    const base = { id: engine.id, name: engine.name, drivers: engine.drivers, bin: engine.bin, pinned: engine.version };
    const path = find(engine.bin)[0];
    if (!path) return { ...base, ok: false, error: `\`${engine.bin}\` is not on this server's PATH` };
    try {
      const version = await probe(path);
      return { ...base, path, version, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...base, path, ok: false, error: message.split(/\r?\n/)[0]!.slice(0, 300) };
    }
  }));
  for (const check of checks) {
    log(check.ok
      ? `[engines] ${check.id}: ${check.version || "started"} (pinned ${check.pinned}, ${check.path})`
      : `[engines] ${check.id}: FAILED, ${check.error} (pinned ${check.pinned})`);
  }
  for (const entry of manifest.notPreinstalled) {
    if (entry.drivers.length) log(`[engines] ${entry.id}: not preinstalled, ${entry.reason}`);
  }
  const ok = checks.filter((check) => check.ok).length;
  log(`[engines] self-check: ${ok}/${checks.length} preinstalled engine(s) start (image set ${manifest.engineSet ?? "unknown"})`);
  return new EngineSelfCheck(manifest, checks);
}
