import { INVITE_TTL_MS, type OrgInvite } from "./org-directory.ts";

export interface OrgRecord {
  name: string;
  host: { kind: "this-computer" } | { kind: "server"; url: string };
  ownerUserId: string;
}

export function createOrg(input: { name: string; ownerUserId: string; host: OrgRecord["host"] }): OrgRecord {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  return { name, ownerUserId: input.ownerUserId, host: input.host };
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
  if (input.members.includes(email)) return { members: input.members, alreadyMember: true };
  return { members: [...input.members, email], alreadyMember: false };
}
