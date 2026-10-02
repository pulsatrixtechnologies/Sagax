import { createElement, type MouseEvent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { channelHumanRow } from "@/lib/perspicax-org";
import { ChannelMembers, channelRosterActions } from "./ChannelMembers";

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
    expect(humans.match(/aria-label="Ajouter"/g)).toHaveLength(1);
    expect(bots.match(/aria-label="Ajouter"/g)).toHaveLength(1);
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

  it("shows add for humans when the actor is owner or admin, and for bots the actor owns", () => {
    expect(channelRosterActions({
      actorRole: "admin",
      actorId: "Ada@Example.test",
      bots: [{ id: "aurora", ownerUserId: "zachary@example.test" }],
    })).toEqual({ canAddHuman: true, canAddBot: false });
    expect(channelRosterActions({
      actorRole: "owner",
      actorId: "jc",
      bots: [{ id: "aurora", ownerUserId: "JC" }],
    })).toEqual({ canAddHuman: true, canAddBot: true });
    // Organization server: someone else owns the group. You still bring
    // your own bot, once.
    expect(channelRosterActions({
      actorRole: "admin",
      actorId: "jc",
      bots: [{ id: "aurora", ownerUserId: "JC" }],
      ownsRoom: false,
    })).toEqual({ canAddHuman: false, canAddBot: true });
    expect(channelRosterActions({
      actorRole: "member",
      actorId: "jc",
      bots: [{ id: "aurora", ownerUserId: "JC" }],
      ownsRoom: false,
      memberIds: ["aurora"],
    })).toEqual({ canAddHuman: false, canAddBot: false });
    expect(channelRosterActions({
      actorRole: "member",
      actorId: "zachary@example.test",
      bots: [{ id: "aurora", ownerUserId: "zachary@example.test" }],
    })).toEqual({ canAddHuman: false, canAddBot: true });
    expect(channelRosterActions({
      actorRole: "member",
      actorId: "zachary@example.test",
      bots: [{ id: "aurora", ownerUserId: "jc" }],
    })).toEqual({ canAddHuman: false, canAddBot: false });
  });
});

function findAjouter(tree: ReactNode): { props: { onClick?: (event: MouseEvent<HTMLButtonElement>) => void } } | undefined {
  if (!tree || typeof tree !== "object" || !("props" in tree)) return;
  const props = tree.props as { children?: ReactNode; onClick?: (event: MouseEvent<HTMLButtonElement>) => void };
  const aria = (tree as { props?: { "aria-label"?: string } }).props?.["aria-label"];
  if ((tree as { type?: unknown }).type === "button" && aria === "Ajouter") {
    return { props };
  }
  const nested = Array.isArray(props.children) ? props.children : [props.children];
  for (const child of nested) {
    const found = findAjouter(child);
    if (found) return found;
  }
}

describe("a room's people on an organization server", () => {
  const PEOPLE = new Map([
    ["pr_jc", { principalId: "pr_jc", name: "Jean-Christophe Proulx", login: "jcproulx", email: "jcproulx@example.test", role: "admin" as const, disabled: false, avatarUrl: "/api/people/pr_jc/avatar?v=0a1b2c" }],
    ["pr_sam", { principalId: "pr_sam", name: "sam.t", login: "samt", email: "sam.t@example.test", role: "member" as const, disabled: false, avatarUrl: "https://tracker.example.test/pixel.png" }],
  ]);

  it("reads each person as their display name with their Perspicax avatar", () => {
    expect(channelHumanRow("PR_JC", PEOPLE)).toEqual({ id: "PR_JC", label: "Jean-Christophe Proulx", detail: "jcproulx@example.test", avatarUrl: "/api/people/pr_jc/avatar?v=0a1b2c" });
    // an image from anywhere else is never used
    expect(channelHumanRow("pr_sam", PEOPLE).avatarUrl).toBeUndefined();
    // a solo server (no directory) keeps the stored id
    expect(channelHumanRow("zara@example.test", new Map())).toEqual({ id: "zara@example.test", label: "zara@example.test" });
  });

  it("draws the avatar, or the letters when there is none", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [channelHumanRow("pr_jc", PEOPLE), channelHumanRow("pr_sam", PEOPLE)],
      bots: [],
      canAddHuman: false,
      canAddBot: false,
      part: "humans",
    }));
    expect(html).toContain('src="/api/people/pr_jc/avatar?v=0a1b2c"');
    expect(html).toContain("Jean-Christophe Proulx");
    expect(html).not.toContain("jcproulx<");
    expect(html).not.toContain("tracker.example.test");
    expect(html).toContain(">ST<");
  });
  it("shows the remove button only on bots you may take out", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [],
      bots: [{ id: "yuki", name: "Yuki", removable: true }, { id: "scout", name: "Scout", removable: false }],
      canAddHuman: false,
      canAddBot: true,
      addBotLabel: "Ajouter mon robot",
      onRemoveBot: () => {},
      onAddBot: () => {},
      part: "bots",
    }));
    expect(html).toContain('aria-label="Retirer Yuki"');
    expect(html).not.toContain('aria-label="Retirer Scout"');
    expect(html).toContain("Ajouter mon robot");
  });
});

describe("ChannelMembers person rows", () => {
  it("makes each person a button that opens their panel when asked", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [{ id: "pr_ada", label: "Ada Example" }],
      bots: [],
      canAddHuman: false,
      canAddBot: false,
      onOpenHuman: () => {},
    }));
    expect(html).toContain('data-open-person="pr_ada"');
    const plain = renderToStaticMarkup(createElement(ChannelMembers, { humans: [{ id: "pr_ada", label: "Ada Example" }], bots: [], canAddHuman: false, canAddBot: false }));
    expect(plain).not.toContain("data-open-person");
  });
});
