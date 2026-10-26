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
import { viewerBotsReadOnly, viewerCan, viewerIsOrgMember } from "./viewer";
import { BOT_FIELD_PERMISSIONS } from "../../shared/permissions";

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
  if (options?.draft || viewerOwnsBot(config, bot)) {
    if (isMemberBotField(field)) return true;
    // 2026-10-09: a field their profile's permissions open (shared/permissions.ts).
    const permission = BOT_FIELD_PERMISSIONS[field];
    return permission !== undefined && viewerCan(config, permission);
  }
  return isClientBotPatchField(field);
}

/** The Primary Bot switch. Taking and leaving the role is the owner's own
 * route (POST and DELETE /api/bots/:id/primary) on a bot that exists; on a
 * draft the owner sends chiefOfStaff with the new bot (2026-10-26: a member
 * picks their own Primary Bot without an admin). */
export function canStepPrimary(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
  options?: { draft?: boolean },
): boolean {
  if (viewerBotsReadOnly(config)) return false;
  if (!viewerIsOrgMember(config)) return true;
  if (options?.draft) return canEditBotField(config, bot, "chiefOfStaff", options);
  return viewerOwnsBot(config, bot);
}

/** Rename writes `name`, a member field. A non-owner member is refused. */
export function showBotRename(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
): boolean {
  return canEditBotField(config, bot, "name");
}

/** Archive and restore write `hidden`. 2026-10-26: an organization
 * member archives and restores the bots they own (BOT_FIELD_PERMISSIONS),
 * never someone else's. */
export function showBotArchive(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
): boolean {
  if (!viewerIsOrgMember(config)) return true;
  return canEditBotField(config, bot, "hidden");
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

/** Moving a bot between server sections writes `section`. A personal
 * sidebar section is this person's preference and stays. 2026-10-26:
 * a member moves the bots they own (every one of `bots`), never another
 * person's. */
export function showServerSectionMove(
  config: ConfigStatus | null | undefined,
  personal: boolean,
  bots: ReadonlyArray<{ ownerUserId?: string | null }> = [],
): boolean {
  if (personal) return true;
  if (!viewerIsOrgMember(config)) return true;
  return bots.length > 0 && bots.every((bot) => canEditBotField(config, bot, "section"));
}

/** Teach by demonstration in the bot's browser (Composer's "Show in the
 * browser"). The owner on this machine or an admin session, as before; and
 * 2026-10-26 (JC): an organization member on a bot they own, whose browser
 * runs in their own server environment (/api/desktop-viewer/sandbox/me),
 * never on someone else's bot. */
export function canTeachInBrowser(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
  ownerOrAdmin: boolean | null,
): boolean {
  if (ownerOrAdmin === true) return true;
  if (!viewerIsOrgMember(config) || viewerBotsReadOnly(config)) return false;
  return viewerOwnsBot(config, bot);
}
