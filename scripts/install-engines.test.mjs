import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseNpmSpec, selectEngines } from "./install-engines.mjs";

const lock = JSON.parse(readFileSync(join(import.meta.dirname, "..", "engines.lock.json"), "utf8"));
const ids = (selection) => selection.install.map((engine) => engine.id);

describe("selectEngines", () => {
  it("installs nothing by default: the public image carries no engine", () => {
    for (const engineSet of ["", "none"]) {
      expect(selectEngines(lock, { engineSet, arch: "arm64" })).toEqual({ install: [], unavailable: [] });
    }
  });

  it("all: every engine of the lock, pinned, and says what it leaves out", () => {
    const selection = selectEngines(lock, { engineSet: "all", arch: "amd64" });
    expect(ids(selection)).toEqual(lock.engines.map((engine) => engine.id));
    expect(selection.install.find((engine) => engine.id === "claude").spec).toBe("@anthropic-ai/claude-code@2.1.288");
    expect(selection.install.find((engine) => engine.id === "grok").spec).toBeUndefined();
    expect(selection.unavailable.map((entry) => entry.id)).toEqual(lock.notPreinstalled.map((entry) => entry.id));
  });

  it("open: only the redistributable engines, the others listed with their licence", () => {
    const selection = selectEngines(lock, { engineSet: "open", arch: "arm64" });
    expect(ids(selection)).not.toContain("claude");
    expect(ids(selection)).not.toContain("cursor");
    expect(ids(selection)).not.toContain("droid");
    expect(ids(selection)).toContain("codex");
    const claude = selection.unavailable.find((entry) => entry.id === "claude");
    expect(claude.drivers).toEqual(["claudeAgent"]);
    expect(claude.reason).toContain("Anthropic Commercial Terms");
  });

  it("a list of ids picks those engines and refuses an unknown one", () => {
    expect(ids(selectEngines(lock, { engineSet: "claude grok", arch: "arm64" }))).toEqual(["claude", "grok"]);
    expect(() => selectEngines(lock, { engineSet: "claude nope", arch: "arm64" })).toThrow(/nope/);
  });

  it("keeps the legacy ENGINES and NATIVE_ENGINES overrides (Perspicax PULSABOT_ENGINES)", () => {
    const legacy = selectEngines(lock, {
      engineSet: "none",
      engines: "@anthropic-ai/claude-code@2.1.288 @openai/codex@0.160.0 some-tool",
      nativeEngines: "grok",
      arch: "arm64",
    });
    expect(ids(legacy)).toEqual(["grok", "claude", "codex", "some-tool"]);
    expect(legacy.install.find((engine) => engine.id === "codex")).toMatchObject({ bin: "codex", spec: "@openai/codex@0.160.0", version: "0.160.0" });
    expect(legacy.install.find((engine) => engine.id === "some-tool")).toMatchObject({ bin: "", spec: "some-tool" });

    const allButNative = selectEngines(lock, { engineSet: "all", nativeEngines: "none", arch: "arm64" });
    expect(ids(allButNative)).not.toContain("grok");
    expect(ids(allButNative)).not.toContain("cursor");
    expect(ids(allButNative)).toContain("hermes");

    const replacedNpm = selectEngines(lock, { engineSet: "all", engines: "@openai/codex@0.150.0", arch: "arm64" });
    expect(replacedNpm.install.filter((engine) => engine.kind === "npm").map((engine) => engine.spec)).toEqual(["@openai/codex@0.150.0"]);
    expect(ids(selectEngines(lock, { engineSet: "all", engines: "none", arch: "arm64" })).every((id) => !lock.engines.find((engine) => engine.id === id && engine.kind === "npm"))).toBe(true);
    expect(() => selectEngines(lock, { nativeEngines: "claude", arch: "arm64" })).toThrow(/unknown native engine/);
  });

  it("a native engine without a build for the architecture is listed, not installed", () => {
    const selection = selectEngines(lock, { engineSet: "grok", arch: "riscv64" });
    expect(selection.install).toEqual([]);
    expect(selection.unavailable).toEqual([{ id: "grok", name: "Grok Build", drivers: ["grokAgent"], reason: "No Grok Build build for riscv64." }]);
  });
});

describe("parseNpmSpec", () => {
  it("splits scoped and plain specs", () => {
    expect(parseNpmSpec("@openai/codex@0.160.0")).toEqual({ name: "@openai/codex", version: "0.160.0" });
    expect(parseNpmSpec("@openai/codex")).toEqual({ name: "@openai/codex", version: "" });
    expect(parseNpmSpec("opencode-ai@1.18.34")).toEqual({ name: "opencode-ai", version: "1.18.34" });
  });
});
