import { afterEach, describe, expect, it, vi } from "vitest";

import { harnessCommandsPath, loadHarnessCommands, resetHarnessCommandCache } from "./harness-commands";

const answer = { available: true, engine: "claude" as const, commands: [{ name: "compact", description: "Compact", group: "engine" as const }] };

describe("loadHarnessCommands", () => {
  afterEach(() => resetHarnessCommandCache());

  it("asks for the conversation's list once, then on refresh", async () => {
    const fetcher = vi.fn(async () => answer);
    await Promise.all([loadHarnessCommands(fetcher, "b1", "t1", { now: 0 }), loadHarnessCommands(fetcher, "b1", "t1", { now: 0 })]);
    expect(await loadHarnessCommands(fetcher, "b1", "t1", { now: 1_000 })).toEqual(answer);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/bots/b1/harness-commands?threadId=t1");
    await loadHarnessCommands(fetcher, "b1", "t1", { refresh: true, now: 2_000 });
    expect(fetcher).toHaveBeenLastCalledWith("/api/bots/b1/harness-commands?threadId=t1&refresh=1");
    await loadHarnessCommands(fetcher, "b1", "t2", { now: 2_000 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("falls back to the last list, else to none, when the server cannot answer", async () => {
    const fetcher = vi.fn(async () => answer);
    await loadHarnessCommands(fetcher, "b1", "t1", { now: 0 });
    fetcher.mockRejectedValueOnce(new Error("offline"));
    expect(await loadHarnessCommands(fetcher, "b1", "t1", { refresh: true, now: 1 })).toEqual(answer);
    expect(await loadHarnessCommands(async () => { throw new Error("x"); }, "b2", undefined)).toEqual({ available: false, commands: [], reason: "unavailable" });
  });

  it("builds the path", () => {
    expect(harnessCommandsPath("b 1", undefined)).toBe("/api/bots/b%201/harness-commands");
  });
});
