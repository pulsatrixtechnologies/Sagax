// Sharing a bot person by person on a server signed in with Perspicax
// (slice 3): the picker, the owner-only controls, the access card lines.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { grantCandidates, myTurnsText, turnAccessLabel, levelAllowed, perspicaxKeysUrl, sharePickerPeople, isPerspicaxOrg, type OrgDirectory, type OrgDirectoryPerson } from "@/lib/perspicax-org";
import { orgSectionMenuItems } from "../OrgSectionMenu";
import { grantEditable, levelLabel } from "./GrantEditor";
import { AccessCard, accessCardLines } from "../AccessCard";
import { PerspicaxOrgSettings, perspicaxConsoleUrl, showInterimCard } from "../PerspicaxOrgSettings";

const OWNER = "pr_00000000-0000-4000-8000-0000000000a0";
const BOB = "pr_00000000-0000-4000-8000-0000000000b0";
const DAVE = "pr_00000000-0000-4000-8000-0000000000d0";
const ERIN = "pr_00000000-0000-4000-8000-0000000000e0";

const fixture = vi.hoisted(() => ({ viewer: null as null | { principalId: string | null; role: string | null } }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: { ...original.initialState, config: { viewer: fixture.viewer } }, dispatch: vi.fn() }),
  };
});
const { SharingSection, initialGrantRows } = await import("./SharingSection");

const people: OrgDirectoryPerson[] = [
  { principalId: OWNER, name: "Alice", login: "alice", email: "alice@example.test", role: "admin", disabled: false },
  { principalId: BOB, name: "Bob", login: "bob", email: "bob@example.test", role: "member", disabled: false },
  { principalId: DAVE, name: "Dave", login: "dave", role: "member", disabled: true },
  { principalId: ERIN, name: "Erin Roy", login: "erin", email: "erin@example.test", role: "member", disabled: false },
];

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return { id: "bot-1", threadId: "thread-1", name: "Xavier", ownerUserId: OWNER, directGrants: [BOB], ...overrides } as Bot;
}

describe("the share picker", () => {
  it("offers active people who are neither the owner nor already granted", () => {
    expect(sharePickerPeople(people, { ownerId: OWNER, grants: [BOB], query: "" }).map((p) => p.login)).toEqual(["erin"]);
    expect(sharePickerPeople(people, { ownerId: OWNER, grants: [], query: "" }).map((p) => p.login)).toEqual(["bob", "erin"]);
  });

  it("searches by name, login and email, without case", () => {
    expect(sharePickerPeople(people, { ownerId: OWNER, grants: [], query: "ROY" }).map((p) => p.login)).toEqual(["erin"]);
    expect(sharePickerPeople(people, { ownerId: OWNER, grants: [], query: "bob@" }).map((p) => p.login)).toEqual(["bob"]);
    expect(sharePickerPeople(people, { ownerId: OWNER, grants: [], query: "dave" })).toEqual([]);
  });

  it("recognizes a Perspicax organization answer only", () => {
    expect(isPerspicaxOrg({ org: { name: "Acme", identity: { kind: "perspicax", issuer: "https://px" } } })).toBe(true);
    expect(isPerspicaxOrg({ org: { name: "Acme", host: { kind: "server" } } })).toBe(false);
    expect(isPerspicaxOrg(null)).toBe(false);
    expect(perspicaxConsoleUrl("https://px.example.test/")).toBe("https://px.example.test/console/");
  });
});

describe("SharingSection", () => {
  it("shows the grantees and the notice, with remove and search for the owner", () => {
    fixture.viewer = { principalId: OWNER, role: "admin" };
    const markup = renderToStaticMarkup(createElement(SharingSection, { bot: makeBot() }));
    expect(markup).toContain("People you add see this bot&#x27;s conversations and can write to it.");
    expect(markup).toContain("Remove");
    expect(markup).toContain("Search by name, login or email");
  });

  it("gives someone who is not the owner no controls", () => {
    fixture.viewer = { principalId: BOB, role: "member" };
    const markup = renderToStaticMarkup(createElement(SharingSection, { bot: makeBot() }));
    expect(markup).not.toContain("Remove");
    expect(markup).not.toContain("Search by name");
    expect(markup).toContain("Only this bot&#x27;s owner can share it.");
  });

  it("says when nobody has it yet", () => {
    fixture.viewer = { principalId: OWNER, role: "admin" };
    expect(renderToStaticMarkup(createElement(SharingSection, { bot: makeBot({ directGrants: [] }) }))).toContain("Not shared with anyone yet.");
  });
});

describe("the access card", () => {
  const card = { reason: "no_access" as const, engine: "Claude", botId: "bot-1", ownerPrincipalId: OWNER };
  const KEYS = "https://px.example.test/console/pulsabot/keys";
  it("2026-10-01: the person who spoke gets what to do; others why; an admin where the org key lives", () => {
    const bobs = { ...card, payer: "speaker" as const, payerPrincipalId: BOB, cause: "no_credentials" as const, keysUrl: KEYS, subscriptionSignIn: true as const };
    expect(accessCardLines(bobs, { principalId: BOB, admin: false })).toEqual({
      text: "No Claude access for your turn.",
      hint: "Sign in with your own Claude subscription or add your key in Perspicax. Or ask an admin to set the organization's key.",
      link: { href: KEYS, label: "Add my key in Perspicax" },
      signIn: true,
    });
    // the owner watching bob's turn: not their credentials to give
    expect(accessCardLines(bobs, { principalId: OWNER, admin: false })).toEqual({ text: "No Claude access for this turn: the person who spoke needs their own subscription or key, or the organization's key." });
    expect(accessCardLines(bobs, { principalId: ERIN, admin: true }).hint).toBe("A key in Settings > Connections serves as the organization's key.");
    // a card from before the change names nobody
    expect(accessCardLines(card, { principalId: OWNER, admin: false })).toEqual({ text: "No Claude access for this turn: the person who spoke needs their own subscription or key, or the organization's key." });
  });

  it("a routine's card goes to the owner, whose credentials it runs on", () => {
    const routine = { ...card, payer: "owner" as const, payerPrincipalId: OWNER, routine: true as const, cause: "no_credentials" as const, keysUrl: KEYS, subscriptionSignIn: true as const };
    expect(accessCardLines(routine, { principalId: OWNER, admin: false })).toMatchObject({ hint: "Sign in with your own Claude subscription or add your key in Perspicax.", signIn: true, link: { href: KEYS } });
    expect(accessCardLines(routine, { principalId: BOB, admin: false })).toEqual({ text: "This routine can't run: it uses its owner's credentials, and there is no Claude subscription, key or organization key for it." });
    expect(accessCardLines({ ...routine, cause: "payer_disabled" }, { principalId: BOB, admin: false })).toEqual({ text: "This bot's owner is disabled: their routines can't run." });
    expect(accessCardLines({ ...card, payer: "speaker", payerPrincipalId: BOB, cause: "payer_disabled" }, { principalId: BOB, admin: false })).toEqual({ text: "Your account is disabled: this turn can't run." });
  });

  it("renders the sign-in button only where it can open My engines", () => {
    const bobs = { ...card, payer: "speaker" as const, payerPrincipalId: BOB, keysUrl: KEYS, subscriptionSignIn: true as const };
    const viewer = { principalId: BOB, admin: false };
    expect(renderToStaticMarkup(createElement(AccessCard, { access: bobs, viewer, onSignIn: () => {} }))).toContain("Sign in with my subscription");
    expect(renderToStaticMarkup(createElement(AccessCard, { access: bobs, viewer }))).not.toContain("Sign in with my subscription");
    expect(renderToStaticMarkup(createElement(AccessCard, { access: bobs, viewer }))).toContain(`href="${KEYS}"`);
  });

  it("names a missing engine, and shows the provider's words to the owner and admins only", () => {
    expect(accessCardLines({ ...card, reason: "engine_missing", engine: "Codex" }, { principalId: OWNER, admin: false }))
      .toEqual({ text: "This bot uses Codex, which is not installed on this server.", hint: "Ask an admin." });
    const refused = { ...card, reason: "key_refused" as const, detail: "invalid x-api-key" };
    expect(accessCardLines(refused, { principalId: BOB, admin: false })).toEqual({ text: "The provider refused this bot's key." });
    expect(accessCardLines(refused, { principalId: OWNER, admin: false }).detail).toBe("invalid x-api-key");
  });
});

describe("Settings > Organization on a Perspicax server", () => {
  const org = {
    org: { name: "Acme", identity: { kind: "perspicax" as const, issuer: "https://px.example.test" } },
    link: { state: "ok" as const, syncedAt: Date.UTC(2026, 8, 29, 12) },
    viewerRole: "admin" as const,
    settings: { orgKeyConfigured: false },
  };
  it("shows the link, the role, the console link and who pays for a turn (no org key switch any more)", () => {
    const markup = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org, onChanged: () => {} }));
    expect(markup).toContain("Linked to Perspicax");
    expect(markup).toContain("You are an admin of this organization.");
    expect(markup).toContain('href="https://px.example.test/console/"');
    expect(markup).not.toContain("type=\"checkbox\"");
    expect(markup).toContain("Who pays for a turn");
    expect(markup).toContain("No organization key is set on this server.");
    expect(renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: { ...org, settings: { orgKeyConfigured: true } }, onChanged: () => {} }))).toContain("An organization key is set on this server");
    expect(markup).toContain("Commands waiting for an admin");
  });
  it("gives a member the state, the link and the same explanation", () => {
    const markup = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: { ...org, viewerRole: "member", link: { state: "error", error: "link_refused" } }, onChanged: () => {} }));
    expect(markup).toContain("The link to Perspicax has a problem (link_refused).");
    expect(markup).toContain("You are a member of this organization.");
    expect(markup).toContain("Who pays for a turn");
    expect(markup).not.toContain("Commands waiting for an admin");
  });
  it("keeps the interim card after the last attach so its notice stays visible, and hides it once closed", () => {
    const until = Date.UTC(2026, 10, 1);
    expect(showInterimCard(true, { until, people: 2 }, false)).toBe(true);
    expect(showInterimCard(true, { until, people: 0 }, false)).toBe(false);
    expect(showInterimCard(true, { until, people: 0 }, true)).toBe(true);
    expect(showInterimCard(true, { until: null, people: 0 }, true)).toBe(false);
    expect(showInterimCard(false, { until, people: 2 }, true)).toBe(false);
  });
});

describe("slice 4: levels, teams and the section menu", () => {
  const directory: OrgDirectory = {
    people: people.map((person) => ({ ...person })),
    teams: [{ id: "T", name: "Sales", managers: [ERIN], members: [BOB] }, { id: "U", name: "Support", managers: [], members: [DAVE] }],
  };

  it("names the levels and caps what a caller may give", () => {
    expect(["use", "run", "edit", "manage"].map((level) => levelLabel(level as never))).toEqual(["Talk", "Run routines", "Edit", "Manage sharing"]);
    expect(levelAllowed("edit", "edit")).toBe(true);
    expect(levelAllowed("manage", "edit")).toBe(false);
    expect(grantEditable({ level: "manage" }, { any: true, teamIds: [], maxLevel: "edit" })).toBe(false);
    expect(grantEditable({ level: "run" }, { any: true, teamIds: [], maxLevel: "edit" })).toBe(true);
    expect(grantEditable({ level: "use" }, null)).toBe(false);
  });

  it("offers people and teams, and only a manager's teams and members to a manager", () => {
    const all = grantCandidates(directory, { ownerId: OWNER, taken: [`user:${BOB}`], query: "" });
    expect(all.map((c) => c.target)).toEqual(["team:T", "team:U", `user:${ERIN}`]);
    expect(all[0]).toMatchObject({ kind: "team", label: "Sales", count: 1 });
    const manager = grantCandidates(directory, { ownerId: OWNER, taken: [], query: "", administer: { any: false, teamIds: ["T"], maxLevel: "use", canAdd: true } });
    expect(manager.map((c) => c.target)).toEqual(["team:T", `user:${BOB}`, `user:${ERIN}`]);
    expect(grantCandidates(directory, { ownerId: OWNER, taken: [], query: "supp" }).map((c) => c.target)).toEqual(["team:U"]);
  });

  it("shows team grants with their level to the owner", () => {
    fixture.viewer = { principalId: OWNER, role: "admin" };
    const bot = makeBot({ grants: [{ target: "team:T", level: "run", by: OWNER, at: 1 }, { target: `user:${BOB}`, level: "use", by: OWNER, at: 1 }] });
    expect(initialGrantRows(bot, directory).map((row) => [row.kind, row.label, row.level])).toEqual([["team", "Sales", "run"], ["user", "Bob", "use"]]);
    const markup = renderToStaticMarkup(createElement(SharingSection, { bot }));
    expect(markup).toContain("Run routines");
    expect(markup).toContain("Manage sharing");
    expect(markup).toContain("Remove");
  });

  it("the section menu hides what the caller may not do; General only creates", () => {
    const section = { id: "sec_1", name: "Ventes", ownerPrincipalId: OWNER, members: [], defaultLevel: "use" as const, viewerRole: "participant" as const, canModerate: false };
    expect(orgSectionMenuItems(null, { named: false, canMoveUp: false, canMoveDown: true, anyExpanded: true })).toEqual(["onNew", "onMoveDown", "onCollapseAll"]);
    expect(orgSectionMenuItems(section, { named: true, canMoveUp: true, canMoveDown: false, anyExpanded: false })).toEqual(["onNew", "onMembers", "onMoveUp", "onExpandAll"]);
    expect(orgSectionMenuItems({ ...section, canModerate: true }, { named: true, canMoveUp: false, canMoveDown: false, anyExpanded: true })).toEqual(["onNew", "onRename", "onMembers", "onCollapseAll", "onDelete"]);
  });

  it("says what a person's own turns use on an engine, and links to the keys page", () => {
    expect(myTurnsText({ installed: true, myTurns: "subscription" })).toBe("Your turns use your subscription");
    expect(myTurnsText({ installed: true, myTurns: "key" })).toBe("Your turns use your key in Perspicax");
    expect(myTurnsText({ installed: true, myTurns: "org-key" })).toBe("Your turns use the organization's key");
    expect(myTurnsText({ installed: true, myTurns: "none" })).toBe("Can't answer you yet: sign in or add your key");
    expect(myTurnsText({ installed: false, myTurns: "subscription" })).toBe("Not installed on this server");
    expect(perspicaxKeysUrl("https://px.example.test/")).toBe("https://px.example.test/console/pulsabot/keys");
  });

  it("names what a turn ran with, for the viewer, without a secret", () => {
    expect(turnAccessLabel({ via: "subscription", payer: "speaker", payerPrincipalId: BOB }, BOB)).toBe("Your subscription");
    expect(turnAccessLabel({ via: "subscription", payer: "speaker", payerPrincipalId: BOB }, OWNER)).toBe("The speaker's subscription");
    expect(turnAccessLabel({ via: "speaker-key", payer: "speaker", payerPrincipalId: BOB }, BOB)).toBe("Your key");
    expect(turnAccessLabel({ via: "owner-key", payer: "owner", payerPrincipalId: OWNER }, OWNER)).toBe("Your key");
    expect(turnAccessLabel({ via: "speaker-key", payer: "speaker", payerPrincipalId: BOB }, null)).toBe("The speaker's key");
    expect(turnAccessLabel({ via: "org-key", payer: "organization" }, BOB)).toBe("Organization's key");
    expect(turnAccessLabel({ via: "org-key", payer: "organization", routine: true }, OWNER)).toBe("Organization's key");
    expect(turnAccessLabel({ via: "owner-key", payer: "owner", payerPrincipalId: OWNER, routine: true }, OWNER)).toBe("Owner's credentials");
    expect(turnAccessLabel({ via: "subscription", payer: "owner", payerPrincipalId: OWNER, routine: true }, BOB)).toBe("Owner's credentials");
  });
});
