// #1522: a create whose answer is lost on the way (a proxy that closes the
// request, 499; a gateway error; the network) may still have saved the
// routine. The dialog reads the routines again before it reports a failure,
// so it never invites a second click that makes a duplicate.
import type { Routine } from "./routines";

/** Gateway or transport codes: the server's answer never reached the app. */
const LOST_ANSWER_STATUSES = new Set([408, 499, 502, 503, 504]);

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

/** The routine this create made, among those listed after it: new since the
 * dialog's save began, same name, bot and target. The newest wins. */
export function routineCreatedBy(
  knownIds: ReadonlySet<string>,
  listed: readonly Routine[],
  input: { name: string; botId: string; target?: Routine["target"] },
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
