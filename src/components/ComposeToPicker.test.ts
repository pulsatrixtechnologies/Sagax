import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { initialState, type Bot } from "@/state/store";
import { composeRows } from "./ComposeToPicker";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), bots: [] as Bot[] }));
vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ dragStyle: undefined, noDragStyle: undefined, controlsShiftStyle: undefined }),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: fixture.bots, botCreationPending: false },
      dispatch: fixture.dispatch,
    }),
  };
});

import { ComposeToPicker } from "./ComposeToPicker";

function person(id: string, name: string, extra: Partial<Bot> = {}): Bot {
  return {
    id, threadId: id, name, title: "", description: "", notifications: true, color: "green", unread: false,
    modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
  };
}

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; "data-compose-action"?: string; "data-compose-bot"?: string }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

describe("ComposeToPicker", () => {
  it("lists create actions and own bots in the main column, not a dialog", () => {
    fixture.bots = [
      person("aurora", "Aurora"),
      person("hidden-bot", "Hidden", { hidden: true }),
      person("vendor", "Vendor", { ownerUserId: "someone-else" }),
    ];
    fixture.dispatch.mockReset();
    const close = vi.fn();
    let tree!: ReturnType<typeof ComposeToPicker>;
    const html = renderToStaticMarkup(createElement(() => { tree = ComposeToPicker({ onClose: close }); return tree; }));
    expect(html).toContain("To:");
    expect(html).toContain("Search or create Bots");
    expect(html).toContain("Create new Bot");
    expect(html).toContain("Create group chat");
    expect(html).toContain("Aurora");
    expect(html).not.toContain("Hidden");
    expect(html).not.toContain("Vendor");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("fixed inset-0");
    expect(html).toContain("data-compose-to");
    expect(html).toContain("pointer-events-none");
    expect(html).not.toContain("h-full min-w-0 flex-1 flex-col bg-app");
    const rendered = nodes(tree);
    rendered.find((node) => node.props["data-compose-action"] === "create-bot")?.props.onClick?.();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newBot" });
    expect(close).toHaveBeenCalled();
    fixture.dispatch.mockReset();
    rendered.find((node) => node.props["data-compose-bot"] === "aurora")?.props.onClick?.();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newTask", botId: "aurora" });
    fixture.dispatch.mockReset();
    rendered.find((node) => node.props["data-compose-action"] === "create-group")?.props.onClick?.();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("puts the group confirm row ahead of the bots", () => {
    const bots = [person("a", "Ara"), person("b", "Liora")];
    expect(composeRows("browse", bots).map((row) => row.kind === "bot" ? row.bot.id : row.kind)).toEqual(["create-bot", "create-group", "a", "b"]);
    expect(composeRows("group", bots).map((row) => row.kind === "bot" ? row.bot.id : row.kind)).toEqual(["create-group", "a", "b"]);
    expect(initialState.newBotOpen).toBe(false);
  });
});
