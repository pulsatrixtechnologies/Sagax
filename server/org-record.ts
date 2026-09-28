import { INVITE_TTL_MS, type OrgInvite } from "./org-directory.ts";

export interface OrgRecord {
  name: string;
  host: { kind: "this-computer" } | { kind: "server"; url: string };
  ownerUserId: string;
}

export function createOrg(input: { name: string; ownerUserId: string; host: OrgRecord["host"] }): OrgRecord {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  return { name, ownerUserId: input.ownerUserId.trim().toLowerCase(), host: input.host };
}

export function issueInvite(input: { email: string; now: number; token: string }): OrgInvite {
  return {
    token: input.token,
    email: input.email.trim().toLowerCase(),
    createdAt: input.now,
    expiresAt: input.now + INVITE_TTL_MS,
  };
}

export function memberListsAfterAccept(input: { members: string[]; email: string }) {
  const email = input.email.trim().toLowerCase();
  const members = input.members.map((id) => id.trim().toLowerCase()).filter(Boolean);
  if (members.includes(email)) return { members, alreadyMember: true };
  return { members: [...members, email], alreadyMember: false };
}
