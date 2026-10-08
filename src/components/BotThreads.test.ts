import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, type Bot, type Group } from "@/state/store";
import { GroupThreadList } from "./Sidebar";
import { formatUpdatedAt } from "./SidebarThreadRow";
import { GroupTaskPicker, TaskPicker } from "./TaskPicker";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
// The header pickers follow the threads setting; server rendering reads it as off.
const threads = vi.hoisted(() => ({ show: false }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => threads.show,
}));
beforeEach(() => { threads.show = false; });

const bot: Bot = {
  id: "maus", threadId: "idle", name: "Maus", title: "", description: "", notifications: true,
  color: "green", unread: true, busy: true, activity: "working", messages: [],
  modelSelection: { instanceId: "fake", model: "test" },
  tasks: [
    { threadId: "idle", title: "Quick question", createdAt: 1, busy: false, activity: "idle" },
    { threadId: "working", title: "Long research", createdAt: 2, busy: true, activity: "working" },
    { threadId: "waiting", title: "Needs approval", createdAt: 3, busy: true, activity: "waiting-on-you", unread: true },
  ],
};

describe("bot and room thread pickers", () => {
  it("keeps All threads accessible even with one thread so its history actions remain reachable", () => {
    threads.show = true;
    const render = (candidate: Bot) => renderToStaticMarkup(createElement(StoreProvider, null, createElement(TaskPicker, { bot: candidate })));
    expect(render(bot)).toContain('aria-label="All threads"');
    const single = render({ ...bot, tasks: [bot.tasks![1]!] });
    expect(single).toContain("All threads");
    expect(single).not.toContain('disabled=""');
  });

  it("exposes group history through the same nested thread rows and All threads picker", () => {
    const group: Group = { id: "team", threadId: "group-current", name: "Launch team", memberIds: [], defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: 1, messages: [],
      tasks: [{ threadId: "group-current", title: "Launch plan", createdAt: 3 }, { threadId: "group-old", title: "Previous review", createdAt: 2 }] };
    const markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupThreadList, { group, selected: true })));
    expect(markup).toContain('aria-label="Launch team threads"');
    expect(markup).toContain('data-sidebar-thread-row="group-current" aria-current="page"');
    expect(markup).toContain("Previous review");
    // New thread lives on the room row now, not at the end of the list
    expect(markup).not.toContain("New thread");
    // The header picker follows the threads setting, like the bot's.
    expect(renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupTaskPicker, { group })))).toBe("");
    threads.show = true;
    const picker = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupTaskPicker, { group })));
    expect(picker).toContain('aria-label="All threads"');
    expect(picker).not.toContain("Tasks");
    const working = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupThreadList, { group: { ...group, working: true }, selected: true })));
    expect(working).toContain(`title="Launch plan · ${formatUpdatedAt(3)} · Working"`);
  });
});
