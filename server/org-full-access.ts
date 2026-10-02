// Full access on an organization server (2026-10-01, owner request).
//
// On a solo server Full access is granted only through the packaged desktop
// app's private channel (Electron confirms the grant), never over HTTP. An
// organization server has no such channel: the person's app is a remote
// client. There a bot's owner turns Full access on over HTTP, under three
// rules decided here:
//
// - the organization allows it (Settings > Organization, admin only,
//   `organization.allowFullAccess`, on by default);
// - the caller is a person signed in (a session with a principal), and is
//   the bot's owner: a bot's own shell, a service caller or loopback never
//   is, so a bot cannot raise itself;
// - the owner confirmed the risks once for that bot (`fullAccessConsent`,
//   kept on the bot): the first grant needs `confirmFullAccess: true`.
//
// At turn time a stored Full runs as Full only while the policy is on and the
// consent belongs to the bot's current owner (a routine runs as the bot's
// owner, so a routine gets Full only when that owner set it on that bot).
// Otherwise it runs as Ask. Full access never lifts a hard limit: host tools
// stay withheld on the server (withholdHostTools), private threads, egress
// and payer rules are unchanged.

export interface FullAccessConsent {
  /** The principal who confirmed the risks for this bot. */
  principalId: string;
  at: number;
}

export interface FullAccessRefusal {
  status: 403 | 409;
  error: string;
  code: "org_full_access_disabled" | "full_access_owner_only" | "full_access_confirm_required";
}

export const ORG_FULL_ACCESS_DISABLED: FullAccessRefusal = {
  status: 403,
  error: "Full access is turned off for this organization. An organization admin can allow it in Settings > Organization.",
  code: "org_full_access_disabled",
};
export const FULL_ACCESS_OWNER_ONLY: FullAccessRefusal = {
  status: 403,
  error: "Only the bot's owner, signed in, can turn on Full access for it.",
  code: "full_access_owner_only",
};
export const FULL_ACCESS_CONFIRM_REQUIRED: FullAccessRefusal = {
  status: 409,
  error: "Confirm the Full access warning for this bot first.",
  code: "full_access_confirm_required",
};

/** The organization's policy: allowed unless an admin turned it off. */
export function orgFullAccessAllowed(organization: { allowFullAccess?: unknown } | undefined): boolean {
  return organization?.allowFullAccess !== false;
}

export function parseFullAccessConsent(value: unknown): FullAccessConsent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { principalId, at } = value as Record<string, unknown>;
  if (typeof principalId !== "string" || !principalId.trim() || typeof at !== "number" || !Number.isFinite(at)) return null;
  return { principalId: principalId.trim().toLowerCase(), at };
}

/** Whether a principal already confirmed Full access for this bot. */
export function fullAccessConsentedBy(consent: unknown, principalId: string | null | undefined): boolean {
  const parsed = parseFullAccessConsent(consent);
  return Boolean(parsed && principalId && parsed.principalId === principalId.trim().toLowerCase());
}

/** Why an HTTP request may not turn Full access on for a bot on an
 * organization server, or null when it may. */
export function orgFullAccessGrantRefusal(input: {
  policyAllowed: boolean;
  /** The signed-in person asking; null for loopback, a service or a bot. */
  callerPrincipalId: string | null;
  ownerPrincipalId: string;
  confirmed: boolean;
  consent: unknown;
}): FullAccessRefusal | null {
  if (!input.policyAllowed) return ORG_FULL_ACCESS_DISABLED;
  const caller = input.callerPrincipalId?.trim().toLowerCase();
  if (!caller || caller !== input.ownerPrincipalId.trim().toLowerCase()) return FULL_ACCESS_OWNER_ONLY;
  if (!input.confirmed && !fullAccessConsentedBy(input.consent, caller)) return FULL_ACCESS_CONFIRM_REQUIRED;
  return null;
}

/** Whether a stored Full runs as Full for one turn on an organization
 * server: the policy is on and the bot's current owner confirmed it. */
export function orgFullAccessHolds(input: { policyAllowed: boolean; ownerPrincipalId: string; consent: unknown }): boolean {
  return input.policyAllowed && fullAccessConsentedBy(input.consent, input.ownerPrincipalId);
}
