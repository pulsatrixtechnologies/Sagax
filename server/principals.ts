// A person, by a stable id. Emails change and "local-owner" was never a
// person; ownership, channel membership and grants key on `pr_<uuid>`.
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const PRINCIPAL_ID_REGEX = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const principalSchema = z.object({
  id: z.string().regex(PRINCIPAL_ID_REGEX),
  kind: z.enum(["human", "guest"]),
  email: z.string().max(320).optional(),
  controlPlaneUserId: z.string().max(256).optional(),
  local: z.boolean().optional(),
  /** The identity provider account behind this person in organization mode
   * (`iss` + `sub`, never reused). Email is only an attribute beside it. */
  subject: z.object({ iss: z.string().min(1).max(2048), sub: z.string().min(1).max(255) }).optional(),
  name: z.string().max(200).optional(),
  login: z.string().max(200).optional(),
  /** The last Pulsa Bot organization role computed from the provider's
   * `role` claim, for display while offline. */
  orgRole: z.enum(["admin", "member"]).optional(),
  /** Set when the identity provider signalled that this person is out
   * (back-channel logout: disabled, deleted, sessions revoked). Cleared by
   * the next successful sign-in or refresh. While set, no session of theirs
   * is served. */
  disabledAt: z.number().optional(),
  createdAt: z.number(),
});
const fileSchema = z.object({ version: z.literal(1), principals: z.array(z.unknown()) });

export type Principal = z.infer<typeof principalSchema>;

export function isPrincipalId(value: string): boolean {
  return PRINCIPAL_ID_REGEX.test(value);
}

const emailKey = (email: string) => email.trim().toLowerCase();

const MAX_EMAIL = 320;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

/** A sign-in address a principal may carry: at most 320 characters and a
 * basic `local@domain` shape. Anything else never becomes a person. */
export function isAccountEmail(value: string): boolean {
  const key = emailKey(value);
  return key.length > 0 && key.length <= MAX_EMAIL && EMAIL_SHAPE.test(key);
}

/** Principals from a file's parsed JSON: invalid entries, repeated ids and a
 * second local operator are skipped, never fatal. */
export function principalsFrom(entries: unknown[], onSkip?: (index: number, reason: string) => void): Principal[] {
  const out: Principal[] = [];
  const ids = new Set<string>();
  let hasLocal = false;
  entries.forEach((entry, index) => {
    const parsed = principalSchema.safeParse(entry);
    if (!parsed.success) return onSkip?.(index, parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    const principal = parsed.data;
    if (ids.has(principal.id)) return onSkip?.(index, `repeated id ${principal.id}`);
    if (principal.local) {
      if (hasLocal) return onSkip?.(index, `second local operator ${principal.id}`);
      hasLocal = true;
    }
    ids.add(principal.id);
    out.push(principal);
  });
  return out;
}

/** A restore merges by id: every destination principal stays as it is,
 * archive principals the destination lacks are added, and the destination's
 * local operator is never replaced (an archive's local flag is dropped when
 * the destination already has one). */
export function mergePrincipalFiles(destination: unknown, incoming: unknown): { version: 1; principals: Principal[] } {
  const read = (value: unknown) => {
    const parsed = fileSchema.safeParse(value);
    return parsed.success ? principalsFrom(parsed.data.principals) : [];
  };
  const kept = read(destination);
  const ids = new Set(kept.map((p) => p.id));
  let hasLocal = kept.some((p) => p.local);
  for (const principal of read(incoming)) {
    if (ids.has(principal.id)) continue;
    const added = { ...principal };
    if (added.local) {
      if (hasLocal) delete added.local;
      else hasLocal = true;
    }
    ids.add(added.id);
    kept.push(added);
  }
  return { version: 1, principals: kept };
}

export class PrincipalRegistry {
  private readonly path: string;
  private readonly now: () => number;
  private readonly newId: () => string;
  private principals: Principal[] = [];
  private writable = true;

  constructor(options: { path: string; now?: () => number; newId?: () => string }) {
    this.path = options.path;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => `pr_${randomUUID()}`);
    this.load();
  }

  /** Entries are read one by one: a bad entry is skipped and logged, never
   * a reason to drop the others. A file that cannot be read at all is moved
   * aside as `principals.json.corrupt-<time>` so nothing overwrites it. */
  private load(): void {
    if (!existsSync(this.path)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      this.quarantine(`not JSON (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) {
      this.quarantine("not a version 1 principals file");
      return;
    }
    let skipped = 0;
    this.principals = principalsFrom(parsed.data.principals, (index, reason) => {
      skipped += 1;
      console.error(`principals: skipped entry ${index} in ${this.path}: ${reason}`);
    });
    if (skipped) {
      // The next write drops the skipped entries; keep the original beside it.
      const copy = `${this.path}.corrupt-${this.now()}`;
      try {
        copyFileSync(this.path, copy);
        console.error(`principals: kept the original file as ${copy}`);
      } catch (error) {
        console.error(`principals: could not keep a copy of ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private quarantine(reason: string): void {
    const aside = `${this.path}.corrupt-${this.now()}`;
    try {
      renameSync(this.path, aside);
      console.error(`principals: ${this.path} is unreadable (${reason}); moved to ${aside} and starting with no principals`);
    } catch (error) {
      // Never overwrite a file that could not be kept: principals live in
      // memory only until someone repairs it.
      this.writable = false;
      console.error(`principals: ${this.path} is unreadable (${reason}) and could not be moved aside; principals will not be saved until it is repaired: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  list(): Principal[] {
    return this.principals.map((p) => ({ ...p }));
  }

  byId(id: string): Principal | null {
    return this.principals.find((p) => p.id === id) ?? null;
  }

  byEmail(email: string): Principal | null {
    const key = emailKey(email);
    return key ? this.principals.find((p) => p.email === key) ?? null : null;
  }

  /** The person behind a verified sign-in. The control-plane account wins
   * over the email, so a changed address keeps its principal. */
  forAccount(input: { email: string; controlPlaneUserId?: string }): Principal {
    const email = emailKey(input.email);
    const account = input.controlPlaneUserId?.trim();
    if (email && !isAccountEmail(email)) throw new Error("not an account email: at most 320 characters, shaped local@domain");
    if (account && account.length > 256) throw new Error("account id is too long");
    if (!email && !account) throw new Error("an account email or id is required");
    let found = account ? this.principals.find((p) => p.controlPlaneUserId === account) : undefined;
    // A person known by an identity provider subject is never claimed by
    // an address: email is an attribute of theirs, not a key.
    found ??= email ? this.principals.find((p) => p.email === email && !p.subject && (!p.controlPlaneUserId || !account)) : undefined;
    if (found) {
      let changed = false;
      if (email && found.email !== email) { found.email = email; changed = true; }
      if (account && !found.controlPlaneUserId) { found.controlPlaneUserId = account; changed = true; }
      if (changed) this.persist();
      return { ...found };
    }
    const created: Principal = {
      id: this.newId(),
      kind: "human",
      ...(email ? { email } : {}),
      ...(account ? { controlPlaneUserId: account } : {}),
      createdAt: this.now(),
    };
    this.principals.push(created);
    this.persist();
    return { ...created };
  }

  /** The person behind a verified OpenID Connect sign-in, keyed by
   * `iss` + `sub` only. Name, login, address and role are attributes,
   * refreshed on every sign-in; an address that is not an account email is
   * dropped rather than stored. */
  forSubject(input: { iss: string; sub: string; claims?: { email?: string; name?: string; login?: string }; orgRole?: "admin" | "member" }): Principal {
    const iss = input.iss.trim();
    const sub = input.sub.trim();
    if (!iss || iss.length > 2048 || !sub || sub.length > 255) throw new Error("an issuer and a subject are required");
    const email = input.claims?.email && isAccountEmail(input.claims.email) ? emailKey(input.claims.email) : undefined;
    const name = input.claims?.name?.trim().slice(0, 200) || undefined;
    const login = input.claims?.login?.trim().slice(0, 200) || undefined;
    let found = this.principals.find((p) => p.subject?.iss === iss && p.subject.sub === sub);
    const created = !found;
    if (!found) {
      found = { id: this.newId(), kind: "human", subject: { iss, sub }, createdAt: this.now() };
      this.principals.push(found);
    }
    const before = JSON.stringify(found);
    if (email) found.email = email;
    else delete found.email;
    if (name) found.name = name;
    else delete found.name;
    if (login) found.login = login;
    else delete found.login;
    if (input.orgRole) found.orgRole = input.orgRole;
    // A verified sign-in or refresh is the provider saying this person is in.
    delete found.disabledAt;
    if (created || JSON.stringify(found) !== before) this.persist();
    return { ...found };
  }

  /** The person the Perspicax directory lists (slice 3): created when this
   * subject never signed in (so they can be chosen before their first
   * sign-in), else their name, login, address and organization role are
   * refreshed. `disabledAt` is left alone: only a sign-in or a refresh says
   * a person is back in. An absent attribute is dropped, as on a sign-in. */
  upsertFromDirectory(input: { iss: string; sub: string; name?: string | null; login?: string | null; email?: string | null; orgRole: "admin" | "member" }): Principal {
    const iss = input.iss.trim();
    const sub = input.sub.trim();
    if (!iss || iss.length > 2048 || !sub || sub.length > 255) throw new Error("an issuer and a subject are required");
    const email = input.email && isAccountEmail(input.email) ? emailKey(input.email) : undefined;
    const name = input.name?.trim().slice(0, 200) || undefined;
    const login = input.login?.trim().slice(0, 200) || undefined;
    let found = this.principals.find((p) => p.subject?.iss === iss && p.subject.sub === sub);
    const created = !found;
    if (!found) {
      found = { id: this.newId(), kind: "human", subject: { iss, sub }, createdAt: this.now() };
      this.principals.push(found);
    }
    const before = JSON.stringify(found);
    if (email) found.email = email;
    else delete found.email;
    if (name) found.name = name;
    else delete found.name;
    if (login) found.login = login;
    else delete found.login;
    found.orgRole = input.orgRole;
    if (created || JSON.stringify(found) !== before) this.persist();
    return { ...found };
  }

  /** Every person known by a subject of this issuer. */
  listBySubjectIssuer(iss: string): Principal[] {
    return this.principals.filter((p) => p.subject?.iss === iss).map((p) => ({ ...p }));
  }

  /** Mark the person behind this provider account as out (back-channel
   * logout). Returns the principal, or null for an unknown subject. */
  markDisabled(iss: string, sub: string, at: number = this.now()): Principal | null {
    const found = this.principals.find((p) => p.subject?.iss === iss && p.subject.sub === sub);
    if (!found) return null;
    found.disabledAt = at;
    this.persist();
    return { ...found };
  }

  bySubject(iss: string, sub: string): Principal | null {
    const found = this.principals.find((p) => p.subject?.iss === iss && p.subject.sub === sub);
    return found ? { ...found } : null;
  }

  /** The person at this computer, read only: null before the first
   * localOperator() call. */
  local(): Principal | null {
    const found = this.principals.find((p) => p.local);
    return found ? { ...found } : null;
  }

  /** The person at this computer. There is one; a profile email is an
   * attribute of it, never a second person. */
  localOperator(rawEmail?: string): Principal {
    // A profile email that is not an account address is not written.
    const email = rawEmail && isAccountEmail(rawEmail) ? rawEmail : undefined;
    let local = this.principals.find((p) => p.local);
    if (!local) {
      local = { id: this.newId(), kind: "human", local: true, createdAt: this.now() };
      this.principals.push(local);
      if (email) local.email = emailKey(email);
      this.persist();
    } else if (email && local.email !== emailKey(email)) {
      local.email = emailKey(email);
      this.persist();
    }
    return { ...local };
  }

  setEmail(id: string, email: string): Principal | null {
    const found = this.principals.find((p) => p.id === id);
    if (!found) return null;
    const key = emailKey(email);
    if (key && !isAccountEmail(key)) throw new Error("not an account email: at most 320 characters, shaped local@domain");
    if (key) found.email = key;
    else delete found.email;
    this.persist();
    return { ...found };
  }

  private persist(): void {
    if (!this.writable) return;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.path, JSON.stringify({ version: 1, principals: this.principals }, null, 2), { mode: 0o600 });
  }
}
