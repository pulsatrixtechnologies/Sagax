// A person, by a stable id. Emails change and "local-owner" was never a
// person; ownership, channel membership and grants key on `pr_<uuid>`.
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const PRINCIPAL_ID_REGEX = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const principalSchema = z.object({
  id: z.string().regex(PRINCIPAL_ID_REGEX),
  kind: z.enum(["human", "guest"]),
  email: z.string().max(320).optional(),
  controlPlaneUserId: z.string().max(256).optional(),
  local: z.boolean().optional(),
  createdAt: z.number(),
});
const fileSchema = z.object({ version: z.literal(1), principals: z.array(principalSchema) });

export type Principal = z.infer<typeof principalSchema>;

export function isPrincipalId(value: string): boolean {
  return PRINCIPAL_ID_REGEX.test(value);
}

const emailKey = (email: string) => email.trim().toLowerCase();

export class PrincipalRegistry {
  private readonly path: string;
  private readonly now: () => number;
  private readonly newId: () => string;
  private principals: Principal[] = [];

  constructor(options: { path: string; now?: () => number; newId?: () => string }) {
    this.path = options.path;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => `pr_${randomUUID()}`);
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      return; // unreadable: start empty rather than refuse to boot
    }
    const parsed = fileSchema.safeParse(raw);
    if (parsed.success) this.principals = parsed.data.principals;
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
    let found = account ? this.principals.find((p) => p.controlPlaneUserId === account) : undefined;
    found ??= email ? this.principals.find((p) => p.email === email && (!p.controlPlaneUserId || !account)) : undefined;
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

  /** The person at this computer. There is one; a profile email is an
   * attribute of it, never a second person. */
  localOperator(email?: string): Principal {
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
    if (key) found.email = key;
    else delete found.email;
    this.persist();
    return { ...found };
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.path, JSON.stringify({ version: 1, principals: this.principals }, null, 2), { mode: 0o600 });
  }
}
