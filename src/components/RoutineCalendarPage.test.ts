import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import type { RoutineRun } from "@/lib/routines";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { state: undefined as AppState | undefined, dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state ?? original.initialState, dispatch: fixture.dispatch }) };
});
// The real useDesktopCapabilities rides along: it only asks this module for the
// window chrome, and these tests render the desktop-neutral layout.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { initialState } = await import("@/state/store");
const { RoutinesPage, RoutineEditor, EventDetails } = await import("./RoutineCalendarPage");

const bot: Bot = {
  id: "runner", threadId: "execution", name: "Runner", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
};
const failed: RoutineRun = {
  id: "failed-run", routineId: "broken", routineName: "Broken report", target: "bot", botId: bot.id,
  runOn: "maus", scheduledFor: 100, createdAt: 100, status: "failed", manual: false, error: "Provider crashed",
};
const missed: RoutineRun = { ...failed, id: "missed-run", routineId: "stale", routineName: "Stale digest", status: "missed" };
const completed: RoutineRun = { ...failed, id: "fine-run", routineId: "fine", routineName: "Fine brief", status: "completed" };

type Button = { "aria-label"?: string; title?: string; children?: ReactNode; onClick?: () => void };
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return Children.toArray(node).map((child) => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : textOf(child)).join("");
}

/** Capture the real page's returned controls under React's hook dispatcher. */
function buttonsFrom(render: () => ReactNode): Map<string, Button> {
  const buttons = new Map<string, Button>();
  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement<Button>(child)) return;
      if (child.type === "button") buttons.set(child.props["aria-label"] ?? child.props.title ?? textOf(child.props.children), child.props);
      visit(child.props.children);
    });
  }
  function Capture() { visit(render()); return null; }
  renderToStaticMarkup(createElement(Capture));
  return buttons;
}

function page() {
  return buttonsFrom(() => RoutinesPage({ onBack: vi.fn(), onOpenRoom: vi.fn() }));
}

function markupOf() {
  function Capture() { return RoutinesPage({ onBack: vi.fn(), onOpenRoom: vi.fn() }); }
  return renderToStaticMarkup(createElement(Capture));
}

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.state = { ...initialState, bots: [bot], routineRuns: [failed, missed, completed] };
});
afterAll(() => vi.unstubAllGlobals());

describe("routine failure indicators", () => {
  it("shows the errors pill and mark-all control only while failures are unread", () => {
    const buttons = page();
    expect(textOf(buttons.get("Open problem run logs")!.children)).toBe("2");
    expect(buttons.has("Mark all as read")).toBe(true);

    fixture.state = { ...initialState, bots: [bot], routineRuns: [
      { ...failed, seenAt: 1 }, { ...missed, seenAt: 1 }, completed,
    ] };
    const read = markupOf();
    expect(read).not.toContain('aria-label="Open problem run logs"');
    expect(read).not.toContain('aria-label="Mark all as read"');
  });

  it("clears every failure indicator in one action from the header", () => {
    page().get("Mark all as read")!.onClick!();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "markAllRoutineRunsSeen" });
  });

  it("opens the logs on the shared problems set from the errors pill", () => {
    page().get("Open problem run logs")!.onClick!();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "showRoutines", section: "logs", runStatus: "problems" });
  });

  it("lands the focused problems filter on the logs instead of every status", () => {
    fixture.state = { ...initialState, bots: [bot], routineRuns: [failed, missed, completed],
      routinesFocus: { section: "logs", runStatus: "problems", nonce: 1 } };
    const markup = markupOf();
    expect(markup).toContain("Broken report");
    expect(markup).toContain("Stale digest");
    expect(markup).not.toContain("Fine brief");
    expect(markup).toContain('<option value="problems" selected="">Problems</option>');
  });
});

describe("routine setup", () => {
  function editorMarkup() {
    function Capture() { return createElement(RoutineEditor, { bots: [bot], lockedBotId: bot.id, onClose: vi.fn() }); }
    return renderToStaticMarkup(createElement(Capture));
  }
  it("runs on the bot's current setup without offering a runner choice", () => {
    const html = editorMarkup();
    expect(html).not.toContain("current setup");
    expect(html).not.toContain("Boat-hosted agent");
    expect(html).not.toContain("data-routine-run-on");
  });
  it("offers the Boat runner only behind the experimental Boat flag", () => {
    fixture.state = { ...fixture.state!, config: { ...fixture.state!.config, features: { boatComputer: true }, box: { configured: false } } as unknown as AppState["config"] };
    expect(editorMarkup()).toContain("Boat-hosted agent");
  });
});

describe("the routine details modal (JC, 2026-10-08: larger, less vertical)", () => {
  const routine = {
    id: "dispatch", name: "Dispatch matin TN", prompt: "Read the board.\n".repeat(40), target: "bot", botId: bot.id, runOn: "maus", enabled: true,
    schedule: { type: "daily", time: "06:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1,
    runAs: { principalId: "pr_bob", name: "Bob" },
  } as unknown as import("@/lib/routines").Routine;
  function details(prompt: string) {
    const item = { kind: "routine" as const, id: "dispatch", at: Date.parse("2026-10-09T10:00:00Z"), durationMinutes: 30, routine: { ...routine, prompt }, run: null };
    return renderToStaticMarkup(createElement(EventDetails, { item, bots: [bot], onClose: vi.fn(), onEdit: vi.fn(), onCallChanged: vi.fn(), onOpenRoom: vi.fn() }));
  }

  it("is wide with two columns: schedule, bot and Runs as on the left, the instructions on the right, each scrolling", () => {
    const html = details(routine.prompt);
    expect(html).toContain('data-event-details="two-column"');
    expect(html).toContain("min-[720px]:w-[min(92vw,960px)]");
    expect(html).toContain("max-h-[calc(100dvh-24px)]");
    expect(html).toContain("min-[720px]:grid-cols-[320px_minmax(0,1fr)]");
    const side = html.indexOf("data-event-details-side");
    const instructions = html.indexOf("data-event-details-instructions");
    expect(side).toBeGreaterThan(-1);
    expect(instructions).toBeGreaterThan(side);
    // the left column carries the schedule, the bot and who it runs as
    const left = html.slice(side, instructions);
    expect(left).toContain("Assigned bot");
    expect(left).toContain("Runner");
    expect(left).toContain("data-event-details-run-as");
    expect(left).toContain("Bob");
    expect(left).not.toContain("Read the board.");
    // the instructions read in a measure, scrolling on their own
    const right = html.slice(instructions);
    expect(right).toContain("max-w-[68ch]");
    expect(right).toContain("min-[720px]:overflow-y-auto");
    expect(right).toContain("Read the board.");
    // the footer stays full width with its buttons
    expect(html.indexOf("Run now")).toBeGreaterThan(instructions);
  });

  it("falls back to one column under 720 px (and with nothing to read)", () => {
    const html = details(routine.prompt);
    // without the 720 px variant the dialog keeps the narrow single column
    expect(html).toMatch(/class="[^"]*\bmax-w-\[520px\] min-\[720px\]:w-\[min\(92vw,960px\)\] min-\[720px\]:max-w-none/);
    expect(html).not.toMatch(/class="[^"]*(?<!min-\[720px\]:)\bgrid-cols-\[320px/);
    const empty = details("");
    expect(empty).toContain('data-event-details="single"');
    expect(empty).not.toContain("data-event-details-instructions");
    expect(empty).not.toContain("min-[720px]:grid");
  });
});
