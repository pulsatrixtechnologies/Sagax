// Which bot fields this viewer may save. The server enforces the same
// split in request-auth.ts and the bot PATCH handler (memberBotFieldViolation
// for a bot the person owns or was granted edit on, clientBotPatchViolation
// otherwise). The client hides the control so the save never answers 403.
//
// The client has no grant level. Someone granted edit on a bot they do not
// own is treated here as look-only; the server would have allowed the
// member field set. That is narrower than the server, and it never shows a
// control the server refuses.
import type { ConfigStatus } from "@/state/store";
import { isClientBotPatchField, isMemberBotField } from "../../shared/viewer-capabilities";
import { viewerBotsReadOnly, viewerIsOrgMember } from "./viewer";

export function viewerOwnsBot(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
): boolean {
  const viewer = config?.viewer;
  if (!viewer || viewer.operator || viewer.role !== "member") return true;
  const principal = viewer.principalId?.trim().toLowerCase() ?? "";
  const owner = bot.ownerUserId?.trim().toLowerCase() ?? "";
  return Boolean(principal) && principal === owner;
}

/** A read-only person edits nothing. Solo, an admin, and a missing viewer
 * edit everything. An organization member edits the member field set on a
 * bot they own or are drafting, and only how any other bot looks. */
export function canEditBotField(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
  field: string,
  options?: { draft?: boolean },
): boolean {
  if (viewerBotsReadOnly(config)) return false;
  if (!viewerIsOrgMember(config)) return true;
  if (options?.draft || viewerOwnsBot(config, bot)) return isMemberBotField(field);
  return isClientBotPatchField(field);
}

/** The Primary Bot switch. Taking and leaving the role is the owner's own
 * route (POST and DELETE /api/bots/:id/primary), not a member field. A
 * draft cannot send chiefOfStaff on create, so the switch stays hidden
 * until the bot exists. */
export function canStepPrimary(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
  options?: { draft?: boolean },
): boolean {
  if (viewerBotsReadOnly(config)) return false;
  if (!viewerIsOrgMember(config)) return true;
  if (options?.draft) return false;
  return viewerOwnsBot(config, bot);
}

/** Rename writes `name`, a member field. A non-owner member is refused. */
export function showBotRename(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
): boolean {
  return canEditBotField(config, bot, "name");
}

/** Archive writes `hidden`, which is not a member field. An organization
 * member is refused, including on a bot they own. An admin is not a member
 * here and the server still accepts the write. */
export function showBotArchive(config: ConfigStatus | null | undefined): boolean {
  return !viewerIsOrgMember(config);
}

/** Delete is the owner or an admin. A read-only person is refused even on
 * their own bot (`memberOwnsBot` requires bot creation). */
export function showBotDelete(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
): boolean {
  if (viewerBotsReadOnly(config)) return false;
  if (!viewerIsOrgMember(config)) return true;
  return viewerOwnsBot(config, bot);
}

/** Moving a bot between server sections writes `section`, not a member field.
 * A personal sidebar section is this person's preference and stays. */
export function showServerSectionMove(config: ConfigStatus | null | undefined, personal: boolean): boolean {
  if (personal) return true;
  return !viewerIsOrgMember(config);
}
