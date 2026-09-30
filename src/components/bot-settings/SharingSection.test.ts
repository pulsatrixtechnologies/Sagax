// Sharing a bot person by person on a server signed in with Perspicax
// (slice 3): the picker, the owner-only controls, the access card lines.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { sharePickerPeople, isPerspicaxOrg, type OrgDirectoryPerson } from "@/lib/perspicax-org";
import { accessCardLines } from "../AccessCard";
import { PerspicaxOrgSettings, perspicaxConsoleUrl } from "../PerspicaxOrgSettings";

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
const { SharingSection } = await import("./SharingSection");

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
});
