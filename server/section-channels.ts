// Sidebar sections as channels on an organization server (slice 4, spec
// section 3, "Les sections de la barre latérale sont des canaux").
//
// A section is a channel: an id, a name, an owner, members (people or
// Perspicax teams, `user:<principal id>` / `team:<team id>`, each with a
// channel role: moderator, participant, readonly), a default level on its
// bots (use or run, never more) and its own conversation (a room, created
// when the first member joins). It joins the bots and rooms that carry its
// name (`bot.section`, `group.section`), so a rename or a delete in the store
// keeps this file in step.
//
// Access (server/authz.ts): a member (directly or through a team) gets
// min(defaultLevel, run) on the section's bots, reads its rooms (readonly)
// and posts in them (participant, moderator). Owning a section gives no
// access to bots someone else placed in it, and a section with no member is
// private: it changes nobody's access, exactly as before this slice.
//
// A shared section opens only the bots whose owner consented: the ones the
// section owner owns, and the ones placed through PUT .../bots by someone
// who manages them (the owner, or a manage holder the owner chose), recorded
// with the owner at that time. A bot that sat in a section before this slice
// and belongs to someone else stays closed until its owner places it again.
// Rooms follow the same rule: a shared section opens its own conversation
// (roomId) and the rooms placed in it with consent (placedRooms: created in
// the section by one of its members, or moved there by an organization
// admin or by a moderator who is the room's only person). A room that
// carried the section's name before (a legacy room, a bot-to-bot channel)
// stays with its own people.
// "General" (no section) is personal: never shared, renamed or deleted.
//
// File: section-channels.json, { version: 1, sections: [record] }, atomic,
// 0600. Solo mode never reads it.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import {
  canAdministerSectionMember,
  canModerateSection,
  isSectionRole,
  parseTarget,
  roleRank,
  sectionRole,
  type SectionAccess,
  type SectionMember,
  type SectionRole,
  type TeamRef,
  type Viewer,
} from "./authz.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const MAX_SECTION_MEMBERS = 200;
const SECTION_ID = /^sec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const memberSchema = z.object({ target: z.string().max(80), role: z.enum(["moderator", "participant", "readonly"]) });
const recordSchema = z.object({
  id: z.string().regex(SECTION_ID),
  name: z.string().min(1).max(60),
  ownerPrincipalId: z.string().min(1).max(64),
  members: z.array(memberSchema).max(MAX_SECTION_MEMBERS),
  defaultLevel: z.enum(["use", "run"]),
  roomId: z.string().max(80).optional(),
  /** Bots placed with their owner's consent (see the header). */
  placedBots: z.array(z.object({ botId: z.string().min(1).max(80), ownerPrincipalId: z.string().min(1).max(64) })).max(2000).optional(),
  /** Rooms placed with consent (see the header). */
  placedRooms: z.array(z.string().min(1).max(80)).max(2000).optional(),
  createdAt: z.number(),
});
const fileSchema = z.object({ version: z.literal(1), sections: z.array(z.unknown()) });

export type SectionRecord = z.infer<typeof recordSchema>;

/** The name "General" in any case: the personal default section. */
export function isGeneralName(name: string): boolean {
  return name.trim().toLowerCase() === "general";
}

/** A section name: 1 to 60 characters, no control characters. */
export function validSectionName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 60 && ![...trimmed].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

/** Who owns a section at the first organization boot: the owner of most of
 * its bots; on a tie, the owner of the oldest of the tied owners' bots; with
 * no bot, the first organization admin. */
export function migrationOwner(bots: readonly { ownerPrincipalId: string; createdAt: number }[], firstAdmin: string): string {
  if (!bots.length) return firstAdmin;
  const counts = new Map<string, number>();
  for (const bot of bots) counts.set(bot.ownerPrincipalId, (counts.get(bot.ownerPrincipalId) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const tied = new Set([...counts].filter(([, count]) => count === top).map(([owner]) => owner));
  const oldest = [...bots].filter((bot) => tied.has(bot.ownerPrincipalId)).sort((a, b) => a.createdAt - b.createdAt)[0]!;
  return oldest.ownerPrincipalId;
}

export class SectionChannels {
  private readonly path: string;
  private readonly now: () => number;
  private readonly newId: () => string;
  private records: SectionRecord[] = [];

  constructor(options: { path: string; now?: () => number; newId?: () => string }) {
    this.path = options.path;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => `sec_${randomUUID()}`);
    if (!existsSync(this.path)) return;
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (!parsed.success) throw new Error("not a version 1 file");
      const names = new Set<string>();
      for (const entry of parsed.data.sections) {
        const record = recordSchema.safeParse(entry);
        if (!record.success || names.has(record.data.name)) continue;
        names.add(record.data.name);
        this.records.push(record.data);
      }
    } catch (error) {
      console.error(`section-channels: ${this.path} is unreadable (${error instanceof Error ? error.message : String(error)}); starting with no shared sections`);
    }
  }

  list(): SectionRecord[] {
    return this.records.map((record) => structuredClone(record));
  }

  byId(id: string): SectionRecord | null {
    const found = this.records.find((record) => record.id === id);
    return found ? structuredClone(found) : null;
  }

  byName(name: string): SectionRecord | null {
    const found = this.records.find((record) => record.name === name.trim());
    return found ? structuredClone(found) : null;
  }

  /** The access facts of a section by name; null for a private one (no
   * member) or an unknown name. */
  accessFor(name: string): SectionAccess | null {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || !found.members.length) return null;
    return { ownerPrincipalId: found.ownerPrincipalId, members: found.members.map((member) => ({ ...member })), defaultLevel: found.defaultLevel };
  }

  /** The access facts of a section for one bot: null when the section is
   * private, or when the bot's owner never consented to it (see the header). */
  accessForBot(name: string, bot: { id: string; ownerPrincipalId: string }): SectionAccess | null {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || !found.members.length) return null;
    const owner = bot.ownerPrincipalId.trim().toLowerCase();
    const consented = found.ownerPrincipalId.trim().toLowerCase() === owner ||
      (found.placedBots ?? []).some((entry) => entry.botId === bot.id && entry.ownerPrincipalId.trim().toLowerCase() === owner);
    return consented ? this.accessFor(name) : null;
  }

  /** The access facts of a section for one room: null when the section is
   * private, or when the room is neither its own conversation nor placed
   * in it with consent (see the header). */
  accessForRoom(name: string, roomId: string): SectionAccess | null {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || !found.members.length) return null;
    const placed = found.roomId === roomId || (found.placedRooms ?? []).includes(roomId);
    return placed ? this.accessFor(name) : null;
  }

  /** A room placed in a section with consent. */
  recordRoomPlacement(name: string, roomId: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || (found.placedRooms ?? []).includes(roomId)) return;
    found.placedRooms = [...(found.placedRooms ?? []), roomId];
    this.save();
  }

  /** Forget a room's placement in a section (moved out). */
  forgetRoomPlacement(name: string, roomId: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found?.placedRooms?.includes(roomId)) return;
    found.placedRooms = found.placedRooms.filter((id) => id !== roomId);
    this.save();
  }

  /** A bot placed in a section by someone who manages it, for its owner. */
  recordPlacement(name: string, botId: string, ownerPrincipalId: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || !ownerPrincipalId) return;
    found.placedBots = [...(found.placedBots ?? []).filter((entry) => entry.botId !== botId), { botId, ownerPrincipalId }];
    this.save();
  }

  /** Forget a bot's placement in a section (taken out, or placed elsewhere). */
  forgetPlacement(name: string, botId: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found?.placedBots?.some((entry) => entry.botId === botId)) return;
    found.placedBots = found.placedBots.filter((entry) => entry.botId !== botId);
    this.save();
  }

  /** The record behind a name, created (private, no member) when missing. */
  ensure(name: string, ownerPrincipalId: string): SectionRecord {
    const existing = this.byName(name);
    if (existing) return existing;
    const record: SectionRecord = { id: this.newId(), name: name.trim(), ownerPrincipalId, members: [], defaultLevel: "use", createdAt: this.now() };
    this.records.push(record);
    this.save();
    return structuredClone(record);
  }

  /** First organization boot: every section name without a record becomes a
   * private record. Returns how many were created. */
  migrate(names: readonly string[], ownerFor: (name: string) => string): number {
    let created = 0;
    for (const name of names) {
      const key = name.trim();
      if (!key || this.records.some((record) => record.name === key)) continue;
      this.records.push({ id: this.newId(), name: key, ownerPrincipalId: ownerFor(key), members: [], defaultLevel: "use", createdAt: this.now() });
      created += 1;
    }
    if (created) this.save();
    return created;
  }

  rename(name: string, nextName: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found) return;
    found.name = nextName.trim();
    this.save();
  }

  removeByName(name: string): void {
    const before = this.records.length;
    this.records = this.records.filter((record) => record.name !== name.trim());
    if (this.records.length !== before) this.save();
  }

  /** Forget records whose name the store no longer has. */
  reconcile(names: readonly string[]): void {
    const keep = new Set(names.map((name) => name.trim()));
    const before = this.records.length;
    this.records = this.records.filter((record) => keep.has(record.name));
    if (this.records.length !== before) this.save();
  }

  setMembers(id: string, members: SectionMember[], defaultLevel: "use" | "run"): SectionRecord | null {
    const found = this.records.find((record) => record.id === id);
    if (!found) return null;
    found.members = members.map((member) => ({ ...member }));
    found.defaultLevel = defaultLevel;
    this.save();
    return structuredClone(found);
  }

  /** Slice 8: the people of a section after an interim attach (owner,
   * members, placements); the name and the room stay. Null for an unknown id. */
  setPeople(id: string, people: Pick<SectionRecord, "ownerPrincipalId" | "members" | "placedBots">): SectionRecord | null {
    const found = this.records.find((record) => record.id === id);
    if (!found) return null;
    found.ownerPrincipalId = people.ownerPrincipalId;
    found.members = people.members.map((member) => ({ ...member }));
    if (people.placedBots) found.placedBots = people.placedBots.map((entry) => ({ ...entry }));
    this.save();
    return structuredClone(found);
  }

  setRoom(id: string, roomId: string): void {
    const found = this.records.find((record) => record.id === id);
    if (!found) return;
    found.roomId = roomId;
    this.save();
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      writeFileAtomic(this.path, JSON.stringify({ version: 1, sections: this.records }, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error(`section-channels: could not save ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** The access facts of a record, members or not (for the rules that judge
 * who may change it). */
export function recordAccess(record: SectionRecord): SectionAccess {
  return { ownerPrincipalId: record.ownerPrincipalId, members: record.members.map((member) => ({ ...member })), defaultLevel: record.defaultLevel };
}

export interface SectionRouteDeps {
  channels: SectionChannels;
  viewer(auth: RequestAuth): Viewer | undefined;
  /** The caller's principal id (the operator's when loopback). */
  principalId(auth: RequestAuth): string;
  teamsOf(principalId: string): readonly TeamRef[];
  resolvePerson(ref: string): { ok: true; id: string } | { ok: false; code: "unknown_person" };
  teamKnown(teamId: string): boolean;
  /** The store's section names. */
  sections(): string[];
  /** Create an empty section; an error text, or undefined. */
  createSection(name: string): string | undefined;
  renameSection(name: string, nextName: string): string | undefined;
  deleteSection(name: string): string | undefined;
  /** Move bots in or out; an error text, or undefined. */
  moveBots(name: string, add: string[], remove: string[]): string | undefined;
  botExists(botId: string): boolean;
  botSection(botId: string): string | undefined;
  /** The bot's owner (principal id). */
  botOwner(botId: string): string;
  /** bot.manage on the bot. */
  managesBot(auth: RequestAuth, botId: string): boolean;
  /** The section's conversation, created at its first member. */
  createRoom(name: string): string | null;
  roomExists(roomId: string): boolean;
  /** Something about who sees what changed. */
  onChanged(): void;
  /** Slice 7: one audit row per saved change (category section). */
  audit?(auth: RequestAuth, row: SectionAuditRow): void;
}

/** A section change for the admin activity log (slice 7). */
export interface SectionAuditRow {
  action: "section.create" | "section.rename" | "section.delete" | "section.member.set" | "section.member.remove" | "section.default_level" | "section.bot.place" | "section.bot.remove";
  section: { id: string; name: string };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

type WireSection = SectionRecord & { viewerRole: SectionRole | "owner" | null; canModerate: boolean };

/** What the section list shows a viewer: owner, member (directly or by team),
 * moderator by admin right, or a manager whose teams an entry reaches. */
export function sectionForViewer(viewer: Viewer | undefined, record: SectionRecord, teamsOf: (principalId: string) => readonly TeamRef[]): WireSection | null {
  const access = recordAccess(record);
  if (!viewer) return { ...record, viewerRole: "owner", canModerate: true };
  const role = viewer.disabled ? null : sectionRole(viewer, access);
  const moderate = canModerateSection(viewer, access);
  const managerReach = !viewer.disabled && record.members.some((member) => {
    const parsed = parseTarget(member.target);
    const managed = new Set(viewer.teams.filter((team) => team.manager).map((team) => team.id));
    if (!parsed || !managed.size) return false;
    return parsed.kind === "team" ? managed.has(parsed.id) : teamsOf(parsed.id).some((team) => managed.has(team.id));
  });
  if (!role && !moderate && !managerReach) return null;
  return { ...record, viewerRole: role, canModerate: moderate };
}

const GENERAL = { error: "General is personal: it can't be shared, renamed or deleted.", code: "general_is_personal" } as const;
const NOT_ALLOWED = { error: "you may not change this section", code: "not_allowed" } as const;

export function createSectionChannelRoutes(deps: SectionRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/org/sections" && !path.startsWith("/api/org/sections/")) return PASS;
    res.setHeader("cache-control", "no-store");
    const viewer = deps.viewer(auth);
    deps.channels.reconcile(deps.sections());

    if (path === "/api/org/sections" && method === "GET") {
      const sections = deps.channels.list().flatMap((record) => {
        const shown = sectionForViewer(viewer, record, deps.teamsOf);
        return shown ? [shown] : [];
      });
      return json(res, 200, { sections });
    }
    if (path === "/api/org/sections" && method === "POST") {
      const body = await readBody(req);
      const name = body && typeof body === "object" ? (body as { name?: unknown }).name : undefined;
      if (!validSectionName(name)) return json(res, 400, { error: "A section name is 1 to 60 characters without control characters.", code: "bad_name" });
      if (isGeneralName(name)) return json(res, 400, GENERAL);
      if (deps.sections().includes(name.trim())) return json(res, 409, { error: "A section with that name already exists.", code: "exists" });
      const error = deps.createSection(name.trim());
      if (error) return json(res, 409, { error });
      const record = deps.channels.ensure(name.trim(), deps.principalId(auth));
      deps.onChanged();
      deps.audit?.(auth, { action: "section.create", section: { id: record.id, name: record.name } });
      return json(res, 201, { section: sectionForViewer(viewer, record, deps.teamsOf) ?? { ...record, viewerRole: "owner", canModerate: true } });
    }

    const one = /^\/api\/org\/sections\/([^/]+)(?:\/(members|bots))?$/.exec(path);
    if (!one) return json(res, 404, { error: "not found" });
    if (one[1] === "general" || one[1] === "General") return json(res, 400, GENERAL);
    const record = deps.channels.byId(one[1]!);
    if (!record) return json(res, 404, { error: "no such section" });
    const access = recordAccess(record);
    const sub = one[2];

    if (!sub && method === "PATCH") {
      if (!canModerateSection(viewer, access)) return json(res, 403, NOT_ALLOWED);
      const body = await readBody(req);
      const name = body && typeof body === "object" ? (body as { name?: unknown }).name : undefined;
      if (!validSectionName(name)) return json(res, 400, { error: "A section name is 1 to 60 characters without control characters.", code: "bad_name" });
      if (isGeneralName(name)) return json(res, 400, GENERAL);
      const next = name.trim();
      if (next !== record.name) {
        const error = deps.renameSection(record.name, next);
        if (error) return json(res, 409, { error });
        deps.channels.rename(record.name, next);
        deps.onChanged();
        deps.audit?.(auth, { action: "section.rename", section: { id: record.id, name: next }, before: { name: record.name }, after: { name: next } });
      }
      const current = deps.channels.byId(record.id)!;
      return json(res, 200, { section: sectionForViewer(viewer, current, deps.teamsOf) ?? { ...current, viewerRole: null, canModerate: true } });
    }
    if (!sub && method === "DELETE") {
      if (!canModerateSection(viewer, access)) return json(res, 403, NOT_ALLOWED);
      const error = deps.deleteSection(record.name);
      if (error) return json(res, 409, { error });
      deps.channels.removeByName(record.name);
      deps.onChanged();
      deps.audit?.(auth, { action: "section.delete", section: { id: record.id, name: record.name } });
      return json(res, 200, { ok: true });
    }
    if (sub === "members" && method === "PUT") {
      const body = await readBody(req);
      const raw = body && typeof body === "object" ? body as { members?: unknown; defaultLevel?: unknown } : {};
      if (!Array.isArray(raw.members) || raw.members.length > MAX_SECTION_MEMBERS) return json(res, 400, { error: `members must be a list of at most ${MAX_SECTION_MEMBERS} entries`, code: "bad_target" });
      const defaultLevel = raw.defaultLevel === undefined ? record.defaultLevel : raw.defaultLevel;
      if (defaultLevel !== "use" && defaultLevel !== "run") return json(res, 400, { error: "defaultLevel must be use or run", code: "bad_level" });
      const members: SectionMember[] = [];
      const seen = new Set<string>();
      for (const entry of raw.members) {
        const target = entry && typeof entry === "object" && typeof (entry as { target?: unknown }).target === "string" ? (entry as { target: string }).target.trim() : "";
        const parsed = target.length <= 80 ? parseTarget(target) : null;
        if (!parsed) return json(res, 400, { error: "a member is user:<principal id> or team:<team id>", code: "bad_target" });
        const role = (entry as { role?: unknown }).role;
        if (!isSectionRole(role)) return json(res, 400, { error: "role must be moderator, participant or readonly", code: "bad_role" });
        if (seen.has(target)) continue;
        seen.add(target);
        members.push({ target, role });
      }
      // Authorize every change before resolving anyone.
      const before = new Map(record.members.map((member) => [member.target, member.role] as const));
      const after = new Map(members.map((member) => [member.target, member.role] as const));
      const changes: Array<{ target: string; role?: SectionRole }> = [];
      for (const [target, role] of after) if (before.get(target) !== role) changes.push({ target, role });
      for (const target of before.keys()) if (!after.has(target)) changes.push({ target });
      if (defaultLevel !== record.defaultLevel && !canModerateSection(viewer, access)) return json(res, 403, NOT_ALLOWED);
      for (const change of changes) {
        if (!canAdministerSectionMember(viewer, { section: access, target: change.target, ...(change.role ? { role: change.role } : {}), teamsOf: deps.teamsOf })) {
          return json(res, 403, NOT_ALLOWED);
        }
      }
      for (const change of changes) {
        if (!change.role || before.has(change.target)) continue;
        const parsed = parseTarget(change.target)!;
        if (parsed.kind === "user") {
          const person = deps.resolvePerson(parsed.id);
          if (!person.ok) return json(res, 400, { error: "choose an active person from the organization directory", code: "unknown_person" });
        } else if (!deps.teamKnown(parsed.id)) {
          return json(res, 400, { error: "choose a team from the organization directory", code: "unknown_team" });
        }
      }
      const saved = deps.channels.setMembers(record.id, members, defaultLevel);
      // The section's conversation, the first time it has members.
      if (saved && members.length && (!saved.roomId || !deps.roomExists(saved.roomId))) {
        const roomId = deps.createRoom(saved.name);
        if (roomId) deps.channels.setRoom(saved.id, roomId);
      }
      deps.onChanged();
      if (saved && deps.audit) {
        const ref = { id: record.id, name: record.name };
        for (const change of changes) {
          if (change.role) deps.audit(auth, { action: "section.member.set", section: ref, before: before.has(change.target) ? { target: change.target, role: before.get(change.target) } : {}, after: { target: change.target, role: change.role } });
          else deps.audit(auth, { action: "section.member.remove", section: ref, before: { target: change.target, role: before.get(change.target) }, after: {} });
        }
        if (defaultLevel !== record.defaultLevel) deps.audit(auth, { action: "section.default_level", section: ref, before: { defaultLevel: record.defaultLevel }, after: { defaultLevel } });
      }
      const current = deps.channels.byId(record.id)!;
      return json(res, 200, { section: sectionForViewer(viewer, current, deps.teamsOf) ?? { ...current, viewerRole: null, canModerate: false } });
    }
    if (sub === "bots" && method === "PUT") {
      const body = await readBody(req);
      const raw = body && typeof body === "object" ? body as { add?: unknown; remove?: unknown } : {};
      const ids = (value: unknown) => Array.isArray(value) && value.length <= 500 && value.every((id) => typeof id === "string" && /^[\w-]{1,80}$/.test(id)) ? value as string[] : null;
      const add = raw.add === undefined ? [] : ids(raw.add);
      const remove = raw.remove === undefined ? [] : ids(raw.remove);
      if (!add || !remove) return json(res, 400, { error: "send { add: [botId], remove: [botId] }" });
      for (const id of [...add, ...remove]) if (!deps.botExists(id)) return json(res, 404, { error: "no such bot" });
      const role = viewer ? sectionRole(viewer, access) : "owner";
      const mayPlace = !viewer || viewer.orgAdmin || roleRank(role) >= roleRank("participant");
      for (const id of add) {
        if (!mayPlace || !deps.managesBot(auth, id)) return json(res, 403, NOT_ALLOWED);
      }
      for (const id of remove) {
        if (!deps.managesBot(auth, id) && !canModerateSection(viewer, access)) return json(res, 403, NOT_ALLOWED);
        if (deps.botSection(id) !== record.name) return json(res, 409, { error: "that bot is not in this section" });
      }
      const previous = new Map(add.map((id) => [id, deps.botSection(id)] as const));
      const error = deps.moveBots(record.name, add, remove);
      if (error) return json(res, 409, { error });
      for (const id of remove) deps.channels.forgetPlacement(record.name, id);
      for (const id of add) {
        const from = previous.get(id);
        if (from && from !== record.name) deps.channels.forgetPlacement(from, id);
        deps.channels.recordPlacement(record.name, id, deps.botOwner(id));
      }
      deps.onChanged();
      const ref = { id: record.id, name: record.name };
      for (const id of add) deps.audit?.(auth, { action: "section.bot.place", section: ref, after: { botId: id, ...(previous.get(id) ? { from: previous.get(id) } : {}) } });
      for (const id of remove) deps.audit?.(auth, { action: "section.bot.remove", section: ref, before: { botId: id } });
      return json(res, 200, { section: sectionForViewer(viewer, deps.channels.byId(record.id)!, deps.teamsOf) });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
