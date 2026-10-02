import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ role: "member" as "admin" | "member", groups: [] as unknown[], bots: [] as unknown[] }));
vi.mock("./DesktopCapabilities", () => ({ useCaptionChrome: () => ({ padClass: "" }), useMacInsetChrome: () => ({ macInset: false, browser: false }) }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => ({ org: { name: "Acme", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: fixture.role, settings: {} }),
}));
vi.mock("./GroupPeoplePicker", () => ({ useOrgDirectory: () => null }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: { viewer: { principalId: "pr_me" } }, groups: fixture.groups, bots: fixture.bots }, dispatch: vi.fn() }) };
});

const { PersonPanel } = await import("./PersonPanel");

const ada = { principalId: "pr_ada", name: "Ada Example", login: "ada", email: "ada@example.test", role: "member" as const, disabled: false, teams: [{ id: "t1", manager: false }], manageUrl: "https://px.example.test/console/users/u1" };
const directory = { people: [ada], teams: [{ id: "t1", name: "Support", managers: [], members: [] }] };

function render(personId = "pr_ada") {
  return renderToStaticMarkup(createElement(PersonPanel, { personId, directory }));
}

describe("PersonPanel", () => {
  beforeEach(() => {
    fixture.role = "member";
    fixture.groups = [
      { id: "ops", name: "Operations", humanIds: ["pr_me", "pr_ada"], memberIds: [], messages: [], unread: false } as unknown as Group,
      { id: "dm", name: "dm", peopleDm: true, humanIds: ["pr_me", "pr_ada"], memberIds: [], messages: [], unread: false } as unknown as Group,
    ];
    fixture.bots = [];
  });

  it("shows who the person is from the directory, the groups in common and Message", () => {
    const html = render();
    expect(html).toContain('data-person-panel="pr_ada"');
    expect(html).toContain("Ada Example");
    expect(html).toContain("ada@example.test");
    expect(html).toContain("Support");
    expect(html).toContain("Member");
    expect(html).toContain("Operations");
    expect(html).toContain('data-person-action="message"');
    expect(html).toContain('data-person-action="hide"');
    expect(html).not.toContain("Manage in Perspicax");
  });

  it("links an admin to the person's page in the Perspicax console", () => {
    fixture.role = "admin";
    const html = render();
    expect(html).toContain("data-person-manage");
    expect(html).toContain('href="https://px.example.test/console/users/u1"');
    expect(html).toContain("Manage in Perspicax");
  });

  it("offers no Message to yourself and says when someone is not in the directory", () => {
    const html = render("pr_ghost");
    expect(html).not.toContain('data-person-action="message"');
    expect(html).toContain("not in your organization");
  });

  it("lists their bots shared with you", () => {
    fixture.bots = [{ id: "rex", name: "Rex", title: "Reports", ownerUserId: "pr_ada", color: "green", messages: [], unread: false } as unknown as Bot];
    expect(render()).toContain("Rex");
  });
});
