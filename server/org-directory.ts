export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type OrgRole = "owner" | "admin" | "member";
export interface OrgInvite {
  token: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  revokedAt?: number;
}
export function inviteStatus(invite: OrgInvite, now: number): "open" | "expired" | "used" | "revoked" {
  if (invite.revokedAt !== undefined) return "revoked";
  if (invite.usedAt !== undefined) return "used";
  if (now >= invite.expiresAt) return "expired";
  return "open";
}
export function acceptInvite(invite: OrgInvite, now: number) {
  const status = inviteStatus(invite, now);
  if (status !== "open") return { ok: false as const, status };
  return { ok: true as const, invite: { ...invite, usedAt: now } };
}
export function roleOf(input: { ownerUserId: string; admins: string[]; members: string[]; userId: string }): OrgRole | null {
  if (input.userId === input.ownerUserId) return "owner";
  if (input.admins.includes(input.userId)) return "admin";
  if (input.members.includes(input.userId)) return "member";
  return null;
}
