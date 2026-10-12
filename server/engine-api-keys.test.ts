import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeTempDir } from "./testing/cleanup.ts";
import {
  applyStoredEngineEnv,
  configKeyPatch,
  engineKeyTarget,
  fileKeyConfigured,
  normalizeEngineKey,
  writeFileEngineKey,
  writeHermesAccessKey,
} from "./engine-api-keys.ts";

describe("provider access keys", () => {
  let dir: string;
  afterEach(async () => { if (dir) await removeTempDir(dir); });

  it("maps each card onto its own secret, and never the subscription CLIs", () => {
    expect(engineKeyTarget("openai", "openai-compat")).toEqual({ kind: "config", section: "openai", field: "key" });
    expect(engineKeyTarget("claudeApi", "claudeAgent")).toEqual({ kind: "config", section: "anthropic", field: "key" });
    expect(engineKeyTarget("claude", "claudeAgent")).toBeNull();
    expect(engineKeyTarget("grok", "grokAgent")).toBeNull();
    expect(engineKeyTarget("xaiApi", "grok")).toEqual({ kind: "config", section: "xai", field: "key" });
    expect(engineKeyTarget("cursor", "cursorAgent")?.kind).toBe("file");
    expect(engineKeyTarget("hermes", "hermesAgent")).toMatchObject({ kind: "file", hermes: true });
  });

  it("accepts one line and refuses anything that is not a key", () => {
    expect(normalizeEngineKey("  sk-test-key  ")).toBe("sk-test-key");
    expect(normalizeEngineKey("")).toBe("");
    for (const bad of ["short", "has space key", "line\nbreak-key", "a".repeat(401)]) {
      expect(() => normalizeEngineKey(bad)).toThrow(/single line/);
    }
  });

  it("stores a file key as a secret and injects it only when the instance has none", () => {
    dir = mkdtempSync(join(tmpdir(), "omb-engine-keys-"));
    writeFileEngineKey(dir, "cursorAgent", "CURSOR_API_KEY", "cursor-key-1");
    expect(fileKeyConfigured(dir, "cursorAgent", "CURSOR_API_KEY")).toBe(true);
    expect(statSync(join(dir, "engine-api-keys.json")).mode & 0o777).toBe(0o600);
    const env: Record<string, string | undefined> = {};
    applyStoredEngineEnv(env, "cursorAgent", dir);
    expect(env.CURSOR_API_KEY).toBe("cursor-key-1");
    const owned = { CURSOR_API_KEY: "already" };
    applyStoredEngineEnv(owned, "cursorAgent", dir);
    expect(owned.CURSOR_API_KEY).toBe("already");
    const hermes: Record<string, string | undefined> = {};
    writeFileEngineKey(dir, "hermesAgent", "OPENROUTER_API_KEY", "hermes-key-1");
    applyStoredEngineEnv(hermes, "hermesAgent", dir);
    expect(hermes.OPENROUTER_API_KEY).toBeUndefined();
    writeFileEngineKey(dir, "cursorAgent", "CURSOR_API_KEY", "");
    expect(fileKeyConfigured(dir, "cursorAgent", "CURSOR_API_KEY")).toBe(false);
    expect(readFileSync(join(dir, "engine-api-keys.json"), "utf8")).not.toContain("cursor-key-1");
  });

  it("writes Hermes's key into its home .env and can clear it", () => {
    dir = mkdtempSync(join(tmpdir(), "omb-hermes-key-"));
    const env = { HOME: dir, USERPROFILE: dir };
    writeHermesAccessKey(env, "hermes-key-1");
    const path = join(dir, ".hermes", ".env");
    expect(readFileSync(path, "utf8")).toBe("OPENROUTER_API_KEY=hermes-key-1\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    writeHermesAccessKey(env, "");
    expect(readFileSync(path, "utf8")).not.toContain("hermes-key-1");
  });

  it("clears a config key with an empty value and never puts the key in the patch's other fields", () => {
    const target = engineKeyTarget("mistral", "mistral");
    expect(target?.kind).toBe("config");
    if (target?.kind !== "config") return;
    expect(configKeyPatch(target, "")).toEqual({ mistral: { key: "" } });
  });
});
