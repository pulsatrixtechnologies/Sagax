/**
 * Who reaches a scheduled call (#1482). A call is a room session with some
 * bots: a member sees the calls whose bots they can all see, and creates,
 * changes, opens or deletes one when they may run every bot in it (the same
 * right as scheduling a routine for that bot). An admin sees everything.
 */
import type { CalendarCall } from "./calendar-calls.ts";

export interface CalendarCallAccess {
  /** The caller sees every bot (admin, the owner at this computer). */
  everything: boolean;
  /** The caller can see this bot. */
  botVisible: (botId: string) => boolean;
  /** The caller lacks the right to run this bot's routines. */
  needsRun: (botId: string) => boolean;
}

export type CalendarCallRefusal =
  | { status: 404; body: { error: string } }
  | { status: 403; body: { error: string; code: string } };

/** The calls this caller may see: every bot in the call must be visible. */
export function visibleCalendarCalls(calls: readonly CalendarCall[], access: CalendarCallAccess): CalendarCall[] {
  if (access.everything) return [...calls];
  return calls.filter((call) => call.botIds.every((botId) => access.botVisible(botId)));
}

function botIdsOf(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const botIds = (body as { botIds?: unknown }).botIds;
  return Array.isArray(botIds) ? botIds.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Why this caller may not write a call with these bots: the bots of the
 * existing call (an edit, a delete, opening its room) and those the body
 * asks for. A hidden bot answers like a missing call; a visible bot the
 * caller may not run answers 403.
 */
export function calendarCallRefusal(
  access: CalendarCallAccess,
  existing: Pick<CalendarCall, "botIds"> | null,
  body?: unknown,
): CalendarCallRefusal | null {
  if (access.everything) return null;
  const existingIds = existing?.botIds ?? [];
  if (existingIds.some((botId) => !access.botVisible(botId))) {
    return { status: 404, body: { error: "no such scheduled call" } };
  }
  const requested = botIdsOf(body);
  if (requested.some((botId) => !access.botVisible(botId))) {
    return { status: 404, body: { error: "no such bot" } };
  }
  if ([...existingIds, ...requested].some((botId) => access.needsRun(botId))) {
    return { status: 403, body: { error: "you need the right to run every bot in this call", code: "needs_run" } };
  }
  return null;
}
