// Who may press "Apply setup" on a team setup card from a signed-in
// session (2026-10-26, #1058).
//
// An organization admin applies any setup. A member applies a setup that
// only does what they could already do by hand on their own bots: the
// requesting Primary Bot and every bot the plan changes are theirs, new
// bots need their right to create bots, and each field stays within what a
// member sets on a bot they own (name, title, description, instructions,
// model), or the permission that field needs (a working folder, another
// team). A new team, a Primary Bot role change, a deletion, or a new bot
// on an automatic level the organization refuses for members' bots stays
// an admin's. Nothing here widens a member's rights: the same plan done by
// hand needs the same rights.

import type { PermissionKey } from "../shared/permissions.ts";
import { TEAM_SETUP_ADMIN_REQUIRED, type TeamSetupRequest } from "../shared/team-setup.ts";

export { TEAM_SETUP_ADMIN_REQUIRED, TEAM_SETUP_DESKTOP_ONLY } from "../shared/team-setup.ts";

export const TEAM_SETUP_DESKTOP_MESSAGE =
  "Approve team setup or deletion from the desktop app or a paired Full-access device. In a local browser, wait until every bot is idle.";
export const TEAM_SETUP_ADMIN_MESSAGE =
  "This setup needs an organization admin on this server: it creates a team, changes the Primary Bot role, deletes a bot, or changes a bot that is not yours. Ask an admin to apply it.";

export interface MemberSetupContext {
  /** The signed-in person, lowercased. */
  callerId: string;
  /** The effective owner of a bot, lowercased; undefined when it is gone. */
  ownerOf(botId: string): string | undefined;
  /** The bot's team as it stands (trimmed, "" for General). */
  sectionOf(botId: string): string | undefined;
  /** The person may create bots on this server. */
  mayCreateBots: boolean;
  /** Whether the person holds this permission. */
  can(permission: PermissionKey): boolean;
  /** A new bot starts on Auto: refused for members' bots by the organization. */
  newBotAutoRefused: boolean;
}

export type MemberSetupRefusal = { code: typeof TEAM_SETUP_ADMIN_REQUIRED; error: string; permission?: PermissionKey };

const MEMBER_FIELDS = new Set(["name", "title", "description", "soul", "modelSelection"]);
const FIELD_PERMISSIONS: Record<string, PermissionKey> = { section: "sharing.visibility", cwd: "folders.botWorkingFolder" };

const admin = (): MemberSetupRefusal => ({ code: TEAM_SETUP_ADMIN_REQUIRED, error: TEAM_SETUP_ADMIN_MESSAGE });
const missing = (permission: PermissionKey): MemberSetupRefusal => ({ code: TEAM_SETUP_ADMIN_REQUIRED, error: TEAM_SETUP_ADMIN_MESSAGE, permission });
const team = (value: string | undefined) => (value ?? "").trim();

/** Why a member may not apply this setup, or null when they may. */
export function memberTeamSetupRefusal(request: TeamSetupRequest, context: MemberSetupContext): MemberSetupRefusal | null {
  const caller = context.callerId.trim().toLowerCase();
  if (!caller || request.deletion || request.newTeams.length) return admin();
  if (context.ownerOf(request.botId) !== caller) return admin();
  const requesterSection = context.sectionOf(request.botId);
  for (const operation of request.operations) {
    if (operation.action === "update" && context.ownerOf(operation.botId) !== caller) return admin();
    if (operation.action === "create") {
      if (!context.mayCreateBots) return missing("bots.create");
      if (context.newBotAutoRefused) return admin();
    }
    const current = operation.action === "update" ? context.sectionOf(operation.botId) : requesterSection;
    for (const [field, value] of Object.entries(operation.fields)) {
      if (value === undefined || MEMBER_FIELDS.has(field)) continue;
      // the bot stays in the team it is in (a new one beside its Primary Bot)
      if (field === "section" && team(value as string) === team(current)) continue;
      if (field === "cwd" && value === "") continue;
      const permission = FIELD_PERMISSIONS[field];
      if (!permission) return admin();
      if (!context.can(permission)) return missing(permission);
    }
  }
  return null;
}
