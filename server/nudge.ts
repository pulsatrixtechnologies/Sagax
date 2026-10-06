// An MSN-style nudge from one person to another, or to the other people
// in a group chat.
// The cooldown lives on the server (one map for every client of this
// process) so a second window cannot send again inside the window.
// A person key is the sender plus that person. The other direction is its
// own key. A group key is `group:<id>` for both sides, so the room shakes
// at most once every five minutes, and a direct nudge does not start that
// clock.

export const NUDGE_COOLDOWN_MS = 5 * 60 * 1000;

export type NudgeVerdict =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

const pairKey = (senderId: string, targetId: string) =>
  `${senderId.trim().toLowerCase()}\0${targetId.trim().toLowerCase()}`;

/** `now` is injected so tests move the clock without waiting. A try that
 * is refused does not move the deadline. */
export class NudgeCooldown {
  private readonly until = new Map<string, number>();
  private readonly windowMs: number;

  constructor(windowMs = NUDGE_COOLDOWN_MS) {
    this.windowMs = windowMs;
  }

  tryAcquire(senderId: string, targetId: string, now: number): NudgeVerdict {
    const key = pairKey(senderId, targetId);
    const deadline = this.until.get(key);
    if (deadline !== undefined && now < deadline) {
      return { ok: false, retryAfterMs: deadline - now };
    }
    this.until.set(key, now + this.windowMs);
    if (this.until.size > 4000) {
      for (const [stored, at] of this.until) if (at <= now) this.until.delete(stored);
    }
    return { ok: true };
  }
}

/** English sentence for the 429 body. The button localizes from retryAfterMs. */
export function nudgeCooldownError(retryAfterMs: number): string {
  const ms = Math.max(0, retryAfterMs);
  const minutes = Math.ceil(ms / 60_000);
  if (minutes >= 2) return `Wait ${minutes} minutes before nudging them again.`;
  if (ms >= 60_000) return "Wait 1 minute before nudging them again.";
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `Wait ${seconds} seconds before nudging them again.`;
}

/** A nudge frame reaches that person's streams only. A stream with no
 * viewer id is the operator at this computer (loopback, or their admin
 * session), so it hears a nudge addressed to them and nobody else. */
export function nudgeFrameAllowed(
  payload: { kind?: unknown; audience?: unknown },
  viewerId: string | undefined,
  localPersonId: string,
): boolean {
  if (payload.kind !== "nudge") return true;
  if (typeof payload.audience !== "string") return false;
  const audience = payload.audience.trim().toLowerCase();
  if (!audience) return false;
  const viewer = (viewerId ?? localPersonId).trim().toLowerCase();
  return Boolean(viewer) && audience === viewer;
}

/** A directory person a group nudge may name. Service accounts and people
 * who are out are listed so the filter can skip them. */
export interface NudgeDirectoryPerson {
  id: string;
  teams?: readonly { id: string; manager?: boolean }[];
  service?: boolean;
  disabled?: boolean;
}

/** The other people of a group chat. `humanIds` and section members may be
 * a principal id, `user:<id>`, or `team:<id>`. A team names its members,
 * not its managers. The sender, service accounts and people who are out
 * are left out. The same person is named once. */
export function groupNudgeTargets(input: {
  senderId: string;
  humanIds: readonly string[];
  section?: { ownerPrincipalId?: string; members: readonly { target: string }[] } | null;
  people: readonly NudgeDirectoryPerson[];
}): NudgeDirectoryPerson[] {
  const byId = new Map<string, NudgeDirectoryPerson>();
  for (const person of input.people) {
    const id = person.id.trim().toLowerCase();
    if (id) byId.set(id, person);
  }
  const sender = input.senderId.trim().toLowerCase();
  const chosen = new Map<string, NudgeDirectoryPerson>();
  const accept = (person: NudgeDirectoryPerson | undefined) => {
    if (!person || person.service || person.disabled) return;
    const id = person.id.trim().toLowerCase();
    if (!id || id === sender) return;
    chosen.set(id, person);
  };
  const take = (target: string) => {
    const raw = target.trim();
    if (!raw) return;
    if (raw.toLowerCase().startsWith("team:")) {
      const teamId = raw.slice(5).trim();
      if (!teamId) return;
      for (const person of input.people) {
        if (person.teams?.some((team) => team.id === teamId && !team.manager)) accept(person);
      }
      return;
    }
    const id = raw.toLowerCase().startsWith("user:") ? raw.slice(5) : raw;
    accept(byId.get(id.trim().toLowerCase()));
  };
  for (const entry of input.humanIds) take(entry);
  if (input.section?.ownerPrincipalId) accept(byId.get(input.section.ownerPrincipalId.trim().toLowerCase()));
  for (const member of input.section?.members ?? []) take(member.target);
  return [...chosen.values()];
}

/** The cooldown target for a group chat. Shared by every sender. */
export function groupNudgeKey(groupId: string): string {
  return `group:${groupId.trim()}`;
}

export interface NudgeTranscriptLine {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  at: number;
  /** Set when the line belongs to this group chat, not a direct conversation. */
  groupId?: string;
}

export interface NudgeLineStore {
  find(fromId: string, toId: string): { id: string; threadId: string } | undefined;
  create(input: { a: string; b: string; name: string }): { id: string; threadId: string };
  /** The group chat a group nudge already checked. Absent on the direct path. */
  findGroup?(groupId: string): { id: string; threadId: string } | undefined;
  append(threadId: string, message: {
    role: "bot";
    kind: "nudge";
    at: number;
    nudge: { fromId: string; fromName: string; toId: string; toName: string; groupId?: string };
  }): void;
  markUnread(groupId: string): void;
}

/** Write the accepted nudge into the conversation. A direct nudge uses the
 * conversation those two share, creating it when they do not have one yet.
 * A group nudge writes one line on that group chat and never opens a direct
 * conversation. Call this only after the nudge is accepted: a refusal must
 * not leave a line. */
export function recordNudgeLine(store: NudgeLineStore, line: NudgeTranscriptLine): void {
  const note = {
    fromId: line.fromId,
    fromName: line.fromName,
    toId: line.toId,
    toName: line.toName,
    ...(line.groupId ? { groupId: line.groupId } : {}),
  };
  if (line.groupId) {
    const group = store.findGroup?.(line.groupId);
    if (!group) return;
    store.append(group.threadId, { role: "bot", kind: "nudge", at: line.at, nudge: note });
    store.markUnread(group.id);
    return;
  }
  const group = store.find(line.fromId, line.toId) ?? store.create({
    a: line.fromId,
    b: line.toId,
    name: `${line.fromName}, ${line.toName}`,
  });
  store.append(group.threadId, { role: "bot", kind: "nudge", at: line.at, nudge: note });
  store.markUnread(group.id);
}
