// The Primary Bot's orange star shows on its avatar wherever the sidebar
// draws it: its own row (SidebarBotListItem.test.ts), a group's member stack
// and a one-bot chat's face, in every density.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
const { StackedMauses } = await import("./Sidebar");

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "claude", model: "test" }, messages: [], ...extra,
});
const badges = (html: string) => html.match(/data-testid="primary-bot-badge"/g)?.length ?? 0;

describe("Primary Bot star in the sidebar's member stacks", () => {
  for (const density of ["comfortable", "compact", "icons"] as const) {
    it(`marks the viewer's Primary Bot in a group stack (${density})`, () => {
      const members = [bot("luna", { chiefOfStaff: true, ownerUserId: "pr_me" }), bot("orion", { ownerUserId: "pr_me" })];
      expect(badges(renderToStaticMarkup(createElement(StackedMauses, { members, density, viewerId: "pr_me" })))).toBe(1);
      expect(badges(renderToStaticMarkup(createElement(StackedMauses, { members: [members[0]!], density, viewerId: "pr_me" })))).toBe(1);
    });
  }

  it("solo: a Primary Bot with no recorded owner (or local-owner) is the viewer's", () => {
    expect(badges(renderToStaticMarkup(createElement(StackedMauses, { members: [bot("luna", { chiefOfStaff: true })], density: "comfortable", viewerId: "local-owner" })))).toBe(1);
    expect(badges(renderToStaticMarkup(createElement(StackedMauses, { members: [bot("luna", { chiefOfStaff: true, ownerUserId: "local-owner" })], density: "comfortable", viewerId: "pr_local" })))).toBe(1);
  });

  it("not someone else's Primary Bot shared with the viewer", () => {
    expect(badges(renderToStaticMarkup(createElement(StackedMauses, { members: [bot("rex", { chiefOfStaff: true, ownerUserId: "pr_bob" })], density: "comfortable", viewerId: "pr_me" })))).toBe(0);
  });
});
