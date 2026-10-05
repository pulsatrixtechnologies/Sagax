import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRotatingLog } from "./log-file.mjs";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("rotating desktop log", () => {
  it("keeps the live file under the cap and leaves the previous bytes in the backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-log-"));
    dirs.push(dir);
    const file = join(dir, "server.log");
    const log = createRotatingLog(file, 40);
    log.write("a".repeat(30));
    log.write("b".repeat(30));
    const live = readFileSync(file, "utf8");
    const backup = readFileSync(`${file}.1`, "utf8");
    expect(statSync(file).size).toBeLessThanOrEqual(40);
    expect(live).toBe("b".repeat(30));
    expect(backup).toBe("a".repeat(30));
  });

  it("rotates a file that is already over the cap when the log opens", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-log-"));
    dirs.push(dir);
    const file = join(dir, "server.log");
    const first = createRotatingLog(file, 80);
    first.write("old-session\n");
    const second = createRotatingLog(file, 8);
    second.write("next\n");
    expect(readFileSync(`${file}.1`, "utf8")).toBe("old-session\n");
    expect(readFileSync(file, "utf8")).toBe("next\n");
  });
});
