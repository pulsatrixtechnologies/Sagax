import { createElement, isValidElement, Children, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n";
import {
  TASK_PICKER_DISMISS_MS,
  ThreadActionsPanel,
  type PickerThreadActions,
  filterTasks,
  groupThreadTasks,
  taskPickerPointerIntent,
} from "./TaskPicker";

describe("taskPickerPointerIntent", () => {
  it("treats a single click as switch, not rename", () => {
    expect(taskPickerPointerIntent("click", 1)).toBe("select");
    expect(taskPickerPointerIntent("click")).toBe("select");
  });

  it("does not let the click that accompanies a double-click close the row", () => {
    // HTML fires click (detail=1), click (detail=2), then dblclick. Closing
    // on the first of those unmounts the menu before rename can start.
    expect(taskPickerPointerIntent("click", 2)).toBe("ignore");
    expect(taskPickerPointerIntent("dblclick", 2)).toBe("rename");
  });

  it("starts a rename from right-click", () => {
    expect(taskPickerPointerIntent("contextmenu")).toBe("rename");
  });

  it("ignores unrelated events", () => {
    expect(taskPickerPointerIntent("mousedown")).toBe("ignore");
  });
});

describe("project thread grouping", () => {
  const projects = [{ id: "work", name: "Research" }, { id: "personal", name: "Home" }];
  const tasks = [
    { threadId: "1", title: "Draft report", createdAt: 4, projectId: "work" },
    { threadId: "2", title: "Plan trip", createdAt: 3, projectId: "personal" },
    { threadId: "3", title: "Report sources", createdAt: 2, projectId: "work" },
    { threadId: "4", title: "Quick question", createdAt: 1 },
    { threadId: "5", title: "Old project thread", createdAt: 0, projectId: "deleted" },
  ];
  it("groups existing folders and keeps legacy/orphaned threads under No folder", () => {
    expect(groupThreadTasks(tasks, projects, "").map((group) => [group.project.name, group.tasks.map((task) => task.threadId)]))
      .toEqual([["Research", ["1", "3"]], ["Home", ["2"]], ["No folder", ["4", "5"]]]);
  });
  it("searches project names as well as thread titles without hiding matching older threads", () => {
    expect(groupThreadTasks(tasks, projects, "RESEARCH").flatMap((group) => group.tasks.map((task) => task.threadId))).toEqual(["1", "3"]);
    expect(groupThreadTasks(tasks, projects, "report").flatMap((group) => group.tasks.map((task) => task.threadId))).toEqual(["3", "1"]);
    expect(groupThreadTasks(tasks, projects, "missing")).toEqual([]);
  });
  it("retains persisted folder order and icons without changing thread membership", () => {
    const reversed = [{ ...projects[1]!, emoji: "🏠" }, projects[0]!];
    const grouped = groupThreadTasks(tasks, reversed, "");
    expect(grouped.map((group) => group.project.id)).toEqual(["personal", "work", ""]);
    expect(grouped[0]?.project.emoji).toBe("🏠");
    expect(grouped[0]?.tasks.map((task) => task.threadId)).toEqual(["2"]);
  });
});

describe("task picker copy", () => {
  it("advertises both gestures the row actually handles", () => {
    // the hint moved into the catalog with the rest of the picker's copy
    expect(t("task.renameHint")).toContain("double-click");
    expect(t("task.renameHint")).toContain("right-click");
    expect(TASK_PICKER_DISMISS_MS).toBeGreaterThanOrEqual(500);
  });

  it("titles the attention section with the active threads name", () => {
    expect(t("attention.title")).toBe("Active Threads");
    expect(t("attention.empty")).toBe("No active threads");
  });
});

describe("filterTasks", () => {
  const tasks = [
    { title: "Clean up" },
    { title: "Sagax Update" },
    { title: "Investment report" },
    { title: "Report drafts" },
  ];

  it("returns the original order when the query is empty", () => {
    expect(filterTasks(tasks, "").map((task) => task.title)).toEqual(tasks.map((task) => task.title));
    expect(filterTasks(tasks, "   ").map((task) => task.title)).toEqual(tasks.map((task) => task.title));
  });

  it("matches titles case-insensitively", () => {
    expect(filterTasks(tasks, "SAGAX").map((task) => task.title)).toEqual(["Sagax Update"]);
  });

  it("ranks prefix hits ahead of substring hits, keeping input order in each tier", () => {
    expect(filterTasks(tasks, "report").map((task) => task.title)).toEqual([
      "Report drafts",
      "Investment report",
    ]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterTasks(tasks, "zzzz")).toEqual([]);
  });
});

describe("picker row actions (moved from the sidebar thread rows)", () => {
  const task = { threadId: "t1", title: "Weekly report", createdAt: 1 };
  const actions = () => ({ onCopyLink: vi.fn(), onRegenerateTitle: vi.fn(), onArchive: vi.fn(), onSnooze: vi.fn(), onRefreshPermissions: vi.fn() });
  const render = (candidate: Parameters<typeof ThreadActionsPanel>[0]["task"], given: PickerThreadActions = actions()) =>
    renderToStaticMarkup(createElement(ThreadActionsPanel, { task: candidate, actions: given, regenerating: false, onRegenerate: vi.fn(), onDone: vi.fn() }));
  function buttons(node: ReactNode): Array<{ props: { onClick?: () => void; children?: ReactNode } }> {
    const found: Array<{ props: { onClick?: () => void; children?: ReactNode } }> = [];
    for (const child of Children.toArray(node)) {
      if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(child)) continue;
      if (child.type === "button") found.push(child);
      found.push(...buttons(child.props.children));
    }
    return found;
  }
  const label = (node: ReactNode) => renderToStaticMarkup(createElement("span", null, node));

  it("offers copy link, regenerate title, archive, snooze and refresh permissions", () => {
    const markup = render(task);
    for (const text of ["Copy link", "Regenerate title", "Archive", "Until new activity", "Refresh permissions"]) expect(markup).toContain(text);
    expect(markup).not.toContain("Stop snoozing");
    expect(markup).not.toContain("Unarchive");
  });

  it("offers the way back for an archived or snoozed thread", () => {
    const markup = render({ ...task, archivedAt: 5, snoozedUntil: 0 });
    expect(markup).toContain("Unarchive");
    expect(markup).toContain("Stop snoozing");
  });

  it("leaves regenerate out where generated titles are off", () => {
    const given = actions();
    const { onRegenerateTitle: _off, ...rest } = given;
    expect(render(task, rest)).not.toContain("Regenerate title");
  });

  it("archives and snoozes the row's own thread", () => {
    const given = actions();
    const onDone = vi.fn();
    const tree = ThreadActionsPanel({ task, actions: given, regenerating: false, onRegenerate: vi.fn(), onDone });
    const all = buttons(tree.props.children);
    all.find((button) => label(button.props.children).includes("Archive"))!.props.onClick!();
    expect(given.onArchive).toHaveBeenCalledWith("t1", expect.any(Number));
    all.find((button) => label(button.props.children).includes("Until new activity"))!.props.onClick!();
    expect(given.onSnooze).toHaveBeenCalledWith("t1", 0);
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
