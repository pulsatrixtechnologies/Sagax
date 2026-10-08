import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  showThreads: true,
  queued: {} as Record<string, unknown[]>,
  bots: [] as Bot[],
  groups: [] as Group[],
  threadReturn: null as null | { ownerId: string; threadId: string },
  dispatch: vi.fn(),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({
    state: { bots: fixture.bots, groups: fixture.groups, pendingQueued: fixture.queued, threadReturn: fixture.threadReturn },
    dispatch: fixture.dispatch,
  }),
}));

const { TaskPicker, BotActivityPicker, GroupTaskPicker, ThreadReturnLink, ThreadsOffReturnLink, botPickerThreads } = await import("./TaskPicker");
const bot: Bot = {
  id: "pepper", name: "Pepper", color: "green", threadId: "current", title: "", description: "",
  notifications: true, unread: false, busy: true, messages: [], modelSelection: { instanceId: "fake", model: "fake" },
  tasks: [
    { threadId: "current", title: "Current chat", createdAt: 1, busy: true, activity: "working" },
    { threadId: "idle", title: "Quiet history", createdAt: 2, busy: false },
    { threadId: "waiting", title: "Approval needed", createdAt: 3, busy: false, activity: "waiting-on-you" },
    { threadId: "working", title: "Research", createdAt: 4, busy: true, activity: "working" },
    { threadId: "queued", title: "Next job", createdAt: 5, busy: false },
    { threadId: "unread", title: "Finished reply", createdAt: 6, unread: true },
  ],
};
beforeEach(() => {
  fixture.showThreads = true;
  fixture.queued = {};
  fixture.bots = [];
  fixture.groups = [];
  fixture.threadReturn = null;
  fixture.dispatch.mockClear();
});

describe("optional bot thread picker", () => {
  it("keeps the usual picker when threads are shown", () => {
    expect(renderToStaticMarkup(createElement(TaskPicker, { bot }))).toContain('aria-label="All threads"');
  });

  it("hides quiet histories and creation but keeps sibling activity reachable", () => {
    fixture.showThreads = false;
    fixture.queued = { queued: [{ queueId: "pending" }] };
    expect(renderToStaticMarkup(createElement(TaskPicker, { bot }))).toBe("");
    const markup = renderToStaticMarkup(createElement(BotActivityPicker, { bot }));
    expect(markup).toContain('aria-label="Other activity (4)"');
    expect(markup).toContain('value="waiting">Approval needed · Waiting');
    expect(markup).toContain('value="working">Research · Working');
    expect(markup).toContain('value="queued">Next job · Queued');
    expect(markup).toContain('value="unread">Finished reply · Unread');
    expect(markup).not.toContain("Quiet history");
    expect(markup).toContain("Current chat");
    expect(markup).not.toContain('value="current"');
    expect(markup).not.toContain("All threads");
    expect(markup).not.toContain("New thread");
    expect(markup).not.toContain("Rename");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("selects the exact sibling without creating or stopping work", () => {
    fixture.showThreads = false;
    const picker = BotActivityPicker({ bot });
    const select = picker!.props.children[0];
    expect(select.type).toBe("select");
    select.props.onChange({ target: { value: "waiting" } });
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "switchTask", botId: "pepper", threadId: "waiting" });
  });

  it("renders nothing when only the selected conversation is working", () => {
    fixture.showThreads = false;
    expect(renderToStaticMarkup(createElement(BotActivityPicker, { bot: { ...bot, tasks: bot.tasks!.slice(0, 2) } }))).toBe("");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("shows the channel picker only while threads are on, as a round header button", () => {
    const group: Group = { id: "team", name: "Team", threadId: "team-current", memberIds: [], defaultResponder: { kind: "everyone" }, bulletin: "", createdAt: 1, unread: false, messages: [],
      tasks: [{ threadId: "team-current", title: "Channel discussion", createdAt: 1 }] };
    const shown = renderToStaticMarkup(createElement(GroupTaskPicker, { group }));
    expect(shown).toContain('aria-label="All threads"');
    expect(shown).toContain("rounded-full border");
    fixture.showThreads = false;
    expect(renderToStaticMarkup(createElement(GroupTaskPicker, { group }))).toBe("");
  });

  it("draws the bot picker as the header's round outlined button", () => {
    const markup = renderToStaticMarkup(createElement(TaskPicker, { bot }));
    expect(markup).toContain("rounded-full border");
    expect(markup).toContain('aria-expanded="false"');
  });
});

describe("the header picker lists only the open bot's threads", () => {
  // Other bots and rooms with threads that need the person: before
  // 2026-10-08 they rode into this picker as an "Active Threads" section.
  const talon: Bot = { ...bot, id: "talon", name: "Talon", threadId: "talon-main", busy: false,
    tasks: [{ threadId: "talon-main", title: "Talon work", createdAt: 1, unread: true }, { threadId: "talon-wait", title: "Talon approval", createdAt: 2, activity: "waiting-on-you" }] };
  const room: Group = { id: "crew", name: "Crew", threadId: "crew-main", memberIds: [], defaultResponder: { kind: "everyone" }, bulletin: "", createdAt: 1, unread: true, messages: [],
    tasks: [{ threadId: "crew-main", title: "Crew chat", createdAt: 1 }] };
  // a thread a peer bot opened on Pepper is still Pepper's thread
  const pepper: Bot = { ...bot, tasks: [...bot.tasks!,
    { threadId: "peer-opened", title: "@Talon · work", createdAt: 7, openedBy: { botId: "talon", name: "Talon", at: 7 } },
    { threadId: "routine-run", title: "Nightly", createdAt: 8, routineRunId: "run-1" }] };

  it("hands the picker this bot's own threads and nothing from other bots or rooms", () => {
    fixture.bots = [pepper, talon];
    fixture.groups = [room];
    const picker = TaskPicker({ bot: pepper })!;
    const ids = (picker.props.tasks as Array<{ threadId: string }>).map((task) => task.threadId);
    expect(new Set(ids)).toEqual(new Set(["current", "idle", "waiting", "working", "queued", "unread", "peer-opened"]));
    expect(ids).not.toContain("talon-main");
    expect(ids).not.toContain("talon-wait");
    expect(ids).not.toContain("crew-main");
    expect(ids).not.toContain("routine-run");
    expect(picker.props).not.toHaveProperty("attention");
    expect(picker.props).not.toHaveProperty("onAttentionJump");
    expect(botPickerThreads(pepper).map((task) => task.threadId)).toEqual(ids);
  });

  it("keeps a peer-opened thread, labelled by who opened it", () => {
    const row = botPickerThreads(pepper).find((task) => task.threadId === "peer-opened");
    expect(row?.openedBy?.name).toBe("Talon");
  });
});

describe("way back to the conversation while threads are hidden", () => {
  const trapped: Bot = {
    ...bot, busy: false, threadId: "extra",
    tasks: [
      { threadId: "main", title: "Weekly report", createdAt: 1, updatedAt: 50 },
      { threadId: "extra", title: "Untitled", createdAt: 60, updatedAt: 60 },
    ],
  };

  it("offers a link back to the latest conversation and switches to it", async () => {
    fixture.showThreads = false;
    const markup = renderToStaticMarkup(createElement(ThreadsOffReturnLink, { bot: trapped }));
    expect(markup).toContain("data-threads-off-return");
    expect(markup).toContain("Back to conversation");
    expect(markup).toContain('title="Weekly report"');
    const { Children, isValidElement } = await import("react");
    type El = { props: { onClick?: () => void; children?: unknown } };
    const find = (node: unknown): El | undefined => {
      if (!isValidElement(node)) return undefined;
      const el = node as unknown as El;
      if (el.props.onClick) return el;
      for (const child of Children.toArray(el.props.children as never)) { const hit = find(child); if (hit) return hit; }
    };
    let tree: unknown;
    renderToStaticMarkup(createElement(() => { tree = ThreadsOffReturnLink({ bot: trapped }); return tree as never; }));
    find(tree)?.props.onClick?.();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "switchTask", botId: "pepper", threadId: "main" });
  });

  it("offers the conversation a thread chip left, even while threads stay hidden", () => {
    fixture.showThreads = false;
    fixture.bots = [bot];
    fixture.threadReturn = { ownerId: "pepper", threadId: "idle" };
    const markup = renderToStaticMarkup(createElement(ThreadReturnLink, { ownerId: "pepper", threadId: "current" }));
    expect(markup).toContain("data-thread-return");
    expect(markup).toContain("Back to conversation");
    expect(markup).toContain('title="Quiet history"');
    const link = ThreadReturnLink({ ownerId: "pepper", threadId: "current" });
    const button = link?.props.children;
    button.props.onClick();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "switchTask", botId: "pepper", threadId: "idle" });
    expect(renderToStaticMarkup(createElement(ThreadReturnLink, { ownerId: "pepper", threadId: "idle" }))).toBe("");
  });

  it("stays out of the way at home and when threads are shown", () => {
    fixture.showThreads = false;
    expect(renderToStaticMarkup(createElement(ThreadsOffReturnLink, { bot: { ...trapped, threadId: "main" } }))).toBe("");
    fixture.showThreads = true;
    expect(renderToStaticMarkup(createElement(ThreadsOffReturnLink, { bot: trapped }))).toBe("");
  });
});
