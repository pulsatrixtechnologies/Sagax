import { createElement, type MouseEvent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChannelMembers } from "./ChannelMembers";

describe("ChannelMembers", () => {
  it("hides add controls from a member who cannot edit", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [{ id: "zachary@example.test" }],
      bots: [{ id: "aurora", name: "Aurora" }],
      canAddHuman: false,
      canAddBot: false,
    }));
    expect(html).toContain("Aurora");
    expect(html).toContain("zachary@example.test");
    expect(html).not.toContain("Ajouter");
  });

  it("shows Ajouter only on the list whose boolean is true", () => {
    const humans = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [{ id: "zachary@example.test" }],
      bots: [{ id: "aurora", name: "Aurora" }],
      canAddHuman: true,
      canAddBot: false,
    }));
    const bots = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [{ id: "zachary@example.test" }],
      bots: [{ id: "aurora", name: "Aurora" }],
      canAddHuman: false,
      canAddBot: true,
    }));
    expect(humans).toContain("Gens");
    expect(humans).toContain("Bots");
    const humanCut = humans.indexOf("Bots");
    expect(humans.slice(0, humanCut)).toContain("Ajouter");
    expect(humans.slice(humanCut)).not.toContain("Ajouter");
    const botCut = bots.indexOf("Bots");
    expect(bots.slice(0, botCut)).not.toContain("Ajouter");
    expect(bots.slice(botCut)).toContain("Ajouter");
    expect(humans.match(/Ajouter/g)).toHaveLength(1);
    expect(bots.match(/Ajouter/g)).toHaveLength(1);
  });

  it("calls onAddHuman when Ajouter is clicked", () => {
    const onAddHuman = vi.fn();
    const tree = ChannelMembers({
      humans: [{ id: "zachary@example.test" }],
      bots: [{ id: "aurora", name: "Aurora" }],
      canAddHuman: true,
      canAddBot: false,
      onAddHuman,
    });
    const button = findAjouter(tree);
    button?.props.onClick?.({} as MouseEvent<HTMLButtonElement>);
    expect(onAddHuman).toHaveBeenCalledOnce();
  });
});

function findAjouter(tree: ReactNode): { props: { onClick?: (event: MouseEvent<HTMLButtonElement>) => void } } | undefined {
  if (!tree || typeof tree !== "object" || !("props" in tree)) return;
  const props = tree.props as { children?: ReactNode; onClick?: (event: MouseEvent<HTMLButtonElement>) => void };
  if ((tree as { type?: unknown }).type === "button" && props.children === "Ajouter") {
    return { props };
  }
  const nested = Array.isArray(props.children) ? props.children : [props.children];
  for (const child of nested) {
    const found = findAjouter(child);
    if (found) return found;
  }
}
