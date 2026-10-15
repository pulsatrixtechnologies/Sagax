// The bot menu's "Move to ›" submenu (JC, 2026-10-15): the teams there are,
// a check on the bot's own, No team, then New team… typed in the menu.
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { MoveToTeamList } from "./Sidebar";

type Clickable = ReactElement<{ onClick?: () => void; "data-move-target"?: string; "data-move-new"?: string }>;

/** The list's buttons, rendered once as React elements. */
function elements(props: Parameters<typeof MoveToTeamList>[0]): Clickable[] {
  const found: Clickable[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isValidElement(node)) return;
    if (node.type === "button") found.push(node as Clickable);
    walk((node.props as { children?: ReactNode }).children);
  };
  // Render the component function directly to reach its handlers.
  const tree = (MoveToTeamList as unknown as (p: typeof props) => ReactNode);
  let output: ReactNode = null;
  function Capture() { output = tree(props); return output as ReactElement; }
  renderToStaticMarkup(createElement(Capture));
  walk(output);
  return found;
}

beforeEach(() => setLocale("en"));

describe("Move to › submenu", () => {
  it("lists the teams, checks the bot's own, then No team and New team…", () => {
    const html = renderToStaticMarkup(createElement(MoveToTeamList, { sections: ["Ops", "Sales"], current: "Ops", onAssign: () => {} }));
    expect([...html.matchAll(/data-move-target="([^"]*)"/g)].map((m) => m[1])).toEqual(["Ops", "Sales", ""]);
    expect(html).toMatch(/aria-checked="true" data-move-target="Ops"/);
    expect(html).toMatch(/aria-checked="false" data-move-target=""/);
    expect(html).toContain(">No team<");
    expect(html).toContain("New team…");
    expect(html).not.toContain("data-move-new-form");
  });

  it("checks No team for a bot in no team", () => {
    const html = renderToStaticMarkup(createElement(MoveToTeamList, { sections: ["Ops"], current: "", onAssign: () => {} }));
    expect(html).toMatch(/aria-checked="true" data-move-target=""/);
  });

  it("moves to a team, and No team takes the bot out of its team", () => {
    const onAssign = vi.fn();
    const buttons = elements({ sections: ["Ops", "Sales"], current: "Ops", onAssign });
    buttons.find((b) => b.props["data-move-target"] === "Sales")!.props.onClick!();
    buttons.find((b) => b.props["data-move-target"] === "")!.props.onClick!();
    expect(onAssign.mock.calls).toEqual([["Sales"], [""]]);
  });

  it("asks for the new team's name inside the menu", () => {
    const html = renderToStaticMarkup(createElement(MoveToTeamList, { sections: [], current: "", onAssign: () => {}, initialCreating: true }));
    expect(html).toContain("data-move-new-form");
    expect(html).toContain('aria-label="New team name"');
    expect(html).not.toContain("data-move-new=");
  });

  it("says it in French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(MoveToTeamList, { sections: [], current: "", onAssign: () => {} }));
    expect(html).toContain(">Aucune équipe<");
    expect(html).toContain("Nouvelle équipe…");
  });
});
