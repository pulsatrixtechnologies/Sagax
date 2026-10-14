// Bounds the engine-startup memory spike without the real CLIs.
// Six stand-in processes each hold 48 MiB. 0.5.0 starts them together, 0.5.1
// two at a time, and the shipped check starts none when the manifest already
// recorded --version.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./measure-engine-startup-memory.mjs", import.meta.url));

describe("engine startup memory", () => {
  it("all-at-once exceeds two-at-a-time, and a recorded version spawns nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-startup-mem-"));
    const out = join(dir, "report.json");
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      script,
      "--stand-in-mb", "48",
      "--count", "6",
      "--hold-ms", "500",
      "--out", out,
    ], { encoding: "utf8", timeout: 40_000 });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const report = JSON.parse(readFileSync(out, "utf8"));
    const mode = Object.fromEntries(report.modes.map((row) => [row.mode, row]));
    expect(mode["0.5.0"].skipped).toBeUndefined();
    expect(mode["0.5.0"].addedMiB).toBeGreaterThan(48 * 6 * 0.55);
    expect(mode["0.5.1"].addedMiB).toBeLessThan(mode["0.5.0"].addedMiB * 0.5);
    expect(mode.fixed.addedMiB).toBeLessThan(16);
  }, 45_000);
});
