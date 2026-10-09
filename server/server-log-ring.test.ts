// The server log tail (server/server-log-ring.ts): bounded, redacted,
// newest first, filtered by level, paged by seq.
import { describe, expect, it } from "vitest";

import { captureConsole, LOG_LINE_MAX_CHARS, ServerLogRing } from "./server-log-ring.ts";

describe("server log ring", () => {
  it("keeps the last lines, splits areas, drops colours, redacts secrets", () => {
    const ring = new ServerLogRing({ max: 3, now: () => 42 });
    ring.push("info", "[engines] claude: 2.1.0");
    ring.push("warn", `\u001b[33m[omb-turn] slow\u001b[0m`);
    ring.push("error", "[auth] key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 refused");
    ring.push("info", "line one\nline two");
    const all = ring.read({ limit: 10 });
    expect(all.lines.map((line) => line.message)).toEqual(["line two", "line one", expect.stringContaining("refused")]);
    expect(all.lines[2]).toMatchObject({ level: "error", area: "auth", at: 42 });
    expect(all.lines[2]!.message).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(all.next).toBeNull();
  });

  it("filters by level and pages by seq", () => {
    const ring = new ServerLogRing();
    for (let index = 0; index < 5; index++) ring.push(index % 2 ? "warn" : "info", `line ${index}`);
    expect(ring.read({ level: "warn", limit: 10 }).lines.map((line) => line.message)).toEqual(["line 3", "line 1"]);
    const first = ring.read({ limit: 2 });
    expect(first.lines.map((line) => line.message)).toEqual(["line 4", "line 3"]);
    expect(ring.read({ limit: 2, before: first.next }).lines.map((line) => line.message)).toEqual(["line 2", "line 1"]);
    ring.push("info", "x".repeat(5000));
    expect(ring.read({ limit: 1 }).lines[0]!.message).toHaveLength(LOG_LINE_MAX_CHARS);
  });

  it("mirrors a console and undoes", () => {
    const ring = new ServerLogRing();
    const seen: string[] = [];
    const target = { log: (...a: unknown[]) => seen.push(a.join(" ")), info: () => {}, warn: () => {}, error: () => {} };
    const undo = captureConsole(ring, target as unknown as Console);
    target.log("[x] hello %d", 5);
    undo();
    target.log("after");
    expect(seen).toEqual(["[x] hello %d 5", "after"]);
    expect(ring.read({ limit: 5 }).lines.map((line) => `${line.area}:${line.message}`)).toEqual(["x:hello 5"]);
  });
});
