// One-time rewrite of stored person references (emails, "local-owner") to
// principal ids. Pure over its inputs apart from the registry, which creates
// principals as it meets new emails. Running it twice changes nothing.
import { isPrincipalId, type PrincipalRegistry } from "./principals.ts";

export function principalIdFor(raw: string, registry: PrincipalRegistry): string {
  const value = raw.trim();
  if (isPrincipalId(value)) return value;
  const key = value.toLowerCase();
  if (!key || key === "local-owner") return registry.localOperator().id;
  const local = registry.list().find((p) => p.local);
  if (local?.email && local.email === key) return local.id;
  if (key.includes("@")) return registry.forAccount({ email: key }).id;
  return value;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function migrateIdentityRefs(input: {
  org: { ownerUserId: string } | null;
  groups: { id: string; humanIds?: string[] }[];
  bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
  sessions: { id: string; email?: string; userId?: string; principalId?: string; scopes?: readonly string[] }[];
  registry: PrincipalRegistry;
}) {
  const { registry } = input;
  const map = (raw: string) => principalIdFor(raw, registry);
  const result: {
    orgOwner?: string;
    groups: { id: string; humanIds: string[] }[];
    bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
    sessions: { id: string; principalId: string }[];
  } = { groups: [], bots: [], sessions: [] };

  if (input.org) {
    const owner = map(input.org.ownerUserId);
    if (owner !== input.org.ownerUserId) result.orgOwner = owner;
  }
  for (const group of input.groups) {
    if (!group.humanIds?.length) continue;
    const next = [...new Set(group.humanIds.map(map))];
    if (!sameList(next, group.humanIds)) result.groups.push({ id: group.id, humanIds: next });
  }
  for (const bot of input.bots) {
    const owner = bot.ownerUserId ? map(bot.ownerUserId) : undefined;
    const grants = bot.directGrants ? [...new Set(bot.directGrants.map(map))] : undefined;
    const ownerChanged = owner !== bot.ownerUserId;
    const grantsChanged = grants !== undefined && !sameList(grants, bot.directGrants!);
    if (ownerChanged || grantsChanged) {
      result.bots.push({ id: bot.id, ...(owner ? { ownerUserId: owner } : {}), ...(grants ? { directGrants: grants } : {}) });
    }
  }
  for (const session of input.sessions) {
    if (session.principalId) continue;
    const email = session.email?.trim();
    const userId = session.userId?.trim();
    // Before principals, only an admin could mint a pairing code. So:
    // - email present: the person at that address.
    // - no email, no userId, admin scope: pairing session from before account tracking (operator's device).
    // - no email, no userId, chat-only scope: an anonymous device; no principal.
    // - no email, userId present: incomplete migration state; skip (no principal yet).
    if (!email && userId) continue;
    if (!email && !session.scopes?.includes("admin")) continue;
    const principalId = email
      ? registry.forAccount({ email, controlPlaneUserId: userId && !userId.startsWith("portal:") ? userId : undefined }).id
      : registry.localOperator().id;
    result.sessions.push({ id: session.id, principalId });
  }
  return result;
}
