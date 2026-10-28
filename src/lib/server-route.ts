// A section the app shows before its server has the route behind it: a newer
// app against an older server. That server answers a route it does not know
// with "no route: METHOD /path" (404). A member's session on that server is
// refused with "lacks the admin scope" (403), because the route was not yet
// on its member list. Neither is a failure the person can fix: the section
// says it arrives with the server update, never a red error.
import { ApiError } from "@/state/store";

export function routeMissingOnServer(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 404) return error.message.startsWith("no route:");
  if (error.status === 403) return /lacks the admin scope/.test(error.message);
  return false;
}
