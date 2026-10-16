// Published pages (2026-10-16, parity with Grok Bot's canvases): a bot
// proposes a page (HTML, Markdown or a small one-file static app) from a
// conversation; the person reviews it on its card and publishes it, choosing
// who can see it. Shared by the server (server/published-pages.ts) and the
// app (src/components/PagePublishCard.tsx, PublishedPagesSettings.tsx).
//
// The isolation rules live here so both sides read the same words: a page is
// always served and previewed in a sandbox without `allow-same-origin` (an
// opaque origin: no Sagax cookie, storage or API) and under a CSP that
// forbids every network request.

export type PageKind = "html" | "markdown";
export type PageAccess = "private" | "org" | "link";
export type PageStatus = "draft" | "published" | "revoked";
export type PageVersionState = "proposed" | "published" | "declined";

export const PAGE_ACCESS: readonly PageAccess[] = ["private", "org", "link"];

export const PAGE_LIMITS = {
  title: 120,
  /** One document, inline scripts, styles and data: URIs included. */
  contentBytes: 512 * 1024,
  versions: 20,
  pages: 200,
  /** The farthest expiry a person can set. */
  maxExpiryMs: 366 * 24 * 60 * 60 * 1000,
} as const;

/** Where a published page is read: `<prefix><token>`, before the auth gate. */
export const PAGE_VIEW_PREFIX = "/pages/view/";

/** The iframe sandbox of a preview in the app. Never `allow-same-origin`. */
export const PAGE_FRAME_SANDBOX = "allow-scripts allow-modals allow-forms";

/** The CSP every page answer carries (and its preview as a meta tag, minus
 * the directives a meta tag ignores). `sandbox` without `allow-same-origin`
 * gives the document an opaque origin even when it is opened directly in a
 * tab: it cannot read Sagax cookies or storage, and `connect-src 'none'`
 * plus `default-src 'none'` stop every request (no fetch, no beacon, no
 * remote image, script or font). A Markdown page runs no script at all. */
export function pageCsp(kind: PageKind, options: { meta?: boolean } = {}): string {
  const directives = [
    "default-src 'none'",
    kind === "html" ? "script-src 'unsafe-inline'" : "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ];
  if (!options.meta) {
    directives.push("frame-ancestors 'none'");
    directives.push(`sandbox ${kind === "html" ? "allow-scripts allow-modals allow-forms" : ""}`.trim());
  }
  return directives.join("; ");
}

export interface PageVersionSummary {
  n: number;
  kind: PageKind;
  title: string;
  createdAt: number;
  state: PageVersionState;
  bytes: number;
  botId: string;
}

/** What the owner's list and the card read. Never the content. */
export interface PublishedPageSummary {
  id: string;
  title: string;
  status: PageStatus;
  access: PageAccess;
  expiresAt: number | null;
  /** The version readers get, when published. */
  currentVersion: number | null;
  botId: string;
  threadId: string;
  createdAt: number;
  updatedAt: number;
  /** The reading link while published; absent otherwise. */
  url?: string;
  path?: string;
  /** False when that address is this computer only. */
  reachable?: boolean;
  expired: boolean;
  versions: PageVersionSummary[];
}

/** The message field a proposal writes on its bot row (`pagePublish`). */
export interface PagePublishRef {
  pageId: string;
  version: number;
  title: string;
}

export type PageProposalInput =
  | { ok: true; value: { title: string; kind: PageKind; content: string; pageId?: string } }
  | { ok: false; error: string };

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The bot's arguments, checked. Pure. */
export function parsePageProposal(input: unknown): PageProposalInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Send { title, kind, content, page_id? }." };
  const record = input as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.replace(/\s+/g, " ").trim() : "";
  if (!title) return { ok: false, error: "title: a short title is required." };
  if (title.length > PAGE_LIMITS.title) return { ok: false, error: `title: at most ${PAGE_LIMITS.title} characters.` };
  const kind = record.kind;
  if (kind !== "html" && kind !== "markdown") return { ok: false, error: "kind: must be html or markdown." };
  const content = record.content;
  if (typeof content !== "string" || !content.trim()) return { ok: false, error: "content: the page's full text is required." };
  if (byteLength(content) > PAGE_LIMITS.contentBytes) return { ok: false, error: `content: at most ${PAGE_LIMITS.contentBytes / 1024} KB.` };
  const pageId = record.page_id;
  if (pageId !== undefined && pageId !== null && (typeof pageId !== "string" || !/^[A-Za-z0-9_-]{8,40}$/.test(pageId))) {
    return { ok: false, error: "page_id: the id an earlier propose_page returned, or leave it out." };
  }
  return { ok: true, value: { title, kind, content, ...(typeof pageId === "string" ? { pageId } : {}) } };
}

/** An expiry the person picked: null (never) or a time between now and the
 * farthest allowed. Pure. */
export function validExpiry(value: unknown, now: number): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return { ok: false };
  if (value <= now || value > now + PAGE_LIMITS.maxExpiryMs) return { ok: false };
  return { ok: true, value };
}

/** The expiry choices of the card and the list, in hours (0: never). */
export const PAGE_EXPIRY_CHOICES = [0, 24, 7 * 24, 30 * 24] as const;
