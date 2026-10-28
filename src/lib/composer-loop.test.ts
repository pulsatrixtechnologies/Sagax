import { describe, expect, it } from "vitest";
import { loopRoutineName, parseLoopCommand } from "./composer-loop";

describe("parseLoopCommand", () => {
  it("reads a cadence and a prompt", () => {
    expect(parseLoopCommand("/loop 5m check the board")).toEqual({
      kind: "start",
      everyMinutes: 5,
      prompt: "check the board",
      raised: false,
      capped: false,
    });
    expect(parseLoopCommand("/loop 2h write the note")?.kind).toBe("start");
    expect(parseLoopCommand("/LOOP 1d close the day")).toMatchObject({ everyMinutes: 1440 });
  });

  it("raises a cadence under 5 minutes and caps a cadence over a day", () => {
    expect(parseLoopCommand("/loop 1m ping")).toMatchObject({ everyMinutes: 5, raised: true });
    expect(parseLoopCommand("/loop 3d ping")).toMatchObject({ everyMinutes: 1440, capped: true });
  });

  it("keeps status and stop out of the prompt", () => {
    expect(parseLoopCommand("/loop status")).toEqual({ kind: "status" });
    expect(parseLoopCommand("/loop stop Board")).toEqual({ kind: "stop", name: "Board" });
    expect(parseLoopCommand("/loop")).toEqual({ kind: "incomplete" });
    expect(parseLoopCommand("/loop 5m")).toEqual({ kind: "incomplete" });
    expect(parseLoopCommand("hello")).toBeNull();
  });

  it("names the routine from the cadence and the prompt", () => {
    expect(loopRoutineName(5, "check the board")).toBe("Loop 5m check the board");
    expect(loopRoutineName(120, "write")).toBe("Loop 2h write");
  });
});
