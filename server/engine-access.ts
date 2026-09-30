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

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { resolveEngineAccess } from "./engine-credentials.ts";

export type EngineAccessRefusal = "engine_missing" | "no_access";

/** Who a turn speaks for, stated by the path that starts it (the gate
 * never guesses the owner from a missing speaker):
 *   - person: a person's message; with no principal id the person is
 *     unknown and never counts as the owner;
 *   - operator: the operator at this computer (a loopback request);
 *   - owner-routine: the owner's routine, webhook or other automation;
 *   - peer: another bot's hop (ask_bot, delegation, an opened thread, an
 *     aside, a Chief's retry). `principalId` is whoever the source turn spoke
 *     for ("" when that was an unknown person); absent, the requesting bot's
 *     owner speaks. `routine` marks a hop a routine or other automation
 *     started, directly or through other hops: it never reaches anyone's
 *     Perspicax access (slice 5, D5), whoever it speaks for. */
export type TurnSpeaker =
  | { origin: "person"; principalId?: string }
  | { origin: "operator" }
  | { origin: "owner-routine" }
  | { origin: "peer"; fromBotId?: string; principalId?: string; routine?: true };

/** A turn a routine or other automation started, directly or through hops. */
export function routineLineage(speaker: TurnSpeaker): boolean {
  return speaker.origin === "owner-routine" || (speaker.origin === "peer" && speaker.routine === true);
}

/** The speaker a turn start implies when its path did not state one. Fails
 * closed: nothing known about the speaker is an unknown person. */
export function resolveTurnSpeaker(input: {
  speaker?: TurnSpeaker;
  sender?: { id?: string };
  peerAsk?: { botId: string };
  trigger?: { kind: string };
  automationSource?: string;
}): TurnSpeaker {
  if (input.speaker) return input.speaker;
  if (input.peerAsk) return { origin: "peer", fromBotId: input.peerAsk.botId };
  if (input.sender?.id) return { origin: "person", principalId: input.sender.id };
  if (input.automationSource || input.trigger?.kind === "routine") return { origin: "owner-routine" };
  if (input.trigger?.kind === "owner") return { origin: "operator" };
  return { origin: "person" };
}

/** The principal a turn speaks for: "" when unknown (never the owner). A
 * peer hop with no known source speaks for the requesting bot's owner. */
export function speakerPrincipal(speaker: TurnSpeaker, ownerPrincipalId: string, peerOwnerPrincipalId?: string): string {
  switch (speaker.origin) {
    case "person": return speaker.principalId ?? "";
    case "operator":
    case "owner-routine": return ownerPrincipalId;
    case "peer": return speaker.principalId ?? peerOwnerPrincipalId ?? "";
  }
}

export interface EngineAccessInput {
  identity: "solo" | "perspicax";
  /** Who the turn speaks for (see TurnSpeaker). */
  speaker: TurnSpeaker;
  /** For a peer hop: the owner of the bot that asked. */
  peerOwnerPrincipalId?: string;
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

/** The slice 3 gate: server/engine-credentials.ts with no subscription and
 * no owner key (slice 4 adds both steps; this wrapper keeps the old answers). */
export function engineAccessFor(input: EngineAccessInput): EngineAccess {
  const plan = resolveEngineAccess({
    identity: input.identity,
    speaker: input.speaker,
    ...(input.peerOwnerPrincipalId !== undefined ? { peerOwnerPrincipalId: input.peerOwnerPrincipalId } : {}),
    owner: { principalId: input.ownerPrincipalId, orgRole: input.ownerOrgRole },
    instance: { instanceId: "", driver: input.driver, installed: input.installed },
    subscriptionSignedIn: () => false,
    ownerHasKey: () => false,
    memberBotsUseOrgKey: input.memberBotsUseOrgKey,
    keyBacked: input.keyBacked,
  });
  if (!plan.ok) return plan;
  return { ok: true, via: plan.via === "org-key" ? "org-key" : "server" };
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

/** File tools an owner may approve for their own bot when every path stays
 * in the bot's own task workspace. */
const WORKSPACE_FILE_TOOLS = new Set(["read", "write", "edit", "multiedit", "notebookedit", "notebookread", "glob", "grep", "ls"]);

/** A path's real location: the deepest existing ancestor resolved through
 * its symlinks, then the part that does not exist yet. */
function realLocation(path: string): string {
  const absolute = resolve(path);
  let head = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail.reverse());
    } catch {
      const parent = dirname(head);
      if (parent === head) return absolute;
      tail.push(basename(head));
      head = parent;
    }
  }
}

/** Whether a permission card of a member's bot on an organization server
 * waits for an organization admin (JC rule until per-owner containers). Every
 * bot shares one container, one user and one HOME, so a write to the shared
 * Claude settings or a read of a secret is as good as a server command.
 * The owner answers only a file tool (Read, Write, Edit, ...) whose every
 * path is absolute and, symlinks resolved, stays inside the bot's own task
 * workspace outside any dot folder (.claude, .git, .mcp.json can hold
 * commands). Everything else, a shell command first, needs an admin. */
export function memberBotAdminApproval(input: { tool?: string; command?: unknown; paths?: string[]; workspaceRoot: string }): boolean {
  if (serverCommandApproval(input)) return true;
  const tool = input.tool?.trim().toLowerCase() ?? "";
  if (!WORKSPACE_FILE_TOOLS.has(tool)) return true;
  if (!input.paths?.length) return true;
  const root = realLocation(input.workspaceRoot);
  return !input.paths.every((path) => {
    if (typeof path !== "string" || !isAbsolute(path)) return false;
    const rel = relative(root, realLocation(path));
    if (rel === "") return true;
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return false;
    return !rel.split(sep).some((segment) => segment.startsWith("."));
  });
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
