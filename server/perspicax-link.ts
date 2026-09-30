// The link between this organization server and its Perspicax (slice 3).
//
// Perspicax writes a small JSON file when it links this server (at boot, or
// when an admin rotates the link in its console): the issuer, the client id,
// this server's id in Perspicax, this server's public origin, and a link
// token (`pxat1.`) that opens only the directory. Pulsa Bot reads it here,
// refuses anything that does not match its own configuration, and never
// logs the token.
//
// The directory (GET /api/v1/pulsabot/directory) lists the organization's
// people and teams. Polling it keeps the principals current: a person can be
// chosen before their first sign-in, a demotion narrows live sessions at
// once, and a disabled or deleted person is logged out even when the
// back-channel push never arrived (T8).
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// sections 5 and 6 (link file, directory), 9 (T5).
import { lstatSync, readFileSync } from "node:fs";
import { z } from "zod";

import type { Principal } from "./principals.ts";

export const LINK_FILE_MAX_BYTES = 4 * 1024;
export const DIRECTORY_MAX_BYTES = 4 * 1024 * 1024;
export const DIRECTORY_TIMEOUT_MS = 10_000;
export const DIRECTORY_PATH = "/api/v1/pulsabot/directory";
const LINK_TOKEN = /^pxat1\.[A-Za-z0-9_-]{20,200}$/;
const SERVER_ID = /^[0-9a-z]{1,64}$/;
const LINK_KEYS = ["client_id", "issuer", "link_token", "origin", "server_id", "version"];

export interface LinkExpectation {
  /** OMB_PERSPICAX_ISSUER, as configured. */
  issuer: string;
  /** OMB_PUBLIC_URL, this server's public origin. */
  publicOrigin: string;
  /** The OIDC client id (OMB_OIDC_CLIENT_ID, default pulsa-bot). */
  clientId: string;
}

export interface PerspicaxLink {
  issuer: string;
  clientId: string;
  serverId: string;
  origin: string;
  linkToken: string;
  mtimeMs: number;
}

export type LinkFileRead =
  | { ok: true; link: PerspicaxLink }
  | { ok: false; code: "missing" | "not_a_file" | "mode" | "size" | "json" | "fields" | "mismatch"; reason: string };

const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};
const trimSlash = (value: string) => value.trim().replace(/\/+$/, "");

/** Read and check the link file. Refused: anything but a regular file, any
 * permission bit for "other" users, more than 4 KiB, keys other than the six
 * of the contract, or fields that do not match this server. */
export function readLinkFile(path: string, expect: LinkExpectation): LinkFileRead {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? { ok: false, code: "missing", reason: "the link file does not exist yet" }
      : { ok: false, code: "not_a_file", reason: `the link file cannot be read (${code ?? "error"})` };
  }
  if (!stat.isFile()) return { ok: false, code: "not_a_file", reason: "the link file is not a regular file" };
  if ((stat.mode & 0o007) !== 0) return { ok: false, code: "mode", reason: "the link file is readable by other users; make it 0640 or 0600" };
  if (stat.size > LINK_FILE_MAX_BYTES) return { ok: false, code: "size", reason: "the link file is larger than 4 KiB" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, code: "json", reason: "the link file is not JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, code: "json", reason: "the link file is not a JSON object" };
  const doc = parsed as Record<string, unknown>;
  if (Object.keys(doc).sort().join(",") !== LINK_KEYS.join(",")) return { ok: false, code: "fields", reason: "the link file must hold exactly version, issuer, client_id, server_id, origin and link_token" };
  if (doc.version !== 1) return { ok: false, code: "fields", reason: "the link file version is not 1" };
  if (typeof doc.issuer !== "string" || typeof doc.client_id !== "string" || typeof doc.server_id !== "string" || typeof doc.origin !== "string" || typeof doc.link_token !== "string") {
    return { ok: false, code: "fields", reason: "a link file field is not a string" };
  }
  if (!SERVER_ID.test(doc.server_id)) return { ok: false, code: "fields", reason: "the link file server_id is not an id" };
  if (!LINK_TOKEN.test(doc.link_token)) return { ok: false, code: "fields", reason: "the link file token is not a Perspicax link token" };
  if (trimSlash(doc.issuer) !== trimSlash(expect.issuer)) return { ok: false, code: "mismatch", reason: "the link file names another Perspicax (issuer)" };
  if (doc.client_id !== expect.clientId) return { ok: false, code: "mismatch", reason: "the link file names another client id" };
  if (!originOf(doc.origin) || originOf(doc.origin) !== originOf(expect.publicOrigin)) return { ok: false, code: "mismatch", reason: "the link file names another Pulsa Bot origin" };
  return { ok: true, link: { issuer: doc.issuer, clientId: doc.client_id, serverId: doc.server_id, origin: doc.origin, linkToken: doc.link_token, mtimeMs: stat.mtimeMs } };
}

const personSchema = z.object({
  sub: z.string().min(1).max(255),
  login: z.string().max(200),
  name: z.string().max(200),
  email: z.string().max(320).nullable(),
  role: z.enum(["admin", "manager", "employee"]),
  status: z.enum(["active", "disabled"]),
  locale: z.string().max(40).nullable().optional(),
  /** Slice 4: which model providers this person keeps a key for in
   * Perspicax (names only, never a key). */
  provider_keys: z.array(z.string().max(32)).max(16).optional(),
});
const teamSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  managers: z.array(z.string().max(255)).max(100_000),
  members: z.array(z.string().max(255)).max(100_000),
});
export const directorySchema = z.object({
  server_id: z.string().min(1).max(64),
  people: z.array(personSchema).max(100_000),
  teams: z.array(teamSchema).max(100_000),
});
export type DirectoryPerson = z.infer<typeof personSchema>;
export type DirectoryTeam = z.infer<typeof teamSchema>;
export type Directory = z.infer<typeof directorySchema>;

export interface DirectoryState {
  state: "missing" | "ok" | "error";
  /** When the directory last answered (200 or 304), ms since the epoch. */
  syncedAt?: number;
  /** A short code: link_missing, link_invalid, link_refused, unreachable,
   * http_<status>, too_large, malformed, server_mismatch. */
  error?: string;
}

export interface DirectoryPrincipals {
  upsertFromDirectory(input: { iss: string; sub: string; name?: string | null; login?: string | null; email?: string | null; orgRole: "admin" | "member"; teams?: { id: string; manager: boolean }[]; perspicaxRole?: "admin" | "manager" | "employee" }): Principal;
  listBySubjectIssuer(iss: string): Principal[];
}

/** The team names registry (org-teams.ts). */
export interface DirectoryTeamNames {
  replaceFromDirectory(teams: readonly { id: string; name: string }[]): boolean;
}

export const PROVIDER_KEY_RESOLVE_PATH = "/api/v1/pulsabot/provider-keys/resolve";
export const PROVIDER_KEY_TIMEOUT_MS = 5_000;
export const PROVIDER_KEY_MAX_BYTES = 8 * 1024;
export const PROVIDER_KEY_CACHE_MS = 60_000;
export type ModelProvider = "anthropic" | "openai";
export type ProviderKeyResult =
  | { ok: true; key: string; fingerprint: string }
  | { ok: false; error: "no_key" | "user_inactive" | "unreachable" | "link" };

export interface PerspicaxDirectoryOptions {
  /** OMB_PERSPICAX_ISSUER: the subjects' `iss`. */
  issuer: string;
  /** Where the directory is fetched: OMB_PERSPICAX_INTERNAL_URL, else the
   * issuer's origin. */
  serverBase: string;
  linkFile: string;
  expect: LinkExpectation;
  principals: DirectoryPrincipals;
  /** The person is out (disabled in Perspicax, or deleted): same effect as a
   * back-channel logout. */
  onPersonOut: (iss: string, sub: string) => void;
  /** This principal was an admin and no longer is: narrow its sessions now. */
  onRoleNarrowed: (principalId: string) => void;
  /** Pulsa Bot's version, sent as X-Pulsabot-Version. */
  version: string;
  /** Slice 4: team names (org-teams.ts), replaced from each directory. */
  teamNames?: DirectoryTeamNames;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
  timeoutMs?: number;
}

async function readLimited(response: Response, max: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const VERSION_HEADER = /^[0-9A-Za-z.+-]{1,64}$/;

/** The organization's people, read from Perspicax with the link token. One
 * refresh at a time; a failed call keeps the last good data. */
export class PerspicaxDirectory {
  private readonly options: PerspicaxDirectoryOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private link: PerspicaxLink | null = null;
  private etag: string | null = null;
  private data: Directory | null = null;
  private current: DirectoryState = { state: "missing", error: "link_missing" };
  private inflight: Promise<DirectoryState> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Slice 4: provider names per subject, from the last directory. */
  private keysBySub = new Map<string, string[]>();
  /** Slice 4: owner keys read through the link, in memory only. */
  private readonly keyCache = new Map<string, { key: string; fingerprint: string; until: number }>();

  constructor(options: PerspicaxDirectoryOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  state(): DirectoryState {
    return { ...this.current };
  }

  /** The server id Perspicax gave this server, once a link file was read. */
  serverId(): string | undefined {
    return this.link?.serverId;
  }

  /** The last directory Perspicax sent, or null before the first answer. */
  directory(): Directory | null {
    return this.data;
  }

  people(): DirectoryPerson[] {
    return this.data ? [...this.data.people] : [];
  }

  /** The providers this subject keeps a key for in Perspicax (slice 4),
   * from the last directory; [] when unknown. */
  providerKeys(sub: string): string[] {
    return [...(this.keysBySub.get(sub) ?? [])];
  }

  /** Drop a cached owner key (a provider refused it, or the owner lost it). */
  invalidate(sub: string, provider: string): void {
    this.keyCache.delete(`${sub}\u0000${provider}`);
  }

  /** Drop every cached owner key of a subject (a back-channel logout, a
   * disabled or vanished person). */
  forgetSubject(sub: string): void {
    const prefix = `${sub}\u0000`;
    for (const cacheKey of this.keyCache.keys()) if (cacheKey.startsWith(prefix)) this.keyCache.delete(cacheKey);
  }

  /** An owner's model key, read through the link (slice 4, contract 3):
   * cached in memory for 60 s at most, never logged, never written. */
  async resolveProviderKey(sub: string, provider: ModelProvider): Promise<ProviderKeyResult> {
    const cacheKey = `${sub}\u0000${provider}`;
    const cached = this.keyCache.get(cacheKey);
    if (cached && cached.until > this.now()) return { ok: true, key: cached.key, fingerprint: cached.fingerprint };
    this.keyCache.delete(cacheKey);
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const call = (token: string) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${PROVIDER_KEY_RESOLVE_PATH}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(PROVIDER_KEY_TIMEOUT_MS),
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ sub, provider }),
    });
    let response: Response;
    try {
      response = await call(link.linkToken);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link.linkToken);
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "link" };
    }
    if (response.status === 404 || response.status === 409) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: response.status === 404 ? "no_key" : "user_inactive" };
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "unreachable" };
    }
    let text: string | null;
    try {
      text = await readLimited(response, PROVIDER_KEY_MAX_BYTES);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (text === null) return { ok: false, error: "unreachable" };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const key = record.key;
    const fingerprint = typeof record.fingerprint === "string" ? record.fingerprint.slice(0, 128) : "";
    if (record.provider !== provider || typeof key !== "string" || key.length < 20 || key.length > 512 || [...key].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || /\s/.test(key)) {
      return { ok: false, error: "unreachable" };
    }
    this.keyCache.set(cacheKey, { key, fingerprint, until: this.now() + PROVIDER_KEY_CACHE_MS });
    return { ok: true, key, fingerprint };
  }

  start(intervalMs: number): void {
    this.stop();
    void this.refresh("boot");
    this.timer = setInterval(() => void this.refresh("poll"), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fetch the directory now (single flight: a call while one is running
   * joins it). Never throws. */
  refresh(_reason = "manual"): Promise<DirectoryState> {
    this.inflight ??= this.run().catch((error: unknown) => {
      this.fail("unreachable", error instanceof Error ? error.message : String(error));
      return this.state();
    }).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private readLink(): PerspicaxLink | null {
    const read = readLinkFile(this.options.linkFile, this.options.expect);
    if (!read.ok) {
      if (read.code === "missing") {
        this.current = { state: this.data ? "error" : "missing", error: "link_missing", ...(this.current.syncedAt ? { syncedAt: this.current.syncedAt } : {}) };
      } else {
        this.fail("link_invalid", read.reason);
      }
      this.link = null;
      return null;
    }
    if (this.link && this.link.serverId !== read.link.serverId) {
      // Relinked to a new server id: start over with no cached answer.
      this.etag = null;
    }
    this.link = read.link;
    return read.link;
  }

  private fail(code: string, detail: string): void {
    this.current = { state: "error", error: code, ...(this.current.syncedAt ? { syncedAt: this.current.syncedAt } : {}) };
    this.log(`perspicax directory: ${code} (${detail.slice(0, 200)})`);
  }

  private async call(link: PerspicaxLink): Promise<Response> {
    const version = VERSION_HEADER.test(this.options.version) ? this.options.version : "unknown";
    return this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${DIRECTORY_PATH}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DIRECTORY_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${link.linkToken}`,
        "x-pulsabot-version": version,
        ...(this.etag ? { "if-none-match": this.etag } : {}),
      },
    });
  }

  private async run(): Promise<DirectoryState> {
    let link = this.readLink();
    if (!link) return this.state();
    let response: Response;
    try {
      response = await this.call(link);
      if (response.status === 401 || response.status === 403) {
        void response.body?.cancel().catch(() => {});
        // The token was rotated (or the file rewritten): read it again and
        // try once more with what it holds now.
        const before = link.linkToken;
        const again = this.readLink();
        if (!again) return this.state();
        if (again.linkToken === before && response.status === 403) {
          this.fail("link_refused", `the directory answered ${response.status}`);
          return this.state();
        }
        link = again;
        response = await this.call(link);
        if (response.status === 401 || response.status === 403) {
          void response.body?.cancel().catch(() => {});
          this.fail("link_refused", `the directory answered ${response.status} after re-reading the link file`);
          return this.state();
        }
      }
    } catch (error) {
      this.fail("unreachable", error instanceof Error ? error.message : String(error));
      return this.state();
    }
    if (response.status === 304) {
      void response.body?.cancel().catch(() => {});
      if (!this.data) {
        // A 304 with nothing cached cannot be applied: ask again in full.
        this.etag = null;
        this.fail("malformed", "not modified, but nothing is cached");
        return this.state();
      }
      this.current = { state: "ok", syncedAt: this.now() };
      return this.state();
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      this.fail(`http_${response.status}`, `the directory answered ${response.status}`);
      return this.state();
    }
    const text = await readLimited(response, DIRECTORY_MAX_BYTES);
    if (text === null) {
      this.fail("too_large", "the directory is larger than 4 MiB");
      return this.state();
    }
    let parsed: Directory;
    try {
      const checked = directorySchema.safeParse(JSON.parse(text));
      if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? "invalid");
      parsed = checked.data;
    } catch (error) {
      this.fail("malformed", error instanceof Error ? error.message : String(error));
      return this.state();
    }
    if (parsed.server_id !== link.serverId) {
      this.fail("server_mismatch", "the directory names another server id than the link file");
      return this.state();
    }
    this.apply(parsed);
    this.data = parsed;
    const etag = response.headers.get("etag");
    this.etag = etag && etag.length <= 128 ? etag : null;
    this.current = { state: "ok", syncedAt: this.now() };
    return this.state();
  }

  /** D10: people upsert their principal; the ones who are out (disabled, or
   * a known subject now absent) get the back-channel logout effect; a person
   * who stopped being an admin is narrowed at once. */
  private apply(directory: Directory): void {
    const iss = this.options.issuer;
    const known = new Map(this.options.principals.listBySubjectIssuer(iss).map((p) => [p.subject!.sub, p] as const));
    const listed = new Set<string>();
    // Slice 4: each person's teams from the members and managers lists
    // (manager wins), and the team names.
    const teamsBySub = new Map<string, Map<string, boolean>>();
    const addTeam = (sub: string, id: string, manager: boolean) => {
      const teams = teamsBySub.get(sub) ?? new Map<string, boolean>();
      teams.set(id, (teams.get(id) ?? false) || manager);
      teamsBySub.set(sub, teams);
    };
    for (const team of directory.teams) {
      for (const sub of team.members) addTeam(sub, team.id, false);
      for (const sub of team.managers) addTeam(sub, team.id, true);
    }
    this.options.teamNames?.replaceFromDirectory(directory.teams.map((team) => ({ id: team.id, name: team.name })));
    const keys = new Map<string, string[]>();
    for (const person of directory.people) {
      // A disabled person's keys serve nobody (S4-14): resolve would answer
      // 409, and the cache must not outlive the disable.
      const names: string[] = person.status === "disabled" ? [] : [...new Set((person.provider_keys ?? []).filter((name) => name === "anthropic" || name === "openai"))].sort();
      keys.set(person.sub, names);
      if (person.status === "disabled") this.forgetSubject(person.sub);
      // A provider the directory no longer lists for this person: drop its key.
      for (const name of ["anthropic", "openai"]) if (!names.includes(name)) this.invalidate(person.sub, name);
    }
    for (const sub of this.keysBySub.keys()) {
      if (!keys.has(sub)) this.forgetSubject(sub);
    }
    this.keysBySub = keys;
    for (const person of directory.people) {
      listed.add(person.sub);
      const before = known.get(person.sub);
      const orgRole = person.role === "admin" ? "admin" as const : "member" as const;
      const teams = [...(teamsBySub.get(person.sub) ?? new Map<string, boolean>())].map(([id, manager]) => ({ id, manager }));
      let after: Principal;
      try {
        after = this.options.principals.upsertFromDirectory({ iss, sub: person.sub, name: person.name || person.login, login: person.login, email: person.email, orgRole, teams, perspicaxRole: person.role });
      } catch (error) {
        this.log(`perspicax directory: skipped a person (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      if (person.status === "disabled") {
        if (after.disabledAt === undefined) this.options.onPersonOut(iss, person.sub);
        continue;
      }
      if (before?.orgRole === "admin" && orgRole !== "admin") this.options.onRoleNarrowed(after.id);
    }
    for (const [sub, principal] of known) {
      if (listed.has(sub) || principal.disabledAt !== undefined) continue;
      this.options.onPersonOut(iss, sub);
    }
  }
}

/** OMB_PERSPICAX_DIRECTORY_SECONDS: an integer from 5 to 3600, default 300. */
export function directoryIntervalMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 300_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 3600) {
    throw new Error("OMB_PERSPICAX_DIRECTORY_SECONDS must be a whole number of seconds from 5 to 3600.");
  }
  return parsed * 1000;
}
