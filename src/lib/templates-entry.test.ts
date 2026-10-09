// The Templates library is gone: every way that opened it now opens Browse
// Bots on its Templates section (src/lib/templates-entry.ts). Connect apps'
// "Bot templates", New bot's "Browse templates", the sidebar's Templates
// place and an install link all go through templatesEntryActions.
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: () => new Promise(() => {}), useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch }) };
});

import { initialState, reducer } from "@/state/store";
import { BotCreationDraft, EMPTY_BOT_DEFAULTS } from "@/lib/bot-creation-draft";
import { StartingRole } from "@/components/NewBotDialog";
import { PluginsPanel } from "@/components/PluginsPanel";
import { ConnectAppsView } from "@/components/plugins/ConnectAppsView";
import { templatesEntryActions } from "./templates-entry";

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; onBotTemplates?: () => void; "data-new-bot-browse-templates"?: string }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

const templates = { type: "openBotCatalog", section: "templates" };

describe("the old Templates entry points", () => {
  it("close what they sit in, then open Browse Bots on Templates", () => {
    expect(templatesEntryActions("connectApps")).toEqual([{ type: "togglePlugins", open: false }, templates]);
    expect(templatesEntryActions("newBot")).toEqual([{ type: "toggleNewBot", open: false }, templates]);
    expect(templatesEntryActions("sidebar")).toEqual([templates]);
    expect(templatesEntryActions("installLink", "https://github.com/acme/team")).toEqual([{ ...templates, installUrl: "https://github.com/acme/team" }]);
  });

  it("leave the store with the catalogue open on Templates, and New bot or Connect apps closed", () => {
    const busy = { ...initialState, newBotOpen: true, pluginsOpen: true };
    for (const entry of ["connectApps", "newBot", "sidebar"] as const) {
      const after = templatesEntryActions(entry).reduce(reducer, busy);
      expect(after.botCatalogOpen).toBe(true);
      expect(after.botCatalogTarget).toEqual({ section: "templates" });
      if (entry === "newBot") expect(after.newBotOpen).toBe(false);
      if (entry === "connectApps") expect(after.pluginsOpen).toBe(false);
    }
    const linked = templatesEntryActions("installLink", "openmaus://install?u=x").reduce(reducer, initialState);
    expect(linked.botCatalogTarget).toEqual({ section: "templates", installUrl: "openmaus://install?u=x" });
    // The catalogue's home view (the mascot menu, To:) forgets the target.
    expect(reducer(linked, { type: "closeBotCatalog" }).botCatalogTarget).toBeNull();
  });

  it("New bot's Browse templates button dispatches them (not in the defaults editor)", () => {
    fixture.dispatch.mockReset();
    const draft = new BotCreationDraft(EMPTY_BOT_DEFAULTS, () => {});
    let tree!: ReturnType<typeof StartingRole>;
    const html = renderToStaticMarkup(createElement(() => { tree = StartingRole({ draft, defaultsMode: false }); return tree; }));
    expect(html).toContain(">Browse templates</button>");
    nodes(tree).find((node) => node.props["data-new-bot-browse-templates"] !== undefined)?.props.onClick?.();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual(templatesEntryActions("newBot"));
    expect(renderToStaticMarkup(createElement(() => StartingRole({ draft, defaultsMode: true })))).not.toContain("Browse templates");
  });

  it("Connect apps' Bot templates button dispatches them", () => {
    fixture.dispatch.mockReset();
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    let tree!: ReturnType<typeof PluginsPanel>;
    renderToStaticMarkup(createElement(() => { tree = PluginsPanel(); return null; }));
    const view = nodes(tree).find((node) => node.type === ConnectAppsView);
    expect(view?.props.onBotTemplates).toBeTypeOf("function");
    view!.props.onBotTemplates!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual(templatesEntryActions("connectApps"));
    vi.unstubAllGlobals();
  });
});
