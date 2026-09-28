import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
});
