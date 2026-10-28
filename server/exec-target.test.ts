import { describe, expect, it } from "vitest";

import { cardStandingGrants, orgServerExecRouting, webhookExecTargetAdminOnly, workplaceIsBotComputer } from "./exec-target.ts";

describe("orgServerExecRouting", () => {
  it("defaults a non-admin's command to the bot's own computer when it has one", () => {
    expect(orgServerExecRouting({ callerMayDriveOrgServer: false, botHasOwnComputer: true })).toBe("use-bot-computer");
  });

  it("refuses a non-admin's command when the bot has no computer, instead of falling back to the server", () => {
    expect(orgServerExecRouting({ callerMayDriveOrgServer: false, botHasOwnComputer: false })).toBe("no-computer");
  });

  it("keeps the admin 'runs on the server' card when an admin drives the turn, even without a bot computer", () => {
    expect(orgServerExecRouting({ callerMayDriveOrgServer: true, botHasOwnComputer: false })).toBe("admin-card");
    expect(orgServerExecRouting({ callerMayDriveOrgServer: true, botHasOwnComputer: true })).toBe("admin-card");
  });
});

describe("workplaceIsBotComputer", () => {
  it("counts the owner's server environment and own computer as the bot's computer", () => {
    expect(workplaceIsBotComputer("user-sandbox")).toBe(true);
    expect(workplaceIsBotComputer("user-desktop")).toBe(true);
  });

  it("does not count the shared host, nothing mounted, or an absent target", () => {
    expect(workplaceIsBotComputer("host")).toBe(false);
    expect(workplaceIsBotComputer("none")).toBe(false);
    expect(workplaceIsBotComputer(undefined)).toBe(false);
  });
});

describe("webhookExecTargetAdminOnly", () => {
  it("lets the owner create a webhook on the bot's own computer without the server-settings right", () => {
    expect(webhookExecTargetAdminOnly("maus")).toBe(false);
    expect(webhookExecTargetAdminOnly("cloud")).toBe(false);
    expect(webhookExecTargetAdminOnly(undefined)).toBe(false);
    expect(webhookExecTargetAdminOnly("")).toBe(false);
    expect(webhookExecTargetAdminOnly("MAUS")).toBe(false);
  });

  it("requires admin only for a target on the shared organization server", () => {
    expect(webhookExecTargetAdminOnly("server")).toBe(true);
    expect(webhookExecTargetAdminOnly("org-server")).toBe(true);
  });
});

describe("standing grants of a card (#1098)", () => {
  it("opens the session allow, the saved command and the key to the owner in their own sandbox, keeps the shared host's rule", () => {
    expect(cardStandingGrants({ memberOwned: true, ownSandbox: true, callerManagesHostCommands: false })).toEqual({ offered: true, ownerSavesCommand: true });
    expect(cardStandingGrants({ memberOwned: true, ownSandbox: false, callerManagesHostCommands: false })).toEqual({ offered: false, ownerSavesCommand: false });
    expect(cardStandingGrants({ memberOwned: true, ownSandbox: false, callerManagesHostCommands: true }).ownerSavesCommand).toBe(true);
    expect(cardStandingGrants({ memberOwned: false, ownSandbox: false, callerManagesHostCommands: false }).offered).toBe(true);
  });
});
