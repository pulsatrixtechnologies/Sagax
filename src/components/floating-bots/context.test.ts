import { describe, expect, it } from "vitest";
import type { TaskUsage } from "@/state/store";
import { buildFloatingSnapshot, floatingStatus, newFloatingSession, type FloatingBot, type FloatingLabels } from "./brain";
import { floatingContext } from "./context";
import { gaugeFor } from "./gauge";

const usage = (tokens: number, window?: number): TaskUsage => ({ input: 10, output: 5, costUsd: null, turns: 1, context: { tokens, window } });

describe("the energy bar's figures: the header ring's own", () => {
  it("turns the thread's usage into a percent and labels, none before the first turn", () => {
    expect(floatingContext(undefined)).toBeNull();
    expect(floatingContext({ input: 0, output: 0, costUsd: null, turns: 0 })).toBeNull();
    const ctx = floatingContext(usage(48_000, 200_000));
    expect(ctx).toMatchObject({ percent: 24, tokens: 48_000, window: 200_000 });
    expect(ctx?.label).toContain("24");
    expect(floatingContext(usage(48_000))).not.toHaveProperty("percent");
  });

  it("reaches the window live: a new turn's usage changes the snapshot the window is sent", () => {
    const labels = new Proxy({}, { get: (_target, key) => String(key) }) as FloatingLabels;
    const bot: FloatingBot = { id: "b", name: "Ada", color: "green", mascotSkin: null, threadId: "t1", messages: [], busy: false, activity: "idle" };
    const snap = (tokens: number) => {
      const session = newFloatingSession();
      return buildFloatingSnapshot({ bot, session, status: floatingStatus(bot, session, undefined), labels, avatar: null, retro: false, reduced: false, locale: "en", alwaysOnTop: true, context: floatingContext(usage(tokens, 100_000)) });
    };
    const before = snap(10_000);
    const after = snap(90_000);
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
    expect(gaugeFor(before.context)).toMatchObject({ remaining: 90, level: "ok" });
    expect(gaugeFor(after.context)).toMatchObject({ remaining: 10, level: "danger", pulse: true });
  });
});
