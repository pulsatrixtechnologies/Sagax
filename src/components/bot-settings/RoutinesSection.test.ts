import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";

// RoutinesSection mounts RoutineEditor from RoutineCalendarPage.tsx (only
// when "New schedule" is clicked, which these tests never do) but that
// module's top-level import of DesktopCapabilities reads `window.ogb` at
// import time; the src test suite runs under vitest's "node" environment
// (no window), so it must be stubbed as SidebarBotListItem.test.ts does.
vi.mock("@/components/DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { host: { homeDir: undefined } } }),
}));

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { routinesLoadState: "ready" }, dispatch: vi.fn() }),
}));

const { RoutinesSection } = await import("./RoutinesSection");

const bot: Bot = {
  id: "bot-1",
  threadId: "thread-1",
  name: "Scout",
  title: "Scout",
  description: "",
  notifications: false,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "local", model: "test-model" },
  messages: [],
};

const activeRoutine: Routine = {
  id: "r1",
  name: "Morning brief",
  prompt: "Summarize overnight news",
  target: "bot",
  botId: bot.id,
  runOn: "maus",
  enabled: true,
  schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] },
  durationMinutes: 5,
  nextRunAt: Date.UTC(2026, 8, 7, 9),
  createdAt: 0,
  updatedAt: 0,
};

const pausedRoutine: Routine = {
  id: "r2",
  name: "Weekly digest",
  prompt: "Summarize the week",
  target: "bot",
  botId: bot.id,
  runOn: "maus",
  enabled: false,
  schedule: { type: "once", at: Date.now() + 86_400_000 },
  durationMinutes: 5,
  nextRunAt: null,
  createdAt: 0,
  updatedAt: 0,
};

const finishedRun: RoutineRun = {
  id: "run-1",
  routineId: "r1",
  routineName: "Morning brief",
  target: "bot",
  botId: bot.id,
  runOn: "maus",
  scheduledFor: Date.UTC(2026, 8, 6, 9),
  status: "completed",
  manual: false,
  finishedAt: Date.UTC(2026, 8, 6, 9, 2),
  createdAt: Date.UTC(2026, 8, 6, 9),
};

function render(routines: Routine[], runs: RoutineRun[]) {
  return renderToStaticMarkup(
    createElement(RoutinesSection, { bot, routines, runs }),
  );
}

describe("RoutinesSection", () => {
  it("shows an empty state when the bot has no routines", () => {
    const markup = render([], []);
    expect(markup).toContain("No schedules yet.");
  });

  // The bot panel lists each routine with its name, when it runs, and a
  // pause switch. The instruction opens in the detail. Run logs stay separate.
  it("renders each routine's name with its pause switch", () => {
    const markup = render([activeRoutine, pausedRoutine], []);
    expect(markup).toContain("Morning brief");
    expect(markup).toContain("Weekly digest");
    expect(markup).toContain('aria-label="Pause"');
    expect(markup).toContain('aria-label="Resume"');
  });

  it("shows when an enabled routine runs, and marks a disabled one paused", () => {
    const markup = render([activeRoutine, pausedRoutine], []);
    expect(markup).toContain("Every weekday at");
    expect(markup).toContain("· Paused");
    expect(markup).not.toContain(">Active<");
  });

  it("lists the active routine before the paused one", () => {
    const markup = render([pausedRoutine, activeRoutine], []);
    expect(markup.indexOf("Morning brief")).toBeLessThan(markup.indexOf("Weekly digest"));
  });

  it("offers a new schedule and the bot's run logs from the header", () => {
    const markup = render([activeRoutine], [finishedRun]);
    expect(markup).toContain('aria-label="Create schedule"');
    expect(markup).toContain('aria-label="Run logs"');
    expect(markup).not.toContain("Next ");
  });
});
