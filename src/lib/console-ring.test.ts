import { afterEach, describe, expect, it } from "vitest";

import { clearConsoleRing, consoleRingLines, CONSOLE_LINE_MAX_CHARS, CONSOLE_RING_MAX_LINES, formatConsoleLine, installConsoleRing, rememberConsoleLine } from "./console-ring";

const KEY = `sk-ant-${"k3yV4lu3k3yV4lu3".repeat(2)}`;

afterEach(() => clearConsoleRing());

describe("console ring for Download logs", () => {
  it("redacts a credential when the line is kept (shared/redact.ts)", () => {
    rememberConsoleLine("error", ["request failed", { headers: { authorization: `Bearer ${KEY}` } }, `api_key=${KEY}`]);
    const [line] = consoleRingLines();
    expect(line).toMatch(/ ERROR request failed/);
    expect(line).not.toContain(KEY);
    expect(line).toContain("«redacted");
  });

  it("keeps the last lines only, each bounded", () => {
    for (let i = 0; i < CONSOLE_RING_MAX_LINES + 20; i += 1) rememberConsoleLine("log", [`line ${i}`]);
    const lines = consoleRingLines();
    expect(lines).toHaveLength(CONSOLE_RING_MAX_LINES);
    expect(lines[0]).toContain("line 20");
    expect(formatConsoleLine("warn", ["x".repeat(CONSOLE_LINE_MAX_CHARS * 2)]).length).toBeLessThan(CONSOLE_LINE_MAX_CHARS + 64);
  });

  it("wraps the console and still prints", () => {
    const printed: unknown[][] = [];
    const target = {
      log: (...args: unknown[]) => printed.push(args),
      info: (...args: unknown[]) => printed.push(args),
      warn: (...args: unknown[]) => printed.push(args),
      error: (...args: unknown[]) => printed.push(args),
    };
    installConsoleRing(target as unknown as Console, null);
    target.warn("careful", new Error("boom"));
    expect(printed).toHaveLength(1);
    expect(consoleRingLines().at(-1)).toMatch(/WARN careful Error: boom/);
  });
});
