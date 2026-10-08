import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot, type Group } from "@/state/store";
import { applyPersonLabel, resetPersonLabelsForTests } from "@/lib/person-labels";

vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
  useMacInsetChrome: () => ({}),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));

const { LabelTag, PersonLabelTag } = await import("./LabelTag");
const { BotListItem, GroupListItem } = await import("./Sidebar");
const { GroupView } = await import("./GroupView");
const { ChannelMembers } = await import("./ChannelMembers");

// The bot row's own pattern (SidebarBotListItem.test.ts): the tag beside
// the name, in the row's 46% budget.
const rowTag = /<span class="max-w-\[46%\] shrink truncate rounded-\[5px\] border border-sidebar-hairline bg-sidebar-hover px-1\.5 text-\[11px\] leading-4 text-sidebar-ink-secondary">([^<]*)<\/span>/;
const surfaceTag = /<span class="max-w-\[(?:40|46)%\] shrink truncate rounded-\[5px\] border border-hairline-weak bg-hover px-1\.5 text-\[11px\] leading-4 text-ink-secondary">([^<]*)<\/span>/;

const dm: Group = {
  id: "dm-ada", threadId: "dm-thread", name: "Ada", memberIds: [], peopleDm: true,
  humanIds: ["local-owner", "pr_ada"], defaultResponder: { kind: "mentions" }, bulletin: "",
  unread: false, createdAt: 1, messages: [],
};
const bot = (title: string): Bot => ({
  id: "atlas", threadId: "thread-atlas", name: "Atlas", title, description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "claude", model: "test" }, messages: [],
});
const inStore = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(StoreProvider, null, node));

describe("a person's label", () => {
  beforeEach(() => resetPersonLabelsForTests({ pr_ada: "CTO" }));
  afterEach(() => {
    resetPersonLabelsForTests();
    vi.unstubAllGlobals();
  });

  it("is drawn with the bot label's tag: same markup for a bot and a person", () => {
    const botRow = inStore(createElement(BotListItem, { bot: bot("CTO"), density: "comfortable", onMenu: vi.fn() }));
    const personRow = inStore(createElement(GroupListItem, { group: dm, density: "comfortable", onMenu: vi.fn() }));
    expect(rowTag.exec(botRow)?.[0]).toBe(rowTag.exec(personRow)?.[0]);
    expect(rowTag.exec(personRow)?.[1]).toBe("CTO");
    expect(personRow.indexOf(">CTO<")).toBeGreaterThan(personRow.indexOf(">Ada<"));
  });

  it("renders nothing without a label, in quiet rows and for a room", () => {
    resetPersonLabelsForTests();
    expect(rowTag.test(inStore(createElement(GroupListItem, { group: dm, density: "comfortable", onMenu: vi.fn() })))).toBe(false);
    resetPersonLabelsForTests({ pr_ada: "CTO" });
    expect(rowTag.test(inStore(createElement(GroupListItem, { group: dm, density: "comfortable", quiet: true, onMenu: vi.fn() })))).toBe(false);
    const room: Group = { ...dm, id: "room", peopleDm: false, name: "Launch" };
    expect(inStore(createElement(GroupListItem, { group: room, density: "comfortable", onMenu: vi.fn() }))).not.toContain(">CTO<");
    expect(renderToStaticMarkup(createElement(LabelTag, { text: "  " }))).toBe("");
    expect(renderToStaticMarkup(createElement(PersonLabelTag, { principalId: "pr_nobody" }))).toBe("");
    // never an "Add a label" in a row
    expect(inStore(createElement(GroupListItem, { group: dm, density: "comfortable", onMenu: vi.fn() }))).not.toContain("Add a label");
  });

  it("shows in the conversation header chip, after the name", () => {
    vi.stubGlobal("window", { ogb: undefined });
    const markup = inStore(createElement(GroupView, { group: dm }));
    const chip = markup.slice(markup.indexOf('data-open-person="pr_ada"'), markup.indexOf("</button>", markup.indexOf('data-open-person="pr_ada"')));
    expect(surfaceTag.exec(chip)?.[1]).toBe("CTO");
  });

  it("shows in a room's member list beside the person's name, not beside a bot", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [{ id: "pr_ada", label: "Ada" }, { id: "pr_bob", label: "Bob" }],
      bots: [{ id: "aurora", name: "Aurora" }],
      canAddHuman: false,
      canAddBot: false,
    }));
    expect(surfaceTag.exec(html)?.[1]).toBe("CTO");
    expect(html.match(new RegExp(surfaceTag.source, "g"))).toHaveLength(1);
    expect(html.indexOf(">CTO<")).toBeGreaterThan(html.indexOf(">Ada<"));
  });

  it("follows a person.label frame (applyPersonLabel, called by the store)", () => {
    applyPersonLabel("pr_ada", "Dispatch");
    expect(rowTag.exec(inStore(createElement(GroupListItem, { group: dm, density: "comfortable", onMenu: vi.fn() })))?.[1]).toBe("Dispatch");
  });
});
