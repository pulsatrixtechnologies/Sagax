import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assessHealthz, assessImageLabels, assessProductionManifest, assessStartupLog, productionEngineIds } from "./engine-image-gate.mjs";

const lock = JSON.parse(readFileSync(join(import.meta.dirname, "..", "engines.lock.json"), "utf8"));
const required = productionEngineIds(lock);
const sha = "20004735d6f4ad9d924ee04175d245feaa8398e5";

function manifest(engineSet, ids = required) {
  return {
    engineSet,
    installed: ids.map((id) => ({ id, bin: id === "cursor" ? "cursor-agent" : id })),
  };
}

function startupLog(ids = required, { failed = [], engineSet = "all", extra = "" } = {}) {
  const lines = ids.map((id) => (failed.includes(id)
    ? `[engines] ${id}: FAILED, missing (pinned 1)`
    : `[engines] ${id}: 1 (pinned 1, /usr/local/bin/${id})`));
  lines.push(extra);
  lines.push(`[engines] self-check: ${ids.length - failed.length}/${ids.length} preinstalled engine(s) start (image set ${engineSet})`);
  return lines.filter(Boolean).join("\n");
}

describe("assessProductionManifest", () => {
  it("accepts the full lock and refuses none, another set, or a missing engine", () => {
    expect(assessProductionManifest(manifest("all"), lock)).toMatchObject({ ok: true, errors: [], missing: [] });
    expect(assessProductionManifest({ engineSet: "none", installed: [] }, lock).errors).toEqual([
      "engineSet is none",
      `missing engines: ${required.join(",")}`,
    ]);
    expect(assessProductionManifest({ installed: [] }, lock).errors[0]).toBe("engineSet is none");
    expect(assessProductionManifest(manifest("open", required.filter((id) => id !== "claude")), lock).errors).toEqual([
      "engineSet must be all",
      "missing engines: claude",
    ]);
    const dropped = assessProductionManifest(manifest("all", required.filter((id) => id !== "grok" && id !== "cursor")), lock);
    expect(dropped.ok).toBe(false);
    expect(dropped.missing).toEqual(["grok", "cursor"]);
    expect(assessProductionManifest(manifest("all", [...required, "claude"]), lock).ok).toBe(true);
    expect(assessProductionManifest({ engineSet: "all", installed: required.map((id) => ({ id })) }, lock).missing).toEqual(required);
  });
});

describe("assessImageLabels", () => {
  const labels = {
    "org.opencontainers.image.revision": sha,
    "org.opencontainers.image.created": "2026-10-12T15:25:00Z",
    "io.sagax.engine-set": "all",
  };

  it("requires the commit, a UTC stamp and the engine set", () => {
    expect(assessImageLabels(labels, { sha }).ok).toBe(true);
    expect(assessImageLabels({ ...labels, "org.opencontainers.image.revision": "other" }, { sha }).errors[0]).toMatch(/revision/);
    expect(assessImageLabels({ ...labels, "org.opencontainers.image.created": "" }, { sha }).errors[0]).toMatch(/UTC/);
    expect(assessImageLabels({ ...labels, "io.sagax.engine-set": "none" }, { sha }).errors[0]).toMatch(/none/);
    expect(assessImageLabels(null, {}).ok).toBe(false);
  });
});

describe("assessStartupLog", () => {
  it("accepts a full start and rejects none, a failure, or a missing line", () => {
    expect(assessStartupLog(startupLog(), required).ok).toBe(true);
    const empty = assessStartupLog("[engines] self-check: 0/0 preinstalled engine(s) start (image set none)\n[engines] engine_missing engineSet=none missing=claude", required);
    expect(empty.ok).toBe(false);
    expect(empty.alerts).toHaveLength(1);
    expect(assessStartupLog(startupLog(required, { failed: ["grok"] }), required).errors.join("\n")).toMatch(/grok failed/);
    expect(assessStartupLog(startupLog(required.filter((id) => id !== "codex")), required).errors.join("\n")).toMatch(/codex/);
    expect(assessStartupLog("[engines] self-check: 11/11 preinstalled engine(s) start (image set open)", required).errors).toContain("self-check did not report image set all");
  });
});

describe("assessHealthz", () => {
  it("requires ok and the app name", () => {
    expect(assessHealthz('{"ok":true,"app":"openmausbot","product":"sagax"}').ok).toBe(true);
    expect(assessHealthz({ ok: true, app: "openmausbot" }).ok).toBe(true);
    expect(assessHealthz('{"app":"openmausbot"}').errors).toContain("healthz not ok");
    expect(assessHealthz('{"ok":true}').errors).toContain("healthz missing openmausbot");
    expect(assessHealthz("nope").ok).toBe(false);
  });
});
