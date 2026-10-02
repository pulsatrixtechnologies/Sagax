// Settings > Organization > Sharing in the organization (2026-10-02 design):
// one compact row per bot, the admin's force actions in a row menu, the
// sharing details only once a row is opened, search from nine bots.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { filterOrgBots, groupOrgBotsByOwner, OrgBotMenuItems, OrgSharing, ORG_BOTS_SEARCH_FROM, sharingLine, type OrgBot } from "./OrgSharing";

const BOB = "pr_00000000-0000-4000-8000-0000000000b0";
const ANA = "pr_00000000-0000-4000-8000-0000000000a0";

const bot = (over: Partial<OrgBot> = {}): OrgBot => ({
  id: "b1", name: "Atlas", ownerPrincipalId: BOB, ownerName: "Bob Martin",
  engine: { instanceId: "claude", driver: "claudeAgent" }, grants: [],
  look: { id: "b1", name: "Atlas", title: "", color: "green", avatarUrl: null, mascotLook: { character: "trombi" } },
  running: true,
  ...over,
});
const grants = [
  { target: "team:t1", kind: "team", label: "Support", level: "use" },
  { target: `user:${ANA}`, kind: "user", label: "Ana", level: "run" },
] as OrgBot["grants"];

afterEach(() => setLocale("en"));

describe("Sharing in the organization: rows", () => {
  it("draws one compact row: avatar, name, owner, how widely shared, status", () => {
    const html = renderToStaticMarkup(createElement(OrgSharing, { initial: [bot(), bot({ id: "b2", name: "Pesto", grants, running: false })] }));
    expect(html).toContain('data-org-bot="b1"');
    expect(html).toContain("trombi-avatar"); // the bot's own character, not a generic icon
    expect(html).toContain("Atlas");
    expect(html).toContain("Bob Martin");
    expect(html).toContain(">BM<"); // the owner's initials avatar
    expect(html).toContain("Not shared");
    expect(html).toContain("Shared with 2 people or teams");
    expect(html).toContain('data-org-bot-status="running"');
    expect(html).toContain('data-org-bot-status="idle"');
    // the details stay closed, and no stray status line
    expect(html).not.toContain("data-org-bot-details");
    expect(html).not.toContain("Support (");
    expect(html).not.toContain('role="status"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("leaves the status out when the server does not say, and says it in French", () => {
    const html = renderToStaticMarkup(createElement(OrgSharing, { initial: [bot({ running: undefined, look: undefined })] }));
    expect(html).not.toContain("data-org-bot-status");
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(OrgSharing, { initial: [bot({ running: false, grants })] }));
    expect(fr).toContain("Partagé avec 2 personnes ou équipes");
    expect(fr).toContain("Inactif");
    expect(sharingLine([])).toBe("Non partagé");
    expect(sharingLine(grants.slice(0, 1))).toBe("Partagé avec 1 personne ou équipe");
  });
});

describe("Sharing in the organization: admin actions", () => {
  it("gives an admin a menu button per bot and a member none", () => {
    const bots = [bot(), bot({ id: "b2", name: "Pesto" })];
    const asAdmin = renderToStaticMarkup(createElement(OrgSharing, { initial: bots, admin: true }));
    expect(asAdmin).toContain('data-org-bot-force="b1"');
    expect(asAdmin).toContain('data-org-bot-force="b2"');
    expect(asAdmin).toContain('aria-label="Admin actions for Atlas"');
    expect(asAdmin).toContain('aria-haspopup="menu"');
    // the actions live in the menu, closed until asked
    expect(asAdmin).not.toContain('role="menu"');
    expect(asAdmin).not.toContain("Force stop");
    const asMember = renderToStaticMarkup(createElement(OrgSharing, { initial: bots }));
    expect(asMember).toContain("Atlas");
    expect(asMember).not.toContain("data-org-bot-force");
    expect(asMember).not.toContain("Admin actions");
  });

  it("enables Force stop only while the bot works, and shows Force delete in red", () => {
    const items = (running: boolean | undefined, busy = false) => renderToStaticMarkup(createElement(OrgBotMenuItems, { bot: { running }, busy, onStop: () => {}, onDelete: () => {} }));
    const stopOf = (html: string) => /<button[^>]*data-org-force-action="stop"[^>]*>/.exec(html)![0];
    const deleteOf = (html: string) => /<button[^>]*data-org-force-action="delete"[^>]*>/.exec(html)![0];
    expect(stopOf(items(true))).not.toContain(" disabled=\"\"");
    expect(stopOf(items(false))).toContain(" disabled=\"\"");
    expect(stopOf(items(undefined))).not.toContain(" disabled=\"\"");
    expect(deleteOf(items(false))).not.toContain(" disabled=\"\"");
    expect(deleteOf(items(false))).toContain("text-danger");
    expect(deleteOf(items(true, true))).toContain(" disabled=\"\"");
    expect(items(true)).toContain("Force stop");
    expect(items(true)).toContain("Force delete");
    setLocale("fr");
    expect(items(true)).toContain("Forcer l&#x27;arrêt");
    expect(items(true)).toContain("Forcer la suppression");
  });
});

describe("Sharing in the organization: many bots", () => {
  const many = Array.from({ length: ORG_BOTS_SEARCH_FROM + 1 }, (_, index) => bot({ id: `b${index}`, name: `Bot ${index}`, ...(index % 2 ? { ownerPrincipalId: ANA, ownerName: "Ana" } : {}) }));
  it("offers search and grouping past the threshold only", () => {
    expect(renderToStaticMarkup(createElement(OrgSharing, { initial: many.slice(0, ORG_BOTS_SEARCH_FROM) }))).not.toContain("data-org-sharing-search");
    const html = renderToStaticMarkup(createElement(OrgSharing, { initial: many }));
    expect(html).toContain("data-org-sharing-search");
    expect(html).toContain("Group by owner");
  });
  it("filters on name, owner or section and groups by owner in name order", () => {
    expect(filterOrgBots(many, "bot 3").map((entry) => entry.id)).toEqual(["b3"]);
    expect(filterOrgBots(many, "ANA")).toHaveLength(4);
    expect(filterOrgBots([bot({ section: "Finance" })], "fin")).toHaveLength(1);
    expect(filterOrgBots(many, "  ")).toHaveLength(many.length);
    const groups = groupOrgBotsByOwner(many);
    expect(groups.map((group) => group.owner)).toEqual(["Ana", "Bob Martin"]);
    expect(groups[1]!.bots.map((entry) => entry.id)).toEqual(["b0", "b2", "b4", "b6", "b8"]);
  });
});
