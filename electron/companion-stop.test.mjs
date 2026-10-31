import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { waitCompanionExit } from "./companion-exit.mjs";

describe("waitCompanionExit", () => {
  it("force-kills a child that ignores SIGTERM after the grace", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter();
      child.kill = vi.fn(() => true);
      const done = waitCompanionExit(child, 5_000);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      await done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves on exit without SIGKILL when the child leaves in time", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter();
      child.kill = vi.fn(() => true);
      const done = waitCompanionExit(child, 5_000);
      child.emit("exit", 0, null);
      await done;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
