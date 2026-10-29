// @vitest-environment happy-dom
// 2026-10-29: View run under a routine's report, a run's notification and a
// link to a run's execution thread (an Inbox entry) open the run's detail
// (the Routines page, the run open over its logs), never a conversation
// beside the chat. Continue in the conversation stays in the detail.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { RoutineRunCard } from "@/components/RoutineRunCard";
import { initialState, openNotificationTarget, openRoutineRun, openThread, reducer, routineRunOfThread, type Action, type Message } from "./store";

const bot = {
  id: "scout",
  name: "Scout",
  threadId: "main-chat",
  tasks: [
    { threadId: "main-chat", createdAt: 1 },
    { threadId: "run-thread", createdAt: 2, routineRunId: "run-1" },
  ],
};
const state = { bots: [bot], groups: [], routineRuns: [{ id: "run-1" }] };

function report(): Message {
  return {
    id: "report",
    role: "bot",
    kind: "routine.run",
    at: 1,
    routineRun: { runId: "run-1", routineId: "routine-1", routineName: "Project health watch", status: "completed", executionThreadId: "run-thread", summary: "All green." },
  };
}

describe("opening a routine run", () => {
  it("View run opens the run detail on the Routines page, not a split", () => {
    const actions: Action[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const run = report().routineRun!;
    flushSync(() => root.render(createElement(RoutineRunCard, {
      message: report(),
      onOpen: () => openRoutineRun((action) => actions.push(action), { runId: run.runId, routineId: run.routineId }),
    })));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]');
    expect(button).not.toBeNull();
    button!.click();
    expect(actions).toEqual([{ type: "showRoutines", section: "logs", runId: "run-1", routineId: "routine-1" }]);
    // the detail takes the place of the chat: no conversation selected or opened beside it
    const next = reducer(initialState, actions[0]!);
    expect(next.activeView).toBe("routines");
    expect(next.routinesFocus.runId).toBe("run-1");
    expect(next.selectedId).toBe(initialState.selectedId);
    root.unmount();
    host.remove();
  });

  it("offers View run for a run whose execution thread is gone (a deleted routine reads)", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const message = report();
    message.routineRun = { ...message.routineRun!, executionThreadId: undefined };
    flushSync(() => root.render(createElement(RoutineRunCard, { message, onOpen: () => {} })));
    expect(host.textContent).toContain("View run");
    root.unmount();
  });

  it("a run's notification opens its detail, not its report conversation", () => {
    const actions: Action[] = [];
    openNotificationTarget((action) => actions.push(action), { botId: "scout", threadId: "main-chat", routineRunId: "run-1" }, state, false);
    expect(actions).toEqual([{ type: "showRoutines", section: "logs", runId: "run-1" }]);
  });

  it("a link to a run's execution thread (an Inbox entry) opens the run detail", () => {
    const actions: Action[] = [];
    expect(routineRunOfThread(state, "run-thread")).toBe("run-1");
    openNotificationTarget((action) => actions.push(action), { botId: "scout", threadId: "run-thread" }, state, false);
    expect(actions).toEqual([{ type: "showRoutines", section: "logs", runId: "run-1" }]);
  });

  it("a run this client does not know keeps opening its thread", () => {
    const actions: Action[] = [];
    openNotificationTarget((action) => actions.push(action), { botId: "scout", threadId: "main-chat", routineRunId: "run-gone" }, state, false);
    expect(actions.some((action) => action.type === "showRoutines")).toBe(false);
  });

  it("the owner's access notification (no thread) still opens the bot's activity", () => {
    const actions: Action[] = [];
    openNotificationTarget((action) => actions.push(action), { botId: "scout", threadId: "", routineRunId: "run-1" }, state, false);
    expect(actions).toEqual([{ type: "openBotActivity", botId: "scout", itemId: "run:run-1" }]);
  });

  it("openThread (Continue in the conversation) still opens the thread itself", () => {
    const actions: Action[] = [];
    openThread((action) => actions.push(action), { botId: "scout", threadId: "run-thread" }, state, true);
    expect(actions.some((action) => action.type === "showRoutines")).toBe(false);
  });
});
