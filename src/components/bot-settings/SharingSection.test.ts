// Sharing a bot person by person on a server signed in with Perspicax
// (slice 3): the picker, the owner-only controls, the access card lines.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { answersForText, grantCandidates, levelAllowed, perspicaxKeysUrl, sharePickerPeople, isPerspicaxOrg, type OrgDirectory, type OrgDirectoryPerson } from "@/lib/perspicax-org";
import { orgSectionMenuItems } from "../OrgSectionMenu";
import { grantEditable, levelLabel } from "./GrantEditor";
import { accessCardLines } from "../AccessCard";
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
  it("tells everyone why, the owner what to ask, an admin where to fix it", () => {
    expect(accessCardLines(card, { principalId: BOB, admin: false })).toEqual({ text: "This bot can't answer: no key for Claude. Its owner has to add one." });
    expect(accessCardLines(card, { principalId: OWNER, admin: false }).hint).toBe("Ask an admin to allow the organization's key for your bots.");
    expect(accessCardLines(card, { principalId: BOB, admin: true }).hint).toContain("Settings > Connections");
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
    settings: { memberBotsUseOrgKey: false },
  };
  it("shows the link, the role, the console link and, for an admin, the org key switch", () => {
    const markup = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org, onChanged: () => {} }));
    expect(markup).toContain("Linked to Perspicax");
    expect(markup).toContain("You are an admin of this organization.");
    expect(markup).toContain('href="https://px.example.test/console/"');
    expect(markup).toContain("Use the organization&#x27;s key");
    expect(markup).toContain("Commands waiting for an admin");
  });
  it("gives a member the state and the link, never the switch", () => {
    const markup = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: { ...org, viewerRole: "member", link: { state: "error", error: "link_refused" } }, onChanged: () => {} }));
    expect(markup).toContain("The link to Perspicax has a problem (link_refused).");
    expect(markup).toContain("You are a member of this organization.");
    expect(markup).not.toContain("Use the organization");
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

  it("says who an engine answers, and links the owner to the keys page", () => {
    expect(answersForText({ installed: true, answersFor: "me" })).toBe("Answers for you only");
    expect(answersForText({ installed: true, answersFor: "everyone" })).toBe("Also answers the people you share with");
    expect(answersForText({ installed: true, answersFor: "nobody" })).toBe("Can't answer yet");
    expect(answersForText({ installed: false, answersFor: "everyone" })).toBe("Not installed on this server");
    expect(perspicaxKeysUrl("https://px.example.test/")).toBe("https://px.example.test/console/pulsabot/keys");
    const card = { reason: "no_access" as const, engine: "Claude", botId: "bot-1", ownerPrincipalId: OWNER, keysUrl: "https://px.example.test/console/pulsabot/keys" };
    expect(accessCardLines(card, { principalId: OWNER, admin: false })).toEqual({ text: "This bot can't answer: no key for Claude. Its owner has to add one.", hint: "Add your own key in Perspicax.", link: card.keysUrl });
    expect(accessCardLines(card, { principalId: BOB, admin: false }).link).toBeUndefined();
  });
});
