// The unlock toasts' queue (achievement-toasts.ts): one at a time, each once,
// a short stack, never while the person types.
import { describe, expect, it } from "vitest";
import { AchievementToastQueue, MAX_QUEUED, TYPING_QUIET_MS } from "./achievement-toasts";

describe("achievement toast queue", () => {
  it("shows each unlock once, in order, one at a time", () => {
    const queue = new AchievementToastQueue();
    expect(queue.enqueue(["first-words", "hello-bot"])).toBe(2);
    // the POST answer and the live frame both report it: still once
    expect(queue.enqueue(["first-words"])).toBe(0);
    expect(queue.ready(10_000, 0)).toBe(true);
    expect(queue.advance()).toBe("first-words");
    expect(queue.ready(10_000, 0)).toBe(false);
    queue.dismiss();
    expect(queue.advance()).toBe("hello-bot");
    queue.dismiss();
    expect(queue.snapshot()).toEqual({ current: null, queue: [] });
    expect(queue.advance()).toBeNull();
  });

  it("waits while the person types", () => {
    const queue = new AchievementToastQueue();
    queue.enqueue(["makeover"]);
    const typedAt = 50_000;
    expect(queue.ready(typedAt + 200, typedAt)).toBe(false);
    expect(queue.ready(typedAt + TYPING_QUIET_MS, typedAt)).toBe(true);
  });

  it("keeps a short stack and remembers unlocks shown nowhere", () => {
    const queue = new AchievementToastQueue();
    queue.enqueue(Array.from({ length: MAX_QUEUED + 4 }, (_, index) => `a${index}`));
    expect(queue.snapshot().queue).toHaveLength(MAX_QUEUED);
    expect(queue.snapshot().queue[0]).toBe("a4");
    queue.markSeen(["quiet"]);
    expect(queue.enqueue(["quiet"])).toBe(0);
    const told: number[] = [];
    const stop = queue.subscribe(() => told.push(1));
    queue.enqueue(["new"]);
    stop();
    queue.enqueue(["later"]);
    expect(told).toHaveLength(1);
  });
});
