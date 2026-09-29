// Rewrite of stored person references (emails, "local-owner") to principal
// ids. Pure over its inputs apart from the registry, which creates principals
// as it meets new emails. It runs on every boot: principal ids pass through,
// so running it twice changes nothing, and data restored or imported later
// is mapped too.
import { isAccountEmail, isPrincipalId, type PrincipalRegistry } from "./principals.ts";

/** A person ref as a principal id. Only the literal "local-owner" is the
 * operator; a blank ref is nobody. A ref that is neither a principal id nor
 * an account email comes back unchanged and creates nothing. */
export function principalIdFor(raw: string, registry: PrincipalRegistry): string {
  const value = raw.trim();
  if (!value || isPrincipalId(value)) return value;
  const key = value.toLowerCase();
  if (key === "local-owner") return registry.localOperator().id;
  if (!isAccountEmail(key)) return value;
  const local = registry.local();
  if (local?.email && local.email === key) return local.id;
  return registry.forAccount({ email: key }).id;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function migrateIdentityRefs(input: {
  org: { ownerUserId: string } | null;
  groups: { id: string; humanIds?: string[] }[];
  bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
  sessions: { id: string; label?: string; email?: string; userId?: string; principalId?: string; scopes?: readonly string[] }[];
  registry: PrincipalRegistry;
}) {
  const { registry } = input;
  const map = (raw: string) => principalIdFor(raw, registry);
  // Blank refs are nobody: they are dropped from lists, never the operator.
  const mapList = (list: string[]) => [...new Set(list.map(map).filter((id) => id !== ""))];
  const result: {
    orgOwner?: string;
    groups: { id: string; humanIds: string[] }[];
    bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
    sessions: { id: string; principalId: string }[];
    /** Legacy admin pairing sessions that now act as the local operator. */
    promoted: { id: string; label?: string }[];
  } = { groups: [], bots: [], sessions: [], promoted: [] };

  if (input.org) {
    const owner = map(input.org.ownerUserId);
    if (owner !== input.org.ownerUserId) result.orgOwner = owner;
  }
  for (const group of input.groups) {
    if (!group.humanIds?.length) continue;
    const next = mapList(group.humanIds);
    if (!sameList(next, group.humanIds)) result.groups.push({ id: group.id, humanIds: next });
  }
  for (const bot of input.bots) {
    const owner = bot.ownerUserId ? map(bot.ownerUserId) : undefined;
    const grants = bot.directGrants ? mapList(bot.directGrants) : undefined;
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
    // An address that is not an account email never becomes a person.
    if (email && !isAccountEmail(email)) continue;
    const principalId = email
      ? registry.forAccount({ email, controlPlaneUserId: userId && !userId.startsWith("portal:") ? userId : undefined }).id
      : registry.localOperator().id;
    result.sessions.push({ id: session.id, principalId });
    if (!email) result.promoted.push({ id: session.id, ...(session.label ? { label: session.label } : {}) });
  }
  return result;
}

export interface IdentityMigrationDeps {
  registry: PrincipalRegistry;
  org: { ownerUserId: string } | null;
  saveOrgOwner(ownerUserId: string): void;
  groups: { id: string; humanIds?: string[] }[];
  patchGroup(id: string, patch: { humanIds: string[] }): void;
  bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
  patchBot(id: string, patch: { ownerUserId?: string; directGrants?: string[] }): void;
  sessions: { id: string; label?: string; email?: string; userId?: string; principalId?: string; scopes?: readonly string[] }[];
  setPrincipal(sessionId: string, principalId: string): void;
  log?: (line: string) => void;
}

/** The boot wiring: map every stored ref and apply the changes. Runs on
 * every boot, so a restored workspace or an imported team is mapped too. */
export function applyIdentityMigration(deps: IdentityMigrationDeps): ReturnType<typeof migrateIdentityRefs> {
  const migrated = migrateIdentityRefs({
    org: deps.org,
    groups: deps.groups,
    bots: deps.bots,
    sessions: deps.sessions,
    registry: deps.registry,
  });
  if (migrated.orgOwner) deps.saveOrgOwner(migrated.orgOwner);
  for (const g of migrated.groups) deps.patchGroup(g.id, { humanIds: g.humanIds });
  for (const b of migrated.bots) {
    deps.patchBot(b.id, { ...(b.ownerUserId ? { ownerUserId: b.ownerUserId } : {}), ...(b.directGrants ? { directGrants: b.directGrants } : {}) });
  }
  for (const s of migrated.sessions) deps.setPrincipal(s.id, s.principalId);
  const log = deps.log ?? ((line: string) => console.log(line));
  for (const s of migrated.promoted) {
    log(`identity: paired device ${s.id} (${s.label ?? "no label"}) now acts as the local operator; revoke it in Settings if it is not yours`);
  }
  return migrated;
}
