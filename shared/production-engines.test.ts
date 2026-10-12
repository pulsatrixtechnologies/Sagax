import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PRODUCTION_ENGINE_IDS, PRODUCTION_ENGINE_SET, engineMissingLogLine } from "./production-engines.ts";

const lock = JSON.parse(readFileSync(join(import.meta.dirname, "..", "engines.lock.json"), "utf8")) as {
  engines: Array<{ id: string }>;
};

describe("PRODUCTION_ENGINE_IDS", () => {
  it("is the lock's installable engines, in order", () => {
    expect(PRODUCTION_ENGINE_SET).toBe("all");
    expect([...PRODUCTION_ENGINE_IDS]).toEqual(lock.engines.map((engine) => engine.id));
    expect(PRODUCTION_ENGINE_IDS).toEqual(["claude", "codex", "pi", "gemini", "kimi", "qwen", "opencode", "droid", "grok", "cursor", "hermes"]);
  });

  it("names a startup alert when the set is short or an engine failed", () => {
    expect(engineMissingLogLine(null, [])).toBeNull();
    const full = {
      engineSet: "all",
      installed: PRODUCTION_ENGINE_IDS.map((id) => ({ id })),
    };
    expect(engineMissingLogLine(full, PRODUCTION_ENGINE_IDS.map((id) => ({ id, ok: true })))).toBeNull();
    expect(engineMissingLogLine({ engineSet: "none", installed: [] }, [])).toBe(
      `[engines] engine_missing engineSet=none missing=${PRODUCTION_ENGINE_IDS.join(",")}`,
    );
    expect(engineMissingLogLine(full, [{ id: "grok", ok: false }])).toContain("missing=grok");
  });
});
