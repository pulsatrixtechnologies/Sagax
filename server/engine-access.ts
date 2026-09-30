// Which engine access a turn may use on an organization server (slice 3,
// D13), before per-owner keys (slice 4). Pure: the caller gathers the facts.
//
// Solo mode is unchanged: every turn uses what the server has.
//
// Organization mode:
//   - everything configured on the server (subscriptions logged in on it,
//     the workspace keys) serves only an admin owner speaking to their own
//     bot;
//   - every other turn (a member's own bot, anyone on someone else's bot,
//     a member bot's routines) needs the organization setting
//     memberBotsUseOrgKey AND a key-backed instance: the workspace key is
//     then the organization's key. Login-backed engines (Codex, grokAgent,
//     ACP agents) never serve those turns.
//   - an instance whose CLI is not installed is `engine_missing` first,
//     whoever speaks.
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 4 bis ("Où vivent les accès aux engines", "Échecs visibles").

export type EngineAccessRefusal = "engine_missing" | "no_access";

export interface EngineAccessInput {
  identity: "solo" | "perspicax";
  /** The person whose message started the turn; absent when no person
   * other than the owner is known (a routine, a bot-to-bot hop, the
   * operator at this computer). */
  speakerPrincipalId?: string;
  ownerPrincipalId: string;
  /** The owner's organization role; the operator at this computer counts
   * as an admin. */
  ownerOrgRole: "admin" | "member" | undefined;
  memberBotsUseOrgKey: boolean;
  driver: string;
  /** The instance's driver reads a key the workspace configured. */
  keyBacked: boolean;
  /** The instance's CLI answered its availability probe (true when not
   * probed yet: an unknown is never a refusal). */
  installed: boolean;
}

export type EngineAccess = { ok: true; via: "server" | "org-key" } | { ok: false; reason: EngineAccessRefusal };

const key = (id: string | undefined) => id?.trim().toLowerCase() ?? "";

export function engineAccessFor(input: EngineAccessInput): EngineAccess {
  if (input.identity !== "perspicax") return { ok: true, via: "server" };
  if (!input.installed) return { ok: false, reason: "engine_missing" };
  const speaker = input.speakerPrincipalId ? key(input.speakerPrincipalId) : key(input.ownerPrincipalId);
  const ownerSpeaks = speaker !== "" && speaker === key(input.ownerPrincipalId);
  if (ownerSpeaks && input.ownerOrgRole === "admin") return { ok: true, via: "server" };
  if (input.memberBotsUseOrgKey && input.keyBacked) return { ok: true, via: "org-key" };
  return { ok: false, reason: "no_access" };
}

/** The notification body for a refused turn (never provider text). */
export function engineAccessNotice(reason: EngineAccessRefusal | "key_refused", engine: string): string {
  if (reason === "engine_missing") return `This bot uses ${engine}, which is not installed on this server.`;
  if (reason === "key_refused") return "The provider refused this bot's key.";
  return `This bot can't answer: no key for ${engine}. Its owner has to add one.`;
}

/** A bot owned by someone who is not an organization admin (JC rule until
 * per-owner containers): it never runs with full access, and its server
 * commands need an admin's approval. */
export function memberOwnedBot(input: { identity: "solo" | "perspicax"; ownerOrgRole: "admin" | "member" | undefined }): boolean {
  return input.identity === "perspicax" && input.ownerOrgRole !== "admin";
}

/** An approval card that would run a command on the server: the provider
 * described a shell command, or the tool is a shell or exec tool. */
export function serverCommandApproval(input: { tool?: string; command?: unknown }): boolean {
  if (input.command) return true;
  const tool = input.tool?.trim() ?? "";
  return /^(bash|shell|sh|exec|execute|exec_command|run_command|run_shell_command|local_shell|terminal)$/i.test(tool) || /(^|[_.:])(bash|shell|exec)([_.:]|$)/i.test(tool);
}

/** A setup error from a key-backed engine on an organization server (the
 * provider refused the key: 401, invalid key, quota) becomes the
 * key_refused card instead of the generic error row. `redact` cleans the
 * provider's words, which only the owner and admins receive. Null when the
 * error is anything else. */
export function keyRefusedCard(input: {
  identity: "solo" | "perspicax";
  setup: boolean | undefined;
  claudeUpdate: boolean | undefined;
  keyBacked: boolean;
  message: string;
  botId: string;
  ownerPrincipalId: string;
  engine: string;
  redact: (text: string) => string;
}): { reason: "key_refused"; engine: string; botId: string; ownerPrincipalId: string; detail?: string } | null {
  if (input.identity !== "perspicax" || !input.setup || input.claudeUpdate || !input.keyBacked) return null;
  const detail = input.redact(input.message.trim()).slice(0, 200);
  return { reason: "key_refused", engine: input.engine, botId: input.botId, ownerPrincipalId: input.ownerPrincipalId, ...(detail ? { detail } : {}) };
}

/** What a viewer receives of an access card: `detail` (the provider's
 * redacted words) only for the bot's owner and organization admins. */
export function accessCardForViewer<T extends { access?: { ownerPrincipalId: string; detail?: string } }>(message: T, viewer: { principalId?: string; admin: boolean }): T {
  const access = message.access;
  if (!access?.detail || viewer.admin || (viewer.principalId && viewer.principalId.toLowerCase() === access.ownerPrincipalId.toLowerCase())) return message;
  const { detail: _hidden, ...rest } = access;
  return { ...message, access: rest };
}

/** Who may answer a card on an organization server: "admin" lets an
 * organization admin answer an adminApproval card without being the bot's
 * owner; "refused" is anyone else on such a card (the owner included:
 * 403 admin_approval_required); null is every other card, answered as
 * before. A card already settled is no longer an admin approval. */
export function adminApprovalDecision(input: {
  identity: "solo" | "perspicax";
  card: { adminApproval?: boolean; answered?: unknown; dismissed?: unknown; expired?: unknown } | null | undefined;
  callerIsOrgAdmin: boolean;
}): "admin" | "refused" | null {
  const card = input.card;
  if (input.identity !== "perspicax" || !card?.adminApproval || card.answered || card.dismissed || card.expired) return null;
  return input.callerIsOrgAdmin ? "admin" : "refused";
}
