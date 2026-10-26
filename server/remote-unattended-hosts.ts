// The enrolled hosts of the Remote Sessions page (contract: sagax-remote-access
// docs/inscription-hote.md, "Côté Sagax"): list the hosts Perspicax enrolled
// for unattended access, open an unattended session against one (host_id, not
// a code), and revoke one. Perspicax is the authority on every host: it
// refuses a revoked or expired host (C1), intersects the scope with the
// enrollment, and tells the host at its next beat.
//
// Calls go to Perspicax in the name of the person on the page, through the
// Perspicax MCP link a bot of theirs mounts (the same relay as a turn), so a
// session opened here becomes the usual card and panel row (client "app")
// through the remote_support_* registrar, and "Prendre le contrôle" takes over.
//
// Rules (decisions of 2026-10-26): any person who reaches this server may open
// (no admin approval); opening is behind SAGAX_UNATTENDED_ACCESS (OFF by
// default); listing and revoking always work, flag OFF included (M2). The
// audit names the person who acted, never the installer (M4). No key, no
// address and no host id ever reaches visible text.
import { parseUnattendedHostId, parseUnattendedHosts, type UnattendedHostRow } from "../shared/remote-unattended-host.ts";
import { handleRemoteSupportCall, openUnattendedSession, type RemoteSupportContext } from "./remote-support-local.ts";

/** Perspicax tools this page calls. `remote_support_open` (with host_id) is in
 * the contract. The list and revoke tool names are NOT in the contract yet
 * (it names the actions, not the tools): TODO(perspicax) align them once
 * Perspicax ships them. Until then an unknown tool reads as "not available". */
export const HOSTS_LIST_TOOL = "remote_support_hosts";
export const HOST_REVOKE_TOOL = "remote_support_host_revoke";

/** One person's link to Perspicax for a page action: a bot of theirs with a
 * Perspicax profile, its conversation (where the session card lands), and one
 * call in their name. `end` releases the link. */
export interface PerspicaxSeat {
  botId: string;
  threadId: string;
  /** One tool call; the body has the shape of /api/internal/perspicax/tool
   * (`text`, `isError`, `owner`). */
  call(tool: string, args: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
  end(): Promise<void>;
}

export interface UnattendedHostsViewer {
  principalId: string;
}

export interface UnattendedHostAuditEvent {
  at: number;
  /** The person who acted on the page (M4), never the installer. */
  actor: string;
  kind: "unattended.open" | "unattended.revoke";
  hostId: string;
  ok: boolean;
}

export type HostsListOutcome = { available: true; hosts: UnattendedHostRow[] } | { available: false; hosts: []; reason: string };
export type HostOpenOutcome =
  | { ok: true; code: string; botId: string; threadId: string }
  | { ok: false; error: "disabled" | "invalid" | "unavailable" | "refused"; message: string };
export type HostRevokeOutcome = { ok: true } | { ok: false; error: "invalid" | "unavailable" | "refused"; message: string };

const NOT_AVAILABLE = "Perspicax does not list enrolled computers yet on this server.";
const NO_SEAT = "None of your bots is linked to Perspicax, so Sagax cannot reach it for you.";

function answerObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return text && typeof text === "object" && !Array.isArray(text) ? text as Record<string, unknown> : null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function refusal(posted: { status: number; body: Record<string, unknown> }): string | null {
  if (posted.status < 400 && posted.body.isError !== true && !posted.body.error) return null;
  const said = typeof posted.body.text === "string" ? posted.body.text : typeof posted.body.error === "string" ? posted.body.error : "";
  return said.slice(0, 400) || "Perspicax refused the call.";
}

/** A status answer that means the session is done (or never coming). */
function finished(text: string): "connected" | "over" | null {
  const state = answerObject(text.split("\n")[0])?.state;
  if (state === "connected") return "connected";
  if (state === "ended" || state === "cancelled" || state === "expired" || state === "closed") return "over";
  return null;
}

export function createUnattendedHosts(deps: {
  /** SAGAX_UNATTENDED_ACCESS: opening only. Listing and revoking ignore it. */
  enabled(): boolean;
  /** The person's Perspicax link, or a reason it cannot be made. */
  seat(principalId: string): Promise<PerspicaxSeat | { error: string }>;
  /** The technician side on this computer (support folder, name, org). */
  local(principalId: string): RemoteSupportContext;
  /** End a Sagax session row by its 12-hex id (cuts control and the tunnel). */
  closeById(id: string): Promise<boolean>;
  audit(event: UnattendedHostAuditEvent): void;
  /** How often and how long the page's open waits for the host's beat. The
   * host polls every `poll_every` (10 s by default), so a minute and a half
   * covers a few missed beats. */
  statusEveryMs?: number;
  statusTries?: number;
  sleep?(ms: number): Promise<void>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const every = deps.statusEveryMs ?? 3_000;
  const tries = deps.statusTries ?? 30;
  /** Sessions opened from this page, per host: revoke ends them here too. */
  const openedFor = new Map<string, Set<string>>();
  const revoked = new Set<string>();

  /** One short call in the person's name; the link ends right after. */
  async function withSeat<T>(principalId: string, work: (seat: PerspicaxSeat) => Promise<T>): Promise<T | { error: string }> {
    const seat = await deps.seat(principalId).catch(() => ({ error: NO_SEAT }));
    if ("error" in seat) return seat;
    try {
      return await work(seat);
    } finally {
      await seat.end().catch(() => {});
    }
  }

  /** Follow a fresh open until the host picked it up: every status goes
   * through the relay, so the registrar posts the card once it says connected.
   * Runs in the background; the seat ends with it. */
  async function follow(seat: PerspicaxSeat, local: RemoteSupportContext, hostId: string, code: string): Promise<void> {
    try {
      for (let i = 0; i < tries; i += 1) {
        await sleep(every);
        if (revoked.has(hostId)) return;
        const answer = await handleRemoteSupportCall({ name: "remote_support_status", args: { code }, local, post: seat.call }).catch(() => null);
        if (!answer || answer.isError) return;
        if (finished(answer.text)) return;
      }
    } finally {
      await seat.end().catch(() => {});
    }
  }

  return {
    /** Opening is usable (the flag). The page hides the button otherwise. */
    openEnabled(): boolean {
      return deps.enabled() === true;
    },

    /** The hosts enrolled in this person's organization. Works flag OFF too,
     * so a host enrolled before the flag was cut can still be revoked. */
    async list(viewer: UnattendedHostsViewer): Promise<HostsListOutcome> {
      const out = await withSeat(viewer.principalId, async (seat) => {
        const posted = await seat.call(HOSTS_LIST_TOOL, {});
        if (refusal(posted)) return null;
        return parseUnattendedHosts(answerObject(posted.body.text), now());
      });
      if (out && "error" in out) return { available: false, hosts: [], reason: out.error };
      if (!out) return { available: false, hosts: [], reason: NOT_AVAILABLE };
      return { available: true, hosts: out };
    },

    /** Open an unattended session against an enrolled host. No admin
     * approval: any person who reaches this server may (decision JC). */
    async open(viewer: UnattendedHostsViewer, rawHostId: string, options: { scope?: string; rights?: string } = {}): Promise<HostOpenOutcome> {
      if (!deps.enabled()) return { ok: false, error: "disabled", message: "Unattended access is not enabled on this server." };
      const hostId = parseUnattendedHostId(rawHostId);
      if (!hostId) return { ok: false, error: "invalid", message: "That computer is not an enrolled host." };
      const local = deps.local(viewer.principalId);
      const seat = await deps.seat(viewer.principalId).catch(() => ({ error: NO_SEAT }));
      if ("error" in seat) {
        deps.audit({ at: now(), actor: viewer.principalId, kind: "unattended.open", hostId, ok: false });
        return { ok: false, error: "unavailable", message: seat.error };
      }
      const out = await openUnattendedSession({
        hostId,
        args: { ...(options.scope ? { scope: options.scope } : {}), ...(options.rights ? { rights: options.rights } : {}) },
        local,
        post: seat.call,
      }).catch(() => ({ ok: false as const, error: "Perspicax could not be reached." }));
      if (!out.ok) {
        await seat.end().catch(() => {});
        deps.audit({ at: now(), actor: viewer.principalId, kind: "unattended.open", hostId, ok: false });
        return { ok: false, error: "refused", message: out.error };
      }
      revoked.delete(hostId);
      const ids = openedFor.get(hostId) ?? new Set<string>();
      ids.add(out.session);
      openedFor.set(hostId, ids);
      deps.audit({ at: now(), actor: viewer.principalId, kind: "unattended.open", hostId, ok: true });
      void follow(seat, local, hostId, out.code);
      return { ok: true, code: out.code, botId: seat.botId, threadId: seat.threadId };
    },

    /** Revoke a host. Always allowed, flag OFF included (M2): Perspicax sets
     * revoked_at and ends the host's sessions; the host stops and uninstalls
     * at its next beat. Sessions opened from this page end here at once. */
    async revoke(viewer: UnattendedHostsViewer, rawHostId: string): Promise<HostRevokeOutcome> {
      const hostId = parseUnattendedHostId(rawHostId);
      if (!hostId) return { ok: false, error: "invalid", message: "That computer is not an enrolled host." };
      const out = await withSeat(viewer.principalId, async (seat) => ({ refused: refusal(await seat.call(HOST_REVOKE_TOOL, { host_id: hostId })) }));
      const unavailable = "error" in out ? out.error : null;
      const refused = "refused" in out ? out.refused : null;
      deps.audit({ at: now(), actor: viewer.principalId, kind: "unattended.revoke", hostId, ok: !unavailable && !refused });
      if (unavailable) return { ok: false, error: "unavailable", message: unavailable };
      if (refused) return { ok: false, error: "refused", message: refused };
      revoked.add(hostId);
      for (const id of openedFor.get(hostId) ?? []) await deps.closeById(id).catch(() => false);
      openedFor.delete(hostId);
      return { ok: true };
    },
  };
}

export type UnattendedHosts = ReturnType<typeof createUnattendedHosts>;
