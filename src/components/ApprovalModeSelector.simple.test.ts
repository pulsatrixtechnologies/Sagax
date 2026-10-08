import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalMode } from "../../shared/approval-mode";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
const fixture = vi.hoisted(() => ({ open: false }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [fixture.open, (next: boolean | ((current: boolean) => boolean)) => {
    fixture.open = typeof next === "function" ? next(fixture.open) : next;
  }],
}));
import { ApprovalModeSelector, nextMenuIndex } from "./ApprovalModeSelector";

type Node = ReactElement<{
  children?: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; role?: string;
  "data-approval-choice"?: string; "data-approval-chip"?: boolean; "aria-pressed"?: boolean; "aria-checked"?: boolean;
}>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

function render(approvalMode: ApprovalMode | undefined, { driverKind = "codex", wide = false, disabled = false, autoApprove }: {
  driverKind?: string; wide?: boolean; disabled?: boolean; autoApprove?: boolean;
} = {}, onSelect = vi.fn()) {
  let tree: ReactNode;
  function Capture() {
    tree = ApprovalModeSelector({ providerName: "Codex", driverKind, approvalMode, autoApprove, onSelect, wide, disabled, align: "right" });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  const all = nodes(tree);
  return { html, nodes: all, onSelect, chip: all.find((node) => node.props["data-approval-chip"]) };
}

beforeEach(() => { fixture.open = false; });

describe("simple approval chip in the composer", () => {
  it("is one chip with the current mode, never the two cards", () => {
    const view = render("auto");
    expect(view.chip).toBeDefined();
    expect(view.html).toContain("Decide for me");
    expect(view.html).not.toContain("Ask me first");
    expect(view.html).not.toContain('role="menu"');
    expect(view.html).not.toContain("data-approval-choice");
    expect(view.html).toContain('aria-haspopup="menu"');
    expect(view.html).toContain("lucide-chevron-down");
    expect(view.html).not.toContain("data-approval-unset");
    expect(render("ask").html).toContain("Ask me first");
  });

  it("opens a menu with both modes, the current one checked, and applies a pick", () => {
    const first = render("ask");
    first.chip!.props.onClick!();
    expect(fixture.open).toBe(true);
    const open = render("ask", {}, first.onSelect);
    expect(open.html).toContain('role="menu"');
    expect(open.html).toContain("The bot stops and asks before it acts.");
    expect(open.html).toContain("The bot acts, and checks in when unsure.");
    expect(open.html).not.toContain("Full access");
    const ask = open.nodes.find((node) => node.props["data-approval-choice"] === "ask")!;
    const decide = open.nodes.find((node) => node.props["data-approval-choice"] === "auto")!;
    expect(ask.props.role).toBe("menuitemradio");
    expect(ask.props["aria-checked"]).toBe(true);
    expect(decide.props["aria-checked"]).toBe(false);
    decide.props.onClick!();
    expect(first.onSelect).toHaveBeenCalledExactlyOnceWith("auto");
    expect(fixture.open).toBe(false);
  });

  it("marks a bot with no saved level with a dot on the default", () => {
    const view = render(undefined);
    expect(view.html).toContain("data-approval-unset");
    expect(view.html).toContain("Ask me first");
    expect(view.chip!.props.title).toBe("No level chosen yet. The bot uses this default until you pick one.");
  });

  it("names a saved custom level and leaves both choices unchecked", () => {
    fixture.open = true;
    const view = render("full");
    expect(view.html).toContain("Custom level");
    expect(view.html).toContain("A custom level is saved.");
    expect(view.nodes.filter((node) => node.props["data-approval-choice"]).every((node) => node.props["aria-checked"] === false)).toBe(true);
    view.nodes.find((node) => node.props["data-approval-choice"] === "ask")!.props.onClick!();
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith("ask");
  });

  it("is disabled with the busy reason while the bot works, and shows no menu", () => {
    fixture.open = true;
    const view = render("ask", { disabled: true });
    expect(view.chip!.props.disabled).toBe(true);
    expect(view.chip!.props.title).toBe("Stop this bot's turn before changing its approval level");
    expect(view.html).not.toContain('role="menu"');
  });

  it("offers only ask when the engine has no auto mode", () => {
    fixture.open = true;
    const view = render("ask", { driverKind: "antigravityAgent" });
    expect(view.html).toContain('data-approval-choice="ask"');
    expect(view.html).not.toContain('data-approval-choice="auto"');
    expect(view.html).not.toContain("Decide for me");
  });

  it("moves through the rows with the arrows, Home and End", () => {
    expect(nextMenuIndex(-1, 2, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(0, 2, "ArrowDown")).toBe(1);
    expect(nextMenuIndex(1, 2, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(0, 2, "ArrowUp")).toBe(1);
    expect(nextMenuIndex(1, 2, "Home")).toBe(0);
    expect(nextMenuIndex(0, 2, "End")).toBe(1);
    expect(nextMenuIndex(0, 2, "a")).toBeNull();
    expect(nextMenuIndex(0, 0, "ArrowDown")).toBeNull();
  });
});

describe("simple approval choices in bot settings", () => {
  it("stacks ask and decide, keeps the saved one pressed, and applies a click", () => {
    const view = render("ask", { wide: true });
    expect(view.chip).toBeUndefined();
    const ask = view.nodes.find((node) => node.props["data-approval-choice"] === "ask")!;
    const decide = view.nodes.find((node) => node.props["data-approval-choice"] === "auto")!;
    expect(ask.props["aria-pressed"]).toBe(true);
    expect(decide.props["aria-pressed"]).toBe(false);
    decide.props.onClick!();
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith("auto");
  });

  it("leaves a saved custom level unpressed until one of the two choices", () => {
    const view = render("full", { wide: true });
    expect(view.html).toContain("data-approval-custom");
    expect(view.nodes.filter((node) => node.props["data-approval-choice"]).every((node) => node.props["aria-pressed"] === false)).toBe(true);
  });
});
