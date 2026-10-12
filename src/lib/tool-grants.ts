// B3b: the grants review page's model (server/routes/tool-grants.ts).
export interface ToolGrantRow {
  id: string;
  subject: { kind: "bot" | "user"; id: string };
  scope: string;
  grantedBy: string;
  grantedAt: number;
  expiresAt?: number;
  revokedAt?: number;
  state: "active" | "expired" | "revoked";
}

export const grantTier = (scope: string): "read" | "write" | "admin" => (scope.split(":")[1] as "read" | "write" | "admin") ?? "write";

/** Active first, then newest; admin-tier grants flagged for the warning. */
export function sortGrants(rows: readonly ToolGrantRow[]): ToolGrantRow[] {
  const rank = { active: 0, expired: 1, revoked: 2 } as const;
  return [...rows].sort((a, b) => rank[a.state] - rank[b.state] || b.grantedAt - a.grantedAt);
}

export interface GrantDraft { botId: string; area: string; tier: "read" | "write" | "admin"; days: string }
export const MAX_ADMIN_GRANT_DAYS = 30;

/** The POST body for a draft, or the key of the reason it can't be sent. */
export function grantRequest(draft: GrantDraft, now: number):
  | { ok: true; body: { subject: { kind: "bot"; id: string }; scope: string; expiresAt?: number } }
  | { ok: false; error: "settings.toolAccess.form.needBot" | "settings.toolAccess.form.badArea" | "settings.toolAccess.form.badDays" | "settings.toolAccess.form.adminDays" } {
  if (!draft.botId) return { ok: false, error: "settings.toolAccess.form.needBot" };
  const area = draft.area.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(area)) return { ok: false, error: "settings.toolAccess.form.badArea" };
  const text = draft.days.trim();
  const days = text ? Number(text) : undefined;
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 365)) return { ok: false, error: "settings.toolAccess.form.badDays" };
  if (draft.tier === "admin" && (days === undefined || days > MAX_ADMIN_GRANT_DAYS)) return { ok: false, error: "settings.toolAccess.form.adminDays" };
  return { ok: true, body: { subject: { kind: "bot", id: draft.botId }, scope: `${area}:${draft.tier}`, ...(days ? { expiresAt: now + days * 86_400_000 } : {}) } };
}
