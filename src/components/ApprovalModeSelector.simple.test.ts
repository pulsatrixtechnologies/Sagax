import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalMode } from "../../shared/approval-mode";

const fixture = vi.hoisted(() => ({ open: false, advanced: false }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [fixture.open, (next: boolean | ((current: boolean) => boolean)) => {
    fixture.open = typeof next === "function" ? next(fixture.open) : next;
  }],
}));
import { ApprovalModeSelector } from "./ApprovalModeSelector";

type Node = ReactElement<{
  children?: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; role?: string;
  "data-approval-choice"?: string; "data-approval-mode"?: string; "aria-pressed"?: boolean; "aria-checked"?: boolean;
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
  return { html, nodes: all, onSelect };
}

beforeEach(() => { fixture.open = false; fixture.advanced = false; });

function inMode(advanced: boolean, ...args: Parameters<typeof render>) {
  fixture.advanced = advanced;
  try {
    return render(...args);
  } finally {
    fixture.advanced = false;
  }
}

// JC, 2026-10-14: the composer's approval icon stays in both modes; its menu
// offers the bot settings' two choices in Simple, the five levels in
// Advanced.
describe("approval control in the composer", () => {
  it.each([undefined, "ask", "auto", "full", "custom"] as const)("renders the same icon in Simple and Advanced (%s)", (mode) => {
    const simple = inMode(false, mode);
    expect(simple.html).toBe(inMode(true, mode).html);
    expect(simple.html).not.toContain("data-approval-simple");
    expect(simple.html).toContain('aria-haspopup="menu"');
  });

  it("shows a warning sign for Full access in Simple mode", () => {
    expect(inMode(false, "full").html).toContain("lucide-triangle-alert");
  });

  it("offers two choices in Simple, checks the saved one, and applies a pick", () => {
    fixture.open = true;
    const simple = inMode(false, "ask");
    expect(simple.html).toContain('role="menu"');
    const choices = simple.nodes.filter((node) => node.props["data-approval-choice"]);
    expect(choices.map((node) => node.props["data-approval-choice"])).toEqual(["ask", "auto"]);
    expect(simple.nodes.some((node) => node.props["data-approval-mode"])).toBe(false);
    expect(simple.html).toContain("Ask me first");
    expect(simple.html).toContain("Decide for me");
    expect(simple.html).not.toContain("Full access");
    expect(choices.map((node) => node.props["aria-checked"])).toEqual([true, false]);
    choices[1]!.props.onClick!();
    expect(simple.onSelect).toHaveBeenCalledExactlyOnceWith("auto");
  });

  it("keeps the five levels in Advanced", () => {
    fixture.open = true;
    const advanced = inMode(true, "ask");
    const rows = advanced.nodes.filter((node) => node.props["data-approval-mode"]).map((node) => node.props["data-approval-mode"]);
    expect(rows).toContain("full");
    expect(rows.length).toBeGreaterThan(2);
    expect(advanced.nodes.some((node) => node.props["data-approval-choice"])).toBe(false);
  });

  it("says a saved custom level stays, with neither choice checked, in Simple", () => {
    fixture.open = true;
    const simple = inMode(false, "full");
    expect(simple.html).toContain("data-approval-custom");
    expect(simple.nodes.filter((node) => node.props["data-approval-choice"]).every((node) => node.props["aria-checked"] === false)).toBe(true);
  });

  it("offers Ask alone when the engine has no Auto level (Antigravity)", () => {
    fixture.open = true;
    const simple = inMode(false, "ask", { driverKind: "antigravityAgent" });
    const choices = simple.nodes.filter((node) => node.props["data-approval-choice"]).map((node) => node.props["data-approval-choice"]);
    expect(choices).toEqual(["ask"]);
  });

  it("is disabled with the busy reason while the bot works, in both modes", () => {
    const simple = inMode(false, "ask", { disabled: true });
    expect(simple.html).toBe(inMode(true, "ask", { disabled: true }).html);
    expect(simple.html).toContain('title="Stop this bot&#x27;s turn before changing its approval level"');
  });
});

describe("simple approval choices in bot settings", () => {
  it("stacks ask and decide, keeps the saved one pressed, and applies a click", () => {
    const view = render("ask", { wide: true });
    expect(view.html).toContain("data-approval-simple");
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
