// Who "you" are in the UI: the sidebar profile row, greetings, the name on
// your own messages. The operator at this computer (and a device they paired)
// is the operator, described by their profile as before. Anyone else who
// signed in is described from their own principal and sign-in email, and
// never sees the operator's private profile fields.
import type { OrgRole } from "./channel-membership.ts";

export interface ViewerIdentity {
  /** The operator at this computer, or a device they paired. */
  operator: boolean;
  /** The person's principal (server/principals.ts), when known. */
  principalId: string | null;
  /** Their own sign-in email; "" when unknown. */
  email: string;
  /** Their display name: a known name, else the email's local part. */
  name: string;
  role: OrgRole | null;
  /** Whether this server lets them create a bot (POST /api/bots). */
  canCreateBots: boolean;
  /** The operator's display name, for lines the operator sent without a
   * named sender. Only set for someone who is not the operator. */
  operatorName?: string;
}

/** "zara.q@example.test" becomes "zara.q". Anything without an "@" stays itself. */
export function displayNameFromEmail(email: string | undefined): string {
  const trimmed = email?.trim() ?? "";
  const at = trimmed.indexOf("@");
  return (at > 0 ? trimmed.slice(0, at) : trimmed).slice(0, 100);
}

/** Whether a session is the operator: its principal is the local operator's,
 * or (a session from before principals) it signed in with the operator's own
 * email, or it is a device paired with no person behind it where that has
 * always meant the operator (an admin code, or any code while no
 * organization exists). */
export function sessionIsOperator(input: {
  principalId?: string;
  email?: string;
  admin: boolean;
  localPrincipalId: string;
  operatorEmail?: string;
  orgExists: boolean;
}): boolean {
  const principalId = input.principalId?.trim();
  if (principalId) return principalId === input.localPrincipalId;
  const email = input.email?.trim().toLowerCase();
  if (email) return Boolean(input.operatorEmail) && email === input.operatorEmail!.trim().toLowerCase();
  return input.admin || !input.orgExists;
}

/** A config status as this viewer may see it: someone who is not the
 * operator gets their own identity in `profile` (no operator email, no
 * about-me, their own avatar, which is none yet), and everyone gets a
 * `viewer` block. */
export function configForViewer<T extends { profile: { name: string; email: string; aboutMe?: string; avatarUrl?: string } }>(
  status: T,
  viewer: ViewerIdentity | null,
): T & { viewer?: ViewerIdentity } {
  if (!viewer) return status;
  if (viewer.operator) return { ...status, viewer };
  return { ...status, profile: { name: viewer.name, email: viewer.email, aboutMe: "", avatarUrl: "" }, viewer };
}
