// Published pages store (shared/published-pages.ts has the rules; routes in
// server/routes/published-pages.ts).
//
// A page is versioned: each propose_page call adds a `proposed` version, and
// only the person's Publish on its card (or in Pages publiées) makes a
// version the one readers get. Nothing a bot sends can publish, change who
// can see a page or extend its life.
//
// The reading link is `<linkId>.<mac>`: a random 128-bit id and an
// HMAC-SHA256 (192 bits kept) of it under a key that never leaves the server
// (published-pages.key, 0600). Revoking drops the link id: the old link then
// answers the same 404 as a made-up one, and publishing again mints a new
// link, so a revoked link never comes back. Records live in
// published-pages.json (0600).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import {
  PAGE_LIMITS,
  PAGE_VIEW_PREFIX,
  type PageAccess,
  type PageKind,
  type PageStatus,
  type PageVersionState,
  type PageVersionSummary,
  type PublishedPageSummary,
} from "../shared/published-pages.ts";

const TOKEN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{32})$/;
const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;

export interface PageVersionRecord {
  n: number;
  kind: PageKind;
  title: string;
  content: string;
  createdAt: number;
  state: PageVersionState;
  botId: string;
}

export interface PageHistoryEntry {
  at: number;
  action: "propose" | "publish" | "decline" | "access" | "expiry" | "revoke";
  version?: number;
  by?: string;
}

export interface PageRecord {
  id: string;
  /** Whose page it is: the principal id on an organization server; absent
   * on a one-person server (its owner). */
  ownerId?: string;
  botId: string;
  threadId: string;
  createdAt: number;
  updatedAt: number;
  status: PageStatus;
  access: PageAccess;
  expiresAt: number | null;
  currentVersion: number | null;
  /** The live reading link's id; absent while not published. */
  linkId?: string;
  versions: PageVersionRecord[];
  history: PageHistoryEntry[];
}

export type PageError = { ok: false; status: 400 | 404 | 409; error: string; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameOwner(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

export class PublishedPages {
  private readonly file: string;
  private readonly key: Buffer;
  private readonly clock: () => number;

  constructor(dataDir: string, clock: () => number = Date.now) {
    this.clock = clock;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = join(dataDir, "published-pages.json");
    const keyFile = join(dataDir, "published-pages.key");
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
    this.key = readFileSync(keyFile);
  }

  private mac(linkId: string): string {
    return createHmac("sha256", this.key).update(`sagax-published-page:v1:${linkId}`).digest("base64url").slice(0, 32);
  }

  token(linkId: string): string {
    return `${linkId}.${this.mac(linkId)}`;
  }

  path(linkId: string): string {
    return `${PAGE_VIEW_PREFIX}${this.token(linkId)}`;
  }

  private verify(token: string): string | null {
    const match = TOKEN.exec(token);
    if (!match) return null;
    const expected = Buffer.from(this.mac(match[1]!));
    const given = Buffer.from(match[2]!);
    return given.length === expected.length && timingSafeEqual(given, expected) ? match[1]! : null;
  }

  private load(): PageRecord[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { version?: unknown; pages?: unknown };
      if (raw.version !== 1 || !Array.isArray(raw.pages)) return [];
      return raw.pages.filter((page): page is PageRecord => isRecord(page) && typeof page.id === "string" && Array.isArray(page.versions));
    } catch {
      return [];
    }
  }

  private save(pages: PageRecord[]): void {
    writeFileAtomic(this.file, JSON.stringify({ version: 1, pages }, null, 2), { mode: 0o600 });
  }

  private mutate<T>(id: string, change: (page: PageRecord, now: number) => T | PageError): T | PageError {
    const pages = this.load();
    const page = pages.find((entry) => entry.id === id);
    if (!page) return { ok: false, status: 404, error: "This page does not exist.", code: "not_found" };
    const now = this.clock();
    const result = change(page, now);
    if (isRecord(result) && result.ok === false) return result as PageError;
    page.updatedAt = now;
    this.save(pages);
    return result;
  }

  get(id: string): PageRecord | null {
    return this.load().find((page) => page.id === id) ?? null;
  }

  /** The pages one person may manage: theirs, or every page (`ownerId`
   * undefined: the owner of a one-person server). */
  list(ownerId: string | undefined): PageRecord[] {
    return this.load()
      .filter((page) => ownerId === undefined || sameOwner(page.ownerId, ownerId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** A bot's proposal: a new page, or a new version of one of this
   * conversation's pages. Never published here. */
  propose(input: { pageId?: string; ownerId?: string; botId: string; threadId: string; title: string; kind: PageKind; content: string }):
    { ok: true; page: PageRecord; version: PageVersionRecord } | PageError {
    const pages = this.load();
    const now = this.clock();
    let page = input.pageId ? pages.find((entry) => entry.id === input.pageId) : undefined;
    if (input.pageId && (!page || page.threadId !== input.threadId || !PAGE_ID.test(input.pageId))) {
      return { ok: false, status: 404, error: "page_id: no page of this conversation has that id. Leave it out to propose a new page.", code: "not_found" };
    }
    if (!page) {
      if (pages.length >= PAGE_LIMITS.pages) return { ok: false, status: 409, error: `This server keeps at most ${PAGE_LIMITS.pages} pages; the person must delete one first.`, code: "too_many" };
      page = {
        id: randomBytes(12).toString("base64url"),
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        botId: input.botId,
        threadId: input.threadId,
        createdAt: now,
        updatedAt: now,
        status: "draft",
        access: "private",
        expiresAt: null,
        currentVersion: null,
        versions: [],
        history: [],
      };
      pages.push(page);
    }
    const n = (page.versions.at(-1)?.n ?? 0) + 1;
    const version: PageVersionRecord = { n, kind: input.kind, title: input.title, content: input.content, createdAt: now, state: "proposed", botId: input.botId };
    page.versions.push(version);
    // Old versions that were never published go first; a published one stays.
    while (page.versions.length > PAGE_LIMITS.versions) {
      const drop = page.versions.findIndex((entry) => entry.n !== page!.currentVersion);
      if (drop < 0) break;
      page.versions.splice(drop, 1);
    }
    page.history.push({ at: now, action: "propose", version: n });
    page.updatedAt = now;
    this.save(pages);
    return { ok: true, page, version };
  }

  /** The person's Publish: make `version` the one readers get, with who can
   * see it and until when. Mints a reading link when there is none. */
  publish(id: string, input: { version: number; access: PageAccess; expiresAt: number | null; by?: string }): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const version = page.versions.find((entry) => entry.n === input.version);
      if (!version) return { ok: false, status: 404, error: "This version does not exist.", code: "no_version" } as PageError;
      if (version.state === "declined") return { ok: false, status: 409, error: "This version was declined.", code: "declined" } as PageError;
      for (const entry of page.versions) if (entry.state === "published" && entry.n !== version.n) entry.state = "proposed";
      version.state = "published";
      page.currentVersion = version.n;
      page.status = "published";
      page.access = input.access;
      page.expiresAt = input.expiresAt;
      page.linkId ??= randomBytes(16).toString("base64url");
      page.history.push({ at: now, action: "publish", version: version.n, ...(input.by ? { by: input.by } : {}) });
      return page;
    });
  }

  /** The person's Decline on a proposal: it can never be published. */
  decline(id: string, versionNumber: number, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const version = page.versions.find((entry) => entry.n === versionNumber);
      if (!version) return { ok: false, status: 404, error: "This version does not exist.", code: "no_version" } as PageError;
      if (version.state === "published") return { ok: false, status: 409, error: "This version is the published one; revoke the page instead.", code: "published" } as PageError;
      version.state = "declined";
      page.history.push({ at: now, action: "decline", version: versionNumber, ...(by ? { by } : {}) });
      return page;
    });
  }

  /** Change who can see a published page, or its expiry. */
  update(id: string, input: { access?: PageAccess; expiresAt?: number | null; by?: string }): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      if (page.status !== "published") return { ok: false, status: 409, error: "Publish this page first.", code: "not_published" } as PageError;
      if (input.access !== undefined && input.access !== page.access) {
        page.access = input.access;
        page.history.push({ at: now, action: "access", ...(input.by ? { by: input.by } : {}) });
      }
      if (input.expiresAt !== undefined && input.expiresAt !== page.expiresAt) {
        page.expiresAt = input.expiresAt;
        page.history.push({ at: now, action: "expiry", ...(input.by ? { by: input.by } : {}) });
      }
      return page;
    });
  }

  /** Stop serving the page now. The link is gone for good. */
  revoke(id: string, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      page.status = "revoked";
      delete page.linkId;
      page.currentVersion = null;
      for (const entry of page.versions) if (entry.state === "published") entry.state = "proposed";
      page.history.push({ at: now, action: "revoke", ...(by ? { by } : {}) });
      return page;
    });
  }

  remove(id: string): boolean {
    const pages = this.load();
    const kept = pages.filter((page) => page.id !== id);
    if (kept.length === pages.length) return false;
    this.save(kept);
    return true;
  }

  /** The page and version a reading token opens, or null: bad signature,
   * revoked, never published, or past its expiry. */
  open(token: string): { page: PageRecord; version: PageVersionRecord } | null {
    const linkId = this.verify(token);
    if (!linkId) return null;
    const page = this.load().find((entry) => entry.linkId === linkId);
    if (!page || page.status !== "published" || page.currentVersion === null) return null;
    if (page.expiresAt !== null && page.expiresAt <= this.clock()) return null;
    const version = page.versions.find((entry) => entry.n === page.currentVersion);
    return version ? { page, version } : null;
  }

  summary(page: PageRecord, origin: string, reachable: boolean): PublishedPageSummary {
    const versions: PageVersionSummary[] = page.versions.map((entry) => ({
      n: entry.n,
      kind: entry.kind,
      title: entry.title,
      createdAt: entry.createdAt,
      state: entry.state,
      bytes: Buffer.byteLength(entry.content),
      botId: entry.botId,
    }));
    const current = page.versions.find((entry) => entry.n === page.currentVersion) ?? page.versions.at(-1);
    const live = page.status === "published" && page.linkId;
    const path = live ? this.path(page.linkId!) : undefined;
    return {
      id: page.id,
      title: current?.title ?? "",
      status: page.status,
      access: page.access,
      expiresAt: page.expiresAt,
      currentVersion: page.currentVersion,
      botId: page.botId,
      threadId: page.threadId,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      expired: page.expiresAt !== null && page.expiresAt <= this.clock(),
      versions,
      ...(path ? { path, url: `${origin.replace(/\/+$/, "")}${path}`, reachable } : {}),
    };
  }
}
