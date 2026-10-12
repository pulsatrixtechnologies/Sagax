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
