import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalMode } from "../../shared/approval-mode";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
import { ApprovalModeSelector } from "./ApprovalModeSelector";

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; "data-approval-choice"?: string; "aria-pressed"?: boolean }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

function render(approvalMode: ApprovalMode, driverKind = "codex") {
  const onSelect = vi.fn();
  let tree: ReactNode;
  function Capture() {
    tree = ApprovalModeSelector({ providerName: "Codex", driverKind, approvalMode, onSelect });
    return tree;
  }
  return { html: renderToStaticMarkup(createElement(Capture)), nodes: nodes(tree), onSelect };
}

describe("simple approval choices", () => {
  it("offers ask and decide, and keeps the saved ask pressed", () => {
    const view = render("ask");
    expect(view.html).toContain("Ask me first");
    expect(view.html).toContain("Decide for me");
    expect(view.html).toContain("The bot stops and asks before it acts.");
    expect(view.html).not.toContain("Full access");
    expect(view.html).not.toContain("Auto-accept edits");
    expect(view.html).not.toContain("data-approval-custom");
    const ask = view.nodes.find((node) => node.props["data-approval-choice"] === "ask")!;
    const decide = view.nodes.find((node) => node.props["data-approval-choice"] === "auto")!;
    expect(ask.props["aria-pressed"]).toBe(true);
    expect(decide.props["aria-pressed"]).toBe(false);
    decide.props.onClick!();
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith("auto");
  });

  it("leaves a saved custom level unpressed until one of the two choices", () => {
    const view = render("full");
    expect(view.html).toContain("data-approval-custom");
    expect(view.html).toContain("A custom level is saved.");
    expect(view.nodes.filter((node) => node.props["data-approval-choice"]).every((node) => node.props["aria-pressed"] === false)).toBe(true);
    view.nodes.find((node) => node.props["data-approval-choice"] === "ask")!.props.onClick!();
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith("ask");
  });

  it("hides decide when the engine has no auto mode", () => {
    const view = render("ask", "antigravityAgent");
    expect(view.html).toContain('data-approval-choice="ask"');
    expect(view.html).not.toContain('data-approval-choice="auto"');
    expect(view.html).not.toContain("Decide for me");
  });
});
