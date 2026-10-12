import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assertEnginesRequired, integrityMatches, npmPinError, npmTarballUrl, parseNpmSpec, selectEngines } from "./install-engines.mjs";

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

  it("keeps a locked ENGINES override and refuses an unknown package, latest, or a different version", () => {
    const legacy = selectEngines(lock, {
      engineSet: "none",
      engines: "@anthropic-ai/claude-code@2.1.288 @openai/codex@0.160.0",
      nativeEngines: "grok",
      arch: "arm64",
    });
    expect(ids(legacy)).toEqual(["grok", "claude", "codex"]);
    expect(legacy.install.find((engine) => engine.id === "codex")).toMatchObject({ bin: "codex", spec: "@openai/codex@0.160.0", version: "0.160.0" });
    expect(legacy.install.find((engine) => engine.id === "codex").integrity).toMatch(/^sha512-/);

    const allButNative = selectEngines(lock, { engineSet: "all", nativeEngines: "none", arch: "arm64" });
    expect(ids(allButNative)).not.toContain("grok");
    expect(ids(allButNative)).not.toContain("cursor");
    expect(ids(allButNative)).toContain("hermes");

    expect(() => selectEngines(lock, { engineSet: "none", engines: "some-tool", arch: "arm64" })).toThrow(/unknown npm engine/);
    expect(() => selectEngines(lock, { engineSet: "all", engines: "@openai/codex@0.150.0", arch: "arm64" })).toThrow(/does not match the locked/);
    expect(() => selectEngines(lock, { engineSet: "none", engines: "@openai/codex", arch: "arm64" })).toThrow(/exact version/);
    expect(ids(selectEngines(lock, { engineSet: "all", engines: "none", arch: "arm64" })).every((id) => !lock.engines.find((engine) => engine.id === id && engine.kind === "npm"))).toBe(true);
    expect(() => selectEngines(lock, { nativeEngines: "claude", arch: "arm64" })).toThrow(/unknown native engine/);
  });

  it("a native engine without a build for the architecture is listed, not installed", () => {
    const selection = selectEngines(lock, { engineSet: "grok", arch: "riscv64" });
    expect(selection.install).toEqual([]);
    expect(selection.unavailable).toEqual([{ id: "grok", name: "Grok Build", drivers: ["grokAgent"], reason: "No Grok Build build for riscv64." }]);
  });
});

describe("npm integrity", () => {
  it("names the registry tarball and refuses a pin without a sha512", () => {
    expect(npmTarballUrl("@openai/codex", "0.160.0")).toBe("https://registry.npmjs.org/@openai/codex/-/codex-0.160.0.tgz");
    expect(npmTarballUrl("opencode-ai", "1.18.34")).toBe("https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.18.34.tgz");
    expect(npmPinError({ kind: "npm", package: "opencode-ai", version: "latest" })).toMatch(/exact version/);
    expect(npmPinError({ kind: "npm", package: "opencode-ai", version: "1.18.34" })).toMatch(/sha512/);
    expect(integrityMatches(Buffer.from("abc"), `sha512-${Buffer.from("abc").toString("base64")}`)).toBe(false);
    const integrity = `sha512-${createHash("sha512").update("abc").digest("base64")}`;
    expect(integrityMatches(Buffer.from("abc"), integrity)).toBe(true);
    for (const engine of lock.engines) {
      if (engine.kind === "npm") expect(engine.integrity, engine.id).toMatch(/^sha512-/);
    }
  });
});

describe("parseNpmSpec", () => {
  it("splits scoped and plain specs", () => {
    expect(parseNpmSpec("@openai/codex@0.160.0")).toEqual({ name: "@openai/codex", version: "0.160.0" });
    expect(parseNpmSpec("@openai/codex")).toEqual({ name: "@openai/codex", version: "" });
    expect(parseNpmSpec("opencode-ai@1.18.34")).toEqual({ name: "opencode-ai", version: "1.18.34" });
  });
});

describe("REQUIRE_ENGINES (organization images)", () => {
  it("fails an engine-less selection when required", () => {
    expect(() => assertEnginesRequired({ required: "1", engineSet: "none", count: 0 })).toThrow(/selects no engine/);
    expect(() => assertEnginesRequired({ required: "1", engineSet: "", count: 0 })).toThrow(/ENGINE_SET=all/);
  });
  it("passes the public image (not required) and a populated selection", () => {
    expect(() => assertEnginesRequired({ required: "", engineSet: "none", count: 0 })).not.toThrow();
    expect(() => assertEnginesRequired({ required: "1", engineSet: "all", count: 3 })).not.toThrow();
  });
  it("ENGINE_SET=all selects claude and grok on arm64 and amd64", () => {
    for (const arch of ["arm64", "amd64"]) {
      const ids = selectEngines(lock, { engineSet: "all", arch }).install.map((engine) => engine.id);
      expect(ids).toEqual(expect.arrayContaining(["claude", "grok"]));
    }
  });
});
