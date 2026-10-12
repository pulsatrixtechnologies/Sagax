import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  openThread: vi.fn(),
  useStore: () => ({ state: { instances: [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude Code" }] }, dispatch: vi.fn() }),
}));

vi.mock("@/lib/use-bot-activity-feed", () => ({
  useBotActivityFeed: () => ({
    list: {
      items: [{
        id: "run:r1",
        kind: "routine",
        botId: "pepper",
        title: "Tournée de répartition",
        status: "running",
        startedAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
        engine: { instanceId: "claude", model: "claude-sonnet-5" },
        currentStep: "Lecture du tableau",
      }],
      subagents: [],
    },
    error: false,
    refresh: vi.fn(),
    stop: vi.fn(),
    stopping: new Set(),
    now: 1_800_000_090_000,
    live: { visible: () => true, fading: () => false },
    deepLinked: null,
    clearDeepLink: vi.fn(),
  }),
}));

import { BackgroundWorkPanel } from "./BackgroundWorkPanel";
import type { Bot } from "@/state/store";

const bot = { id: "pepper", threadId: "main", name: "Pepper", title: "", description: "", notifications: true, color: "green", unread: false, busy: false, modelSelection: { instanceId: "claude", model: "m" }, approvalMode: "auto", alwaysAllow: [], messages: [] } as Bot;

describe("BackgroundWorkPanel", () => {
  it("draws the ongoing activities rail with provider, status and step", () => {
    const html = renderToStaticMarkup(createElement(BackgroundWorkPanel, { bot }));
    expect(html).toContain('data-background-work-panel=""');
    expect(html).toContain("Ongoing activities");
    expect(html).toContain('data-background-work-card="run:r1"');
    expect(html).toContain("Tournée de répartition");
    expect(html).toContain("Lecture du tableau");
    expect(html).toContain("claude-sonnet-5");
  });
});
