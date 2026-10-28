// Where a member bot's commands, code and actions run on an organization
// server, and who may target the shared server (2026-10-22).
//
// A member-owned bot's own computer is its server environment
// (sagax-environment, one isolated Linux sandbox per person), the Local VM or
// This computer of its owner (sagax-desktop), or its cloud computer. A raw
// host shell (Bash, shell, ...) runs on the SHARED organization server, which
// is an admin's to drive.
//
// Decision: a bot must run on its OWN computer by default and never assume it can
// run on the shared server; and only an admin may target the shared server.
// So a member bot's server command no longer waits for an admin in a dead
// end. When a non-admin drives the turn:
//   - the bot has its own computer  -> it is told to run there (no card),
//   - the bot has no computer        -> it is refused, with the reason that
//     only an admin runs on the server (no silent fallback to the server).
// When an admin drives the turn (or a person an admin gave the server-command
// right), the existing "runs on the server" card stays: an admin may target
// the shared server.
//
// Pure, tested on its own (server/exec-target.test.ts). The server decides
// the routing; it is never a UI-only choice.

export type OrgServerExecRouting = "admin-card" | "use-bot-computer" | "no-computer";

/** The routing for a member bot's command that would run on the shared
 * organization server. */
export function orgServerExecRouting(input: {
  /** An organization admin (or the local operator) drives this turn, or a
   * person an admin gave the server-command right: the shared server is
   * theirs to drive, so the existing "runs on the server" card stays. */
  callerMayDriveOrgServer: boolean;
  /** The bot has its own computer this turn: its server environment, its
   * Local VM or This computer, or its cloud computer. */
  botHasOwnComputer: boolean;
}): OrgServerExecRouting {
  if (input.callerMayDriveOrgServer) return "admin-card";
  return input.botHasOwnComputer ? "use-bot-computer" : "no-computer";
}

/** A workplace target that means the bot has its own computer for the turn:
 * its owner's server environment ("user-sandbox"), the owner's own computer
 * or its Local VM ("user-desktop"). "host" (a solo server's own machine),
 * "none" (no sandbox, nobody known) and an absent target do not. */
export function workplaceIsBotComputer(target: string | undefined): boolean {
  return target === "user-sandbox" || target === "user-desktop";
}

/** The run targets a webhook (and any bot feature with an "Exécuter sur"
 * choice) may use that stay on the bot's own computer: "maus" (This computer)
 * and "cloud" (the bot's cloud computer). An absent or empty value is the
 * default, This computer. Only a target on the shared organization server is
 * an admin's, so only that one requires the server-settings right. */
const BOT_OWN_RUN_TARGETS: ReadonlySet<string> = new Set(["", "maus", "cloud"]);

export function webhookExecTargetAdminOnly(runOn: string | undefined): boolean {
  return !BOT_OWN_RUN_TARGETS.has((runOn ?? "").trim().toLowerCase());
}

/** 2026-10-27 (#1098): whether a card offers its standing grants (the
 * engine's session allow, the saved command list, an Always allow key) and
 * who saves a command from it. A member's bot on an organization server gets
 * them only for a call in the person's own sandbox (their cloud computer or
 * Local VM, mounted for this turn), where the owner answers and saves; on the
 * shared host they stay an admin's or a host.shell holder's
 * (`callerManagesHostCommands`). Any other bot keeps them as before. */
export function cardStandingGrants(input: { memberOwned: boolean; ownSandbox: boolean; callerManagesHostCommands: boolean }): { offered: boolean; ownerSavesCommand: boolean } {
  return {
    offered: !input.memberOwned || input.ownSandbox,
    ownerSavesCommand: input.ownSandbox || input.callerManagesHostCommands,
  };
}

