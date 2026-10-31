// #1522 / #1753: a create whose answer is lost on the way (a proxy that
// closes the request, 499; a gateway error; the network) may still have
// saved the routine. Callers read the routines again before they report a
// failure, so a retry never makes a duplicate. Same guard for the full
// editor, calendar quick-create, and /loop (store createRoutine).
import type { Routine } from "./routines";

/** Gateway or transport codes: the server's answer never reached the app. */
const LOST_ANSWER_STATUSES = new Set([408, 499, 502, 503, 504]);

export type RoutineCreateIdentity = {
  name: string;
  botId: string;
  target?: Routine["target"];
};

/** The request may have reached the server although no answer came back. */
export function answerWasLost(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch: network failure
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== "number") return false;
  const body = (error as { body?: unknown }).body;
  const serverWords = body && typeof body === "object" && "error" in body;
  return !serverWords && (LOST_ANSWER_STATUSES.has(status) || status >= 520);
}

/** A raw "<status> <status text>" from a response without a body. */
export function isRawStatusText(message: string): boolean {
  return /^\d{3}(?:\s|$)/.test(message.trim());
}

/** Readable line for a lost or raw-status create failure. */
export function createAnswerErrorMessage(error: unknown, lostFallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return answerWasLost(error) || isRawStatusText(message) ? lostFallback : message;
}

/** The routine this create made, among those listed after it: new since the
 * save began, same name, bot and target. The newest wins. */
export function routineCreatedBy(
  knownIds: ReadonlySet<string>,
  listed: readonly Routine[],
  input: RoutineCreateIdentity,
): Routine | null {
  const name = input.name.trim();
  const matches = listed.filter((routine) =>
    !knownIds.has(routine.id)
    && routine.name.trim() === name
    && routine.botId === input.botId
    && routine.target === (input.target ?? "bot"));
  if (!matches.length) return null;
  return matches.reduce((newest, routine) => (routine.createdAt > newest.createdAt ? routine : newest));
}

/** After a create whose answer was lost: the routine that create made, or null. */
export async function recoverCreatedRoutineAfterLostAnswer(
  error: unknown,
  knownIds: ReadonlySet<string>,
  input: RoutineCreateIdentity,
  listRoutines: () => Promise<{ routines?: Routine[] }>,
): Promise<Routine | null> {
  if (!answerWasLost(error)) return null;
  const listed = await listRoutines().catch(() => null);
  if (!listed?.routines) return null;
  return routineCreatedBy(knownIds, listed.routines, input);
}
