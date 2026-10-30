// Changing several bots at once from the sidebar's selection (Edit N bots).
// The rules are shared (shared/bulk-bot-edit.ts); this file holds the
// dialog's draft (what each section changed, never written until Apply), the
// scoped transport the bot editor's own sections write through, and the run:
// bot by bot, through the routes the bot's own editor uses, so every change
// is journaled as that bot's own edit and refused for that bot's reasons.
import {
  applyListEdit,
  botLevelPatch,
  commonListItems,
  grantRevertSteps,
  grantSteps,
  mcpServersAfter,
  patchFields,
  patchForBot,
  revertPatch,
  type BulkBotOutcome,
  type BulkGrant,
  type BulkListEdit,
  type BulkListMode,
} from "../../shared/bulk-bot-edit";
import type { Bot } from "@/state/store";

/** The bot editor's sections a bulk change offers, in the dialog's order. */
export const BULK_SECTIONS = ["model", "sharing", "worksOn", "access", "voice", "permissions", "perspicax"] as const;
export type BulkSectionId = typeof BULK_SECTIONS[number];

/** The bot fields each section shows (what "Mixed values" compares). Access
 * also has its MCP servers, a list; Shared with and Perspicax are lists. */
export const BULK_SECTION_FIELDS: Record<BulkSectionId, readonly string[]> = {
  model: ["modelSelection", "fallback"],
  sharing: [],
  worksOn: ["computer"],
  access: ["cloudBackend", "autoStartVps", "browser", "cwd", "toolScope", "mcpAccounts"],
  voice: ["voice", "speakReplies", "notifications"],
  permissions: ["approvalMode", "proactiveMode", "outbound", "chiefOfStaff", "managedSections", "approvePeerComms", "peers"],
  perspicax: [],
};

type Request = <T = unknown>(path: string, init?: RequestInit) => Promise<T>;

/** One section's pending change. */
export interface BulkSectionChange {
  /** Bot fields set in the section (consent flags included). */
  patch: Record<string, unknown>;
  /** Access: the MCP servers, by Add, Remove or Replace. */
  mcpServers?: BulkListEdit;
  /** Shared with: the people and teams with the level chosen for each. */
  grants?: { mode: BulkListMode; grants: BulkGrant[] };
  /** Perspicax Profiles: profile ids. */
  perspicax?: BulkListEdit;
}

export type BulkChanges = Partial<Record<BulkSectionId, BulkSectionChange>>;

/** A list edit does something: items to add or remove, or a Replace (an
 * empty Replace empties the list). */
export function listActive(edit: { mode: BulkListMode; items?: readonly unknown[]; grants?: readonly unknown[] } | undefined): boolean {
  if (!edit) return false;
  return edit.mode === "replace" || (edit.items ?? edit.grants ?? []).length > 0;
}

export function sectionTouched(change: BulkSectionChange | undefined): boolean {
  if (!change) return false;
  return patchFields(change.patch).length > 0 || listActive(change.mcpServers) || listActive(change.grants) || listActive(change.perspicax);
}

/** Every bot field the change sets (all sections together). */
export function mergedPatch(changes: BulkChanges): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of BULK_SECTIONS) Object.assign(out, changes[id]?.patch ?? {});
  return out;
}

/** The bot a section's real controls edit: the first selected bot's values,
 * an id of its own (so nothing reaches a real bot), the viewer as owner (the
 * server decides each bot's rights at Apply), never busy, and the section's
 * change on top. A list shows the edit's items: empty to start with Add and
 * Remove, what every bot has to start with Replace (listStart). */
export function bulkDraftBot(id: string, bots: readonly Bot[], viewerId: string | null, change: BulkSectionChange | undefined): Bot {
  const first = bots[0]!;
  return {
    ...first,
    id,
    threadId: id,
    messages: [],
    tasks: undefined,
    busy: false,
    activity: undefined,
    host: undefined,
    directGrants: undefined,
    ...(viewerId ? { ownerUserId: viewerId } : {}),
    ...change?.patch,
    mcpServers: change?.mcpServers?.items ?? [],
    grants: (change?.grants?.grants ?? []).map((grant) => ({ ...grant, by: viewerId ?? "", at: 0 })),
  } as Bot;
}

/** Where a list starts when its mode is picked: Replace begins from what
 * every bot has, Add and Remove from nothing. */
export function listStart(mode: BulkListMode, lists: ReadonlyArray<readonly string[]>): string[] {
  return mode === "replace" ? commonListItems(lists) : [];
}

/** The transport a section's own controls use inside the dialog
 * (BotEditorContext.request): a PATCH of the draft bot and its grants are
 * kept as the section's change; anything else answers that it needs one bot. */
export function bulkSectionRequest(draftId: string, read: () => BulkSectionChange, write: (next: BulkSectionChange) => void, draftBot: () => Bot,
  /** A person's or team's name (the directory), never an id on screen. */
  label: (target: string) => string = (target) => target): Request {
  const base = `/api/bots/${draftId}`;
  return (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const change = read();
    if (path === base && method === "PATCH") {
      const { stepUp: _stepUp, ...fields } = body;
      if (Array.isArray(fields.mcpServers)) {
        const { mcpServers, ...rest } = fields;
        write({ ...change, patch: { ...change.patch, ...rest }, mcpServers: { mode: change.mcpServers?.mode ?? "add", items: mcpServers as string[] } });
      } else write({ ...change, patch: { ...change.patch, ...fields } });
      return { bot: draftBot() };
    }
    const grants = change.grants ?? { mode: "add" as BulkListMode, grants: [] };
    const answer = (list: BulkGrant[]) => ({
      grants: list.map((grant) => ({ ...grant, by: "", at: 0, kind: grant.target.startsWith("team:") ? "team" : "user", label: label(grant.target) })),
      administer: { any: true, teamIds: [], maxLevel: "manage", canAdd: true },
    });
    if (path === `${base}/grants` && method === "GET") return answer(grants.grants);
    if (path === `${base}/grants` && method === "PUT") {
      const target = String(body.target ?? "");
      const level = body.level as BulkGrant["level"];
      const next = [...grants.grants.filter((grant) => grant.target !== target), { target, level }];
      write({ ...change, grants: { ...grants, grants: next } });
      return answer(next);
    }
    if (path.startsWith(`${base}/grants/`) && method === "DELETE") {
      const target = decodeURIComponent(path.slice(`${base}/grants/`.length));
      const next = grants.grants.filter((grant) => grant.target !== target);
      write({ ...change, grants: { ...grants, grants: next } });
      return answer(next);
    }
    throw new Error("Not available when changing several bots");
  }) as Request;
}

/** What one bot had before the change: enough to put it back. */
export interface BulkBefore {
  botId: string;
  patch?: Record<string, unknown>;
  grants?: { before: BulkGrant[]; after: BulkGrant[] };
  perspicax?: string[];
}

export interface BulkRun {
  outcomes: BulkBotOutcome[];
  before: BulkBefore[];
}

export interface BulkDeps {
  request: Request;
  /** The bot's own save (persistBotUpdate: Full and Custom take the same
   * trusted path as the editor); answers the saved bot. */
  saveBot: (bot: Bot, patch: Record<string, unknown>) => Promise<unknown>;
  /** Waits for the bot's pending edits (the editor's queue) first. */
  flush?: (botId: string) => Promise<unknown>;
  /** A reason this bot cannot take a section's change, or null. */
  locked?: (bot: Bot, section: BulkSectionId) => string | null;
  /** Every enabled MCP server (a bot with no list of its own mounts them). */
  enabledServers?: readonly string[];
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)) || "Refused";

type Profiles = { selected?: Array<{ id: string }> };

/** Apply the change to each bot in turn. A bot that refuses one part keeps
 * the parts it took; its outcome lists why. */
export async function runBulkEdit(bots: readonly Bot[], changes: BulkChanges, deps: BulkDeps): Promise<BulkRun> {
  const outcomes: BulkBotOutcome[] = [];
  const before: BulkBefore[] = [];
  for (const bot of bots) {
    const reasons: string[] = [];
    const kept: BulkBefore = { botId: bot.id };
    let changed = false;
    const allowed = (section: BulkSectionId) => {
      const lock = deps.locked?.(bot, section) ?? null;
      if (lock) reasons.push(lock);
      return lock === null;
    };
    try { await deps.flush?.(bot.id); } catch { /* the save below says what failed */ }

    // the bot's fields, one request (the editor's own save)
    const patch: Record<string, unknown> = {};
    for (const id of BULK_SECTIONS) {
      const change = changes[id];
      const mcp = listActive(change?.mcpServers);
      if (!change || (patchFields(change.patch).length === 0 && !mcp)) continue;
      if (!allowed(id)) continue;
      Object.assign(patch, change.patch);
      if (mcp && change.mcpServers) {
        const next = mcpServersAfter(bot.mcpServers, deps.enabledServers ?? [], change.mcpServers);
        patch.mcpServers = next;
      }
    }
    const own = patchForBot(bot as unknown as Record<string, unknown>, patch);
    if (patchFields(own).length > 0) {
      try {
        await deps.saveBot(bot, botLevelPatch(own, bot.threadId));
        kept.patch = revertPatch(bot as unknown as Record<string, unknown>, own);
        changed = true;
      } catch (error) {
        reasons.push(reasonOf(error));
      }
    }

    // Shared with: the grants route, person by person
    const grantEdit = changes.sharing?.grants;
    if (grantEdit && listActive(grantEdit) && allowed("sharing")) {
      try {
        const current = (await deps.request<{ grants?: BulkGrant[] }>(`/api/bots/${bot.id}/grants`)).grants ?? [];
        const now = current.map(({ target, level }) => ({ target, level }));
        const steps = grantSteps(now, grantEdit.mode, grantEdit.grants);
        let after = now;
        for (const grant of steps.put) {
          try {
            const answer = await deps.request<{ grants?: BulkGrant[] }>(`/api/bots/${bot.id}/grants`, { method: "PUT", body: JSON.stringify(grant) });
            after = (answer.grants ?? []).map(({ target, level }) => ({ target, level }));
            changed = true;
          } catch (error) { reasons.push(reasonOf(error)); }
        }
        for (const target of steps.remove) {
          try {
            const answer = await deps.request<{ grants?: BulkGrant[] }>(`/api/bots/${bot.id}/grants/${encodeURIComponent(target)}`, { method: "DELETE" });
            after = (answer.grants ?? []).map(({ target: id, level }) => ({ target: id, level }));
            changed = true;
          } catch (error) { reasons.push(reasonOf(error)); }
        }
        if (steps.put.length + steps.remove.length > 0) kept.grants = { before: now, after };
      } catch (error) {
        reasons.push(reasonOf(error));
      }
    }

    // Perspicax Profiles: the bot's profile list
    const profileEdit = changes.perspicax?.perspicax;
    if (profileEdit && listActive(profileEdit) && allowed("perspicax")) {
      try {
        const current = ((await deps.request<Profiles>(`/api/bots/${bot.id}/perspicax`)).selected ?? []).map((profile) => profile.id);
        const next = applyListEdit(current, profileEdit);
        if (next.length !== current.length || next.some((id, index) => id !== current[index])) {
          await deps.request(`/api/bots/${bot.id}/perspicax`, { method: "PUT", body: JSON.stringify({ profiles: next }) });
          kept.perspicax = current;
          changed = true;
        }
      } catch (error) {
        reasons.push(reasonOf(error));
      }
    }

    const unique = [...new Set(reasons)];
    outcomes.push({ botId: bot.id, ok: unique.length === 0, ...(changed || unique.length ? {} : { skipped: true }), ...(unique.length ? { reasons: unique } : {}) });
    if (kept.patch || kept.grants || kept.perspicax) before.push(kept);
  }
  return { outcomes, before };
}

/** Put each bot back as it was before the last bulk change (each step is
 * again that bot's own edit, journaled the same way). */
export async function undoBulkEdit(bots: readonly Bot[], before: readonly BulkBefore[], deps: Pick<BulkDeps, "request" | "saveBot" | "flush">): Promise<BulkBotOutcome[]> {
  const outcomes: BulkBotOutcome[] = [];
  for (const kept of before) {
    const bot = bots.find((candidate) => candidate.id === kept.botId);
    if (!bot) { outcomes.push({ botId: kept.botId, ok: false, reasons: ["Not found"] }); continue; }
    const reasons: string[] = [];
    try { await deps.flush?.(bot.id); } catch { /* the save says */ }
    if (kept.patch && patchFields(kept.patch).length > 0) {
      const back = { ...kept.patch, ...(kept.patch.approvalMode === "full" ? { confirmFullAccess: true } : {}) };
      try { await deps.saveBot(bot, botLevelPatch(back, bot.threadId)); } catch (error) { reasons.push(reasonOf(error)); }
    }
    if (kept.grants) {
      const steps = grantRevertSteps(kept.grants.before, kept.grants.after);
      for (const grant of steps.put) {
        try { await deps.request(`/api/bots/${bot.id}/grants`, { method: "PUT", body: JSON.stringify(grant) }); } catch (error) { reasons.push(reasonOf(error)); }
      }
      for (const target of steps.remove) {
        try { await deps.request(`/api/bots/${bot.id}/grants/${encodeURIComponent(target)}`, { method: "DELETE" }); } catch (error) { reasons.push(reasonOf(error)); }
      }
    }
    if (kept.perspicax) {
      try { await deps.request(`/api/bots/${bot.id}/perspicax`, { method: "PUT", body: JSON.stringify({ profiles: kept.perspicax }) }); } catch (error) { reasons.push(reasonOf(error)); }
    }
    const unique = [...new Set(reasons)];
    outcomes.push({ botId: bot.id, ok: unique.length === 0, ...(unique.length ? { reasons: unique } : {}) });
  }
  return outcomes;
}

/** The last bulk change of this window, for Undo after the dialog closed. */
let lastRun: { at: number; botIds: string[]; before: BulkBefore[] } | null = null;
export function rememberBulkRun(botIds: string[], before: BulkBefore[]) {
  lastRun = before.length ? { at: Date.now(), botIds, before } : null;
}
export function lastBulkRun() { return lastRun; }
export function forgetBulkRun() { lastRun = null; }
