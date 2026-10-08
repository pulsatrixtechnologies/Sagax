import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { resetPublicAchievementsForTests } from "@/lib/public-achievements";
import { resetPersonLabelsForTests } from "@/lib/person-labels";

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

function render(personId = "pr_ada", given: typeof directory & { viewer?: { principalId: string | null; orgRole: "admin" | "member"; managedTeamIds: string[] } } = directory) {
  return renderToStaticMarkup(createElement(PersonPanel, { personId, directory: given }));
}

describe("PersonPanel", () => {
  beforeEach(() => {
    resetPublicAchievementsForTests();
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
    expect(html).not.toContain('data-person-section="connections"');
  });

  it("links an admin to the person's page in the Perspicax console and lists their connections", () => {
    fixture.role = "admin";
    const html = render();
    expect(html).toContain("data-person-manage");
    expect(html).toContain('href="https://px.example.test/console/users/u1"');
    expect(html).toContain("Manage in Perspicax");
    expect(html).toContain('data-person-section="connections"');
    expect(html).toContain("Loading connections…");
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

  it("lists the public title and score under the name, and the achievements on their tab", () => {
    resetPublicAchievementsForTests({
      pr_ada: {
        points: 220,
        level: 3,
        title: "rookie",
        unlocked: [{ id: "hello-bot", points: 10, unlockedAt: 1 }],
      },
    });
    const html = render();
    const nameAt = html.indexOf("Ada Example");
    const lineAt = html.indexOf("data-member-line");
    expect(nameAt).toBeGreaterThan(-1);
    expect(lineAt).toBeGreaterThan(nameAt);
    expect(html.slice(lineAt, html.indexOf("</div>", lineAt))).toContain("Rookie");
    expect(html.slice(lineAt, html.indexOf("</div>", lineAt))).toContain(">220<");
    expect(html).toContain('data-person-tab="achievements"');
    expect(html).toContain('data-person-tabpanel="achievements"');
    expect(html).toContain('data-achievement="hello-bot"');
    expect(html).not.toContain("data-member-variant=\"blade\"");
  });

  it("keeps a private card off the name line and says so on the achievements tab", () => {
    const html = render();
    expect(html).not.toContain("data-member-line");
    expect(html).toContain('data-person-tab="achievements"');
    expect(html).toContain("This person keeps their achievements private.");
  });

  describe("label", () => {
    const editLabel = 'aria-label="Edit label"';
    beforeEach(() => resetPersonLabelsForTests());

    it("shows a colleague's label under the name as plain text to a member", () => {
      resetPersonLabelsForTests({ pr_ada: "CTO" });
      const html = render();
      expect(html.indexOf(">CTO<")).toBeGreaterThan(html.indexOf("Ada Example"));
      expect(html).not.toContain(editLabel);
      expect(html).not.toContain("Add a label");
    });

    it("shows nothing to a member when the colleague has no label", () => {
      expect(render()).not.toContain("Add a label");
    });

    it("offers Add a label to an admin, to a manager of their team and on your own sheet", () => {
      fixture.role = "admin";
      const admin = render();
      expect(admin).toContain(editLabel);
      expect(admin).toContain("Add a label");
      fixture.role = "member";
      const managed = render("pr_ada", { ...directory, viewer: { principalId: "pr_me", orgRole: "member", managedTeamIds: ["t1"] } });
      expect(managed).toContain(editLabel);
      const otherTeam = render("pr_ada", { ...directory, viewer: { principalId: "pr_me", orgRole: "member", managedTeamIds: ["t9"] } });
      expect(otherTeam).not.toContain(editLabel);
      expect(render("pr_me")).toContain(editLabel);
    });

    it("lets an editor change an existing label in place", () => {
      resetPersonLabelsForTests({ pr_ada: "CTO" });
      fixture.role = "admin";
      const html = render();
      expect(html).toMatch(/aria-label="Edit label"[^>]*data-inline-edit="text"[\s\S]*?>CTO</);
    });
  });
});
