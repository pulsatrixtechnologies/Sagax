// Automatic approval levels for members' bots on an organization server
// (2026-10-16, security review of #678).
//
// A bot whose owner is not an organization admin (memberOwnedBot) runs its
// Auto ("Approve for me") and Auto-accept edits levels as such only while
// an organization admin turned `organization.memberAutoApproval` on
// (Settings > Organization, the admin API's `POST settings`). Absent or
// false: those levels run as Ask, and a change of a member's bot to one of
// them is refused (`member_auto_not_allowed`). Custom stays Ask and Full
// keeps its own rules (org-full-access.ts) either way.
//
// Before this setting existed a member's saved Auto was inert (it ran as
// Ask), then #678 made it run for real. So once per organization server,
// unless the setting is already on, every saved Auto or Auto-accept edits
// level of a member's bot (the bot's own and each thread's) goes back to
// Ask, and `organization.memberAutoResetAt` records the pass. When an admin
// later turns the setting on, old levels do not come back by themselves:
// members choose again.

import type { ApprovalMode } from "../shared/approval-mode.ts";

export const MEMBER_AUTO_NOT_ALLOWED = {
  error: "Automatic approval levels are turned off for members' bots in this organization. An organization admin can allow them in Settings > Organization.",
  code: "member_auto_not_allowed",
} as const;

/** The organization's policy: off unless an admin turned it on. */
export function memberAutoApprovalAllowed(organization: { memberAutoApproval?: unknown } | undefined): boolean {
  return organization?.memberAutoApproval === true;
}

/** The levels this setting governs. */
export function memberAutoLevel(mode: string | undefined): mode is "auto" | "edits" {
  return mode === "auto" || mode === "edits";
}

/** The level a member's bot runs at for one turn, from its stored level:
 * Auto and Auto-accept edits only while the organization allows them. */
export function memberTurnLevel(stored: ApprovalMode, policyAllowed: boolean): ApprovalMode {
  return memberAutoLevel(stored) && !policyAllowed ? "ask" : stored;
}

/** Whether a change of a member's bot to `to` is refused: an automatic
 * level, while the organization does not allow it, that differs from a
 * level it replaces (resending the same level is not a change). */
export function memberAutoChangeRefused(input: { memberOwned: boolean; policyAllowed: boolean; froms: ReadonlyArray<string | undefined>; to: string }): boolean {
  if (!input.memberOwned || input.policyAllowed || !memberAutoLevel(input.to)) return false;
  return input.froms.some((from) => (from ?? "ask") !== input.to);
}

interface LevelHolder {
  approvalMode?: unknown;
  autoApprove?: unknown;
}

export interface MemberAutoResetBot extends LevelHolder {
  id: string;
  tasks?: Array<LevelHolder & { threadId: string }>;
}

export interface MemberAutoReset {
  /** Bots whose own saved level goes back to Ask. */
  bots: string[];
  /** Threads whose own saved level goes back to Ask. */
  threads: Array<{ botId: string; threadId: string }>;
}

/** A record's own saved level when it is automatic: `approvalMode`, or the
 * legacy `autoApprove` bit when no level was ever saved. A thread with
 * neither follows its bot, which is reset on its own. */
function savedAutomatic(record: LevelHolder): boolean {
  if (typeof record.approvalMode === "string") return memberAutoLevel(record.approvalMode);
  return record.autoApprove === true;
}

/** The one-time pass: which saved levels of members' bots go back to Ask.
 * Pure; the caller writes `{ approvalMode: "ask", autoApprove: false }` on
 * each and records the marker. */
export function memberAutoLevelResets(bots: readonly MemberAutoResetBot[], memberOwned: (bot: MemberAutoResetBot) => boolean): MemberAutoReset {
  const out: MemberAutoReset = { bots: [], threads: [] };
  for (const bot of bots) {
    if (!memberOwned(bot)) continue;
    if (savedAutomatic(bot)) out.bots.push(bot.id);
    for (const task of bot.tasks ?? []) {
      if (savedAutomatic(task)) out.threads.push({ botId: bot.id, threadId: task.threadId });
    }
  }
  return out;
}

/** Whether the pass still has to run: an organization server with no
 * marker yet. The caller resets nothing when the setting is already on,
 * and records the marker either way. */
export function memberAutoResetPending(identity: "solo" | "perspicax", organization: { memberAutoResetAt?: unknown } | undefined): boolean {
  return identity === "perspicax" && typeof organization?.memberAutoResetAt !== "number";
}
