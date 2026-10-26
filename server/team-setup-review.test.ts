import { describe, expect, it } from "vitest";

import { memberTeamSetupRefusal, TEAM_SETUP_ADMIN_REQUIRED, type MemberSetupContext } from "./team-setup-review.ts";
import type { TeamSetupOperation, TeamSetupRequest } from "../shared/team-setup.ts";

const selection = { instanceId: "claude", model: "sonnet" };
const bots: Record<string, { owner: string; section: string }> = {
  chief: { owner: "pr_mia", section: "Ops" },
  mine: { owner: "pr_mia", section: "Ops" },
  theirs: { owner: "pr_leo", section: "Ops" },
};
const context = (over: Partial<MemberSetupContext> = {}): MemberSetupContext => ({
  callerId: "pr_mia",
  ownerOf: (id) => bots[id]?.owner,
  sectionOf: (id) => bots[id]?.section,
  mayCreateBots: true,
  can: () => false,
  newBotAutoRefused: false,
  ...over,
});
const request = (operations: TeamSetupOperation[], over: Partial<TeamSetupRequest> = {}): TeamSetupRequest => ({
  version: 1, requestId: "r1", botId: "chief", threadId: "t1", reason: "Migrate my bots", createdAt: 1, requesterRevision: "x",
  newTeams: [], operations, ...over,
});
const create = (name: string, fields: Record<string, unknown> = {}): TeamSetupOperation => ({ action: "create", botId: `new-${name}`, threadId: `t-${name}`,
  fields: { name, title: "Specialist", soul: "Do the work.", section: "Ops", modelSelection: selection, ...fields } });

describe("a member applies team setup on their own bots (#1058)", () => {
  it("lets the owner create bots beside their Primary Bot and change their own bots' profile and model", () => {
    expect(memberTeamSetupRefusal(request([create("Ana"), create("Ben"), create("Cy")]), context())).toBeNull();
    expect(memberTeamSetupRefusal(request([{ action: "update", botId: "mine", fields: { title: "Writer", modelSelection: selection, section: "Ops" } }]), context())).toBeNull();
  });

  it("keeps someone else's bot, a new team, a deletion and the Primary Bot role an admin's", () => {
    const refused = { code: TEAM_SETUP_ADMIN_REQUIRED };
    expect(memberTeamSetupRefusal(request([{ action: "update", botId: "theirs", fields: { title: "x" } }]), context())).toMatchObject(refused);
    expect(memberTeamSetupRefusal(request([create("Ana", { section: "Lab" })], { newTeams: ["Lab"] }), context())).toMatchObject(refused);
    expect(memberTeamSetupRefusal(request([], { deletion: { botId: "mine", name: "mine", expectedRevision: "y" } }), context())).toMatchObject(refused);
    expect(memberTeamSetupRefusal(request([{ action: "update", botId: "mine", fields: { chiefOfStaff: true } }]), context())).toMatchObject(refused);
    // a Primary Bot someone else owns
    expect(memberTeamSetupRefusal(request([create("Ana")]), context({ callerId: "pr_leo" }))).toMatchObject(refused);
  });

  it("asks for the same permission the change needs by hand, never more, never less", () => {
    expect(memberTeamSetupRefusal(request([create("Ana")]), context({ mayCreateBots: false }))).toMatchObject({ permission: "bots.create" });
    expect(memberTeamSetupRefusal(request([{ action: "update", botId: "mine", fields: { section: "Sales" } }]), context())).toMatchObject({ permission: "sharing.visibility" });
    expect(memberTeamSetupRefusal(request([{ action: "update", botId: "mine", fields: { section: "Sales" } }]), context({ can: (key) => key === "sharing.visibility" }))).toBeNull();
    expect(memberTeamSetupRefusal(request([create("Ana", { cwd: "/srv/work" })]), context())).toMatchObject({ permission: "folders.botWorkingFolder" });
    expect(memberTeamSetupRefusal(request([create("Ana", { cwd: "" })]), context())).toBeNull();
    // a new bot starts on Auto: never when the organization refuses it for members' bots
    expect(memberTeamSetupRefusal(request([create("Ana")]), context({ newBotAutoRefused: true }))).toMatchObject({ code: TEAM_SETUP_ADMIN_REQUIRED });
  });
});
