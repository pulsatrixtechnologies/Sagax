import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot, Group } from "@/state/store";

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: null }, dispatch: vi.fn() }),
}));
vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: true }),
}));
vi.mock("./ExportTranscriptMenu", () => ({ ExportTranscriptMenu: () => null }));

import { GroupPanel } from "./GroupPanel";

const group = { id: "room", name: "Ops", bulletin: "Be brief.", memberIds: [], messages: [], defaultResponder: { kind: "auto" } } as unknown as Group;
const members: Bot[] = [];
const render = (props: Partial<Parameters<typeof GroupPanel>[0]>) =>
  renderToStaticMarkup(createElement(GroupPanel, { group, members, details: null, advanced: null, canEdit: true, ...props }));

describe("group panel", () => {
  it("has no setup entry: every setting lives in its tabs", () => {
    const html = render({ advanced: createElement("p", null, "responder and folder") });
    expect(html).toContain('data-panel-tab="details"');
    expect(html).toContain('data-panel-tab="instructions"');
    expect(html).toContain('data-panel-tab="advanced"');
    expect(html).not.toContain("Set up group");
    expect(html).not.toContain('aria-haspopup="dialog"');
  });

  it("drops the Advanced tab when there is nothing to show there", () => {
    expect(render({ advanced: null })).not.toContain('data-panel-tab="advanced"');
  });

  it("says why it is read-only for someone who does not own the group", () => {
    const html = render({ canEdit: false, readOnlyNote: true });
    expect(html).toContain("Only the group&#x27;s owner can change these settings.");
    expect(html).not.toContain('id="group-name-room"');
  });
});
