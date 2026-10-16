import { type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

// Preserve only the owner's hook state across prop updates. Descendants still
// render with React's real hooks; no DOM or live workspace is needed here.
const fixture = vi.hoisted(() => ({
  capturing: false, cursor: 0, slots: [] as unknown[], effects: [] as EffectCallback[],
  state: { activeView: "chat", selectedId: "atlas", deletingBots: {}, pendingQueued: {}, instances: [], revealThread: null as null | { threadId: string; nonce: number } },
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      if (!fixture.capturing) return actual.useState(initial);
      const index = fixture.cursor++;
      if (!(index in fixture.slots)) fixture.slots[index] = typeof initial === "function" ? initial() : initial;
      return [fixture.slots[index], (next: unknown) => {
        fixture.slots[index] = typeof next === "function" ? next(fixture.slots[index]) : next;
      }];
    },
    useEffect: (effect: EffectCallback, dependencies?: unknown[]) => {
      if (fixture.capturing) fixture.effects.push(effect);
      else actual.useEffect(effect, dependencies);
    },
    useMemo: <T,>(factory: () => T, dependencies: unknown[]) => fixture.capturing ? factory() : actual.useMemo(factory, dependencies),
  };
});
vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: fixture.state, dispatch: vi.fn() }),
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", async (original) => ({ ...await original<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
  useThreadsLocationChoice: () => "sidebar" as const,
}));
vi.mock("@/lib/live-call-media", async (original) => {
  const actual = await original<typeof import("@/lib/live-call-media")>();
  return { ...actual, useLiveMedia: actual.liveMedia };
});
import { BotListItem } from "./Sidebar";

const bot: Bot = {
  id: "atlas", threadId: "current", name: "Atlas", title: "", description: "",
  notifications: true, color: "green", unread: false, modelSelection: { instanceId: "claude", model: "test" },
  messages: [{ id: "reply", role: "bot", kind: "text", text: "The latest reply", at: 1 }],
  tasks: [{ threadId: "current", title: "Current", createdAt: 1 }],
};
function render(candidate = bot) {
  fixture.cursor = 0; fixture.effects = []; fixture.capturing = true;
  let row;
  try { row = BotListItem({ bot: candidate, density: "comfortable", onMenu: vi.fn() }); }
  finally { fixture.capturing = false; }
  return renderToStaticMarkup(row);
}
beforeEach(() => { fixture.slots = []; fixture.state.revealThread = null; });

// JC (2026-10-12): bot row + its selected thread made two stacked rounded
// blocks. Since Grok Bot's rows (2026-10-15) the thread list no longer
// unfolds under the bot, even in the sidebar location: the selected bot row
// carries the one highlight.
describe("sidebar threads: one highlight for the selected conversation", () => {
  it("draws the selected fill on the bot row only, with no thread rows under it", () => {
    const multiple = { ...bot, tasks: [...bot.tasks!, { threadId: "older", title: "Earlier", createdAt: 0 }] };
    fixture.state.revealThread = { threadId: "current", nonce: 1 };
    render(multiple);
    for (const effect of fixture.effects) effect();
    const markup = render(multiple);
    expect(markup).not.toContain("data-sidebar-thread-row");
    expect(markup.match(/bg-sidebar-selected/g)).toHaveLength(1);
    expect(markup).toMatch(/data-sidebar-bot-row="atlas"[^>]*class="[^"]*bg-sidebar-selected/);
  });
});
