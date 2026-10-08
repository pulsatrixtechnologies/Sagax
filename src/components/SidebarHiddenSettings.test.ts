import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  items: [] as { kind: string; id: string; at: number }[],
  bots: [] as unknown[],
  groups: [] as unknown[],
}));

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: fixture.bots, groups: fixture.groups, config: null } }) }));
vi.mock("@/lib/perspicax-org", () => ({ useOrgPeople: () => new Map([["pr_ada", { name: "Ada Example", login: "ada" }]]) }));
vi.mock("@/lib/viewer", () => ({ viewerActorId: () => "pr_me" }));
vi.mock("@/lib/sidebar-hidden", async (original) => ({
  ...(await original<typeof import("@/lib/sidebar-hidden")>()),
  useSidebarHidden: () => ({ items: fixture.items, unhideOnMessage: { people: true, bots: false } }),
}));

const { SidebarHiddenSettings } = await import("./SidebarHiddenSettings");

describe("SidebarHiddenSettings", () => {
  it("lists hidden bots and groups, never a closed person conversation", () => {
    fixture.bots = [{ id: "maya", name: "Maya", messages: [] } as unknown as Bot];
    fixture.groups = [
      { id: "ops", name: "Ops", messages: [] } as unknown as Group,
      { id: "dm", name: "dm", peopleDm: true, humanIds: ["pr_me", "pr_ada"], messages: [] } as unknown as Group,
    ];
    fixture.items = [
      { kind: "bot", id: "maya", at: 1 },
      { kind: "group", id: "ops", at: 1 },
      { kind: "person", id: "pr_ada", at: 1 },
    ];
    const html = renderToStaticMarkup(createElement(SidebarHiddenSettings));
    expect(html).toContain("Maya");
    expect(html).toContain("Ops");
    expect(html).not.toContain("Ada Example");
  });

  it("says nothing is hidden, without offering to hide a person", () => {
    fixture.items = [{ kind: "person", id: "pr_ada", at: 1 }];
    const html = renderToStaticMarkup(createElement(SidebarHiddenSettings));
    expect(html).toContain("Right-click a bot or a group to hide it");
    expect(html).not.toContain("a person");
    expect(html).not.toContain("data-settings-hidden");
  });
});
