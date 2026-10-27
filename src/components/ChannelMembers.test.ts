import { createElement, type MouseEvent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { t } from "@/lib/i18n";
import { channelHumanRow } from "@/lib/perspicax-org";
import { ChannelMembers, channelRosterActions } from "./ChannelMembers";

// The add button reads the app catalogue (#1196), so the label follows the active language.
const ADD = t("common.add");

describe("ChannelMembers", () => {
  it("hides add controls from a member who cannot edit", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [{ id: "morgan@example.test" }],
      bots: [{ id: "aurora", name: "Aurora" }],
      canAddHuman: false,
      canAddBot: false,
    }));
    expect(html).toContain("Aurora");
    expect(html).toContain("morgan@example.test");
    expect(html).not.toContain(ADD);
  });

  it("shows Ajouter only on the list whose boolean is true", () => {
    const humans = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [{ id: "morgan@example.test" }],
      bots: [{ id: "aurora", name: "Aurora" }],
      canAddHuman: true,
      canAddBot: false,
    }));
    const bots = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [{ id: "morgan@example.test" }],
      bots: [{ id: "aurora", name: "Aurora" }],
      canAddHuman: false,
      canAddBot: true,
    }));
    expect(humans).toContain("Gens");
    expect(humans).toContain("Bots");
    const humanCut = humans.indexOf("Bots");
    expect(humans.slice(0, humanCut)).toContain(ADD);
    expect(humans.slice(humanCut)).not.toContain(ADD);
    const botCut = bots.indexOf("Bots");
    expect(bots.slice(0, botCut)).not.toContain(ADD);
    expect(bots.slice(botCut)).toContain(ADD);
    expect(humans.match(new RegExp(`aria-label="${ADD}"`, "g"))).toHaveLength(1);
    expect(bots.match(new RegExp(`aria-label="${ADD}"`, "g"))).toHaveLength(1);
  });

  it("calls onAddHuman when Ajouter is clicked", () => {
    const onAddHuman = vi.fn();
    const tree = ChannelMembers({
      humans: [{ id: "morgan@example.test" }],
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
      bots: [{ id: "aurora", ownerUserId: "morgan@example.test" }],
    })).toEqual({ canAddHuman: true, canAddBot: false });
    expect(channelRosterActions({
      actorRole: "owner",
      actorId: "owner",
      bots: [{ id: "aurora", ownerUserId: "Owner" }],
    })).toEqual({ canAddHuman: true, canAddBot: true });
    // Organization server: someone else owns the group. You still bring
    // your own bot, once.
    expect(channelRosterActions({
      actorRole: "admin",
      actorId: "owner",
      bots: [{ id: "aurora", ownerUserId: "Owner" }],
      ownsRoom: false,
    })).toEqual({ canAddHuman: false, canAddBot: true });
    expect(channelRosterActions({
      actorRole: "member",
      actorId: "owner",
      bots: [{ id: "aurora", ownerUserId: "Owner" }],
      ownsRoom: false,
      memberIds: ["aurora"],
    })).toEqual({ canAddHuman: false, canAddBot: false });
    expect(channelRosterActions({
      actorRole: "member",
      actorId: "morgan@example.test",
      bots: [{ id: "aurora", ownerUserId: "morgan@example.test" }],
    })).toEqual({ canAddHuman: true, canAddBot: true });
    expect(channelRosterActions({
      actorRole: "member",
      actorId: "morgan@example.test",
      bots: [{ id: "aurora", ownerUserId: "owner" }],
    })).toEqual({ canAddHuman: true, canAddBot: false });
  });
});

function findAjouter(tree: ReactNode): { props: { onClick?: (event: MouseEvent<HTMLButtonElement>) => void } } | undefined {
  if (!tree || typeof tree !== "object" || !("props" in tree)) return;
  const props = tree.props as { children?: ReactNode; onClick?: (event: MouseEvent<HTMLButtonElement>) => void };
  const aria = (tree as { props?: { "aria-label"?: string } }).props?.["aria-label"];
  if ((tree as { type?: unknown }).type === "button" && aria === ADD) {
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
    ["pr_owner", { principalId: "pr_owner", name: "Alex Martin", login: "amartin", email: "amartin@example.test", role: "admin" as const, disabled: false, avatarUrl: "/api/people/pr_owner/avatar?v=0a1b2c" }],
    ["pr_sam", { principalId: "pr_sam", name: "sam.t", login: "samt", email: "sam.t@example.test", role: "member" as const, disabled: false, avatarUrl: "https://tracker.example.test/pixel.png" }],
  ]);

  it("reads each person as their display name with their Perspicax avatar", () => {
    expect(channelHumanRow("PR_OWNER", PEOPLE)).toEqual({ id: "PR_OWNER", label: "Alex Martin", detail: "amartin@example.test", avatarUrl: "/api/people/pr_owner/avatar?v=0a1b2c" });
    // an image from anywhere else is never used
    expect(channelHumanRow("pr_sam", PEOPLE).avatarUrl).toBeUndefined();
    // a solo server (no directory) keeps the stored id
    expect(channelHumanRow("zara@example.test", new Map())).toEqual({ id: "zara@example.test", label: "zara@example.test" });
  });

  it("draws the avatar, or the letters when there is none", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [channelHumanRow("pr_owner", PEOPLE), channelHumanRow("pr_sam", PEOPLE)],
      bots: [],
      canAddHuman: false,
      canAddBot: false,
      part: "humans",
    }));
    expect(html).toContain('src="/api/people/pr_owner/avatar?v=0a1b2c"');
    expect(html).toContain("Alex Martin");
    expect(html).not.toContain("amartin<");
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
    expect(html).toContain(`aria-label="${t("channelMembers.remove", { name: "Yuki" })}"`);
    expect(html).not.toContain(`aria-label="${t("channelMembers.remove", { name: "Scout" })}"`);
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
