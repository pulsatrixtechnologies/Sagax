// Published pages (2026-10-16, parity with Grok Bot's canvases): a bot
// proposes a page (HTML, Markdown or a small one-file static app) from a
// conversation; the person reviews it on its card and publishes it, choosing
// who can see it. Shared by the server (server/published-pages.ts) and the
// app (src/components/PagePublishCard.tsx, PublishedPagesSettings.tsx).
//
// The isolation rules live here so both sides read the same words: a page is
// always served and previewed inside a Sagax wrapper, in a sandbox without
// `allow-same-origin` (an opaque origin: no Sagax cookie, storage or API) and
// under a CSP that blocks fetch, XHR, beacons, remote images, scripts and
// fonts. Not everything is a CSP request: WebRTC (RTCPeerConnection to a
// STUN or TURN server), resource hints (Chromium fetches a
// `<link rel=prerender>` whatever the CSP says), speculation rules and
// nested frames are not covered by CSP everywhere. The server neuters them
// in every stored HTML version (neuterPageHtml) and a synchronous prelude
// neuters them before a script can insert them (FRAME_PRELUDE), both in
// server/published-pages-render.ts. Residual, by browser: a blocked
// navigation still makes Chromium resolve the name (and open a TCP
// connection) once; WebKit pre-connects TCP on a target=_blank click.

export type PageKind = "html" | "markdown";
export type PageAccess = "private" | "org" | "link";
export type PageStatus = "draft" | "published" | "revoked";
export type PageVersionState = "proposed" | "published" | "declined";

export const PAGE_ACCESS: readonly PageAccess[] = ["private", "org", "link"];

export const PAGE_LIMITS = {
  title: 120,
  /** One document, inline scripts, styles and data: URIs included. */
  contentBytes: 512 * 1024,
  /** Versions kept per page (a published one is never dropped). */
  versions: 20,
  /** Pages per person, per bot, and on the whole server. */
  pagesPerOwner: 50,
  pagesPerBot: 50,
  pages: 500,
  /** Every kept version's content of one person's pages, together. */
  bytesPerOwner: 50 * 1024 * 1024,
  /** Every kept version's content on the server, together. */
  totalBytes: 100 * 1024 * 1024,
  /** The farthest expiry a person can set. */
  maxExpiryMs: 366 * 24 * 60 * 60 * 1000,
} as const;

/** The reader's entry: a Sagax wrapper page with a permanent warning banner
 * that embeds the page itself in a sandboxed frame. Before the auth gate. */
export const PAGE_VIEW_PREFIX = "/pages/view/";
/** The page itself, only ever inside the wrapper's frame (a short-lived frame
 * ticket in `?t=`, `frame-ancestors` limited to the wrapper's origin). */
export const PAGE_FRAME_PREFIX = "/pages/frame/";
/** The app's own preview of a version (its person only, any state): a
 * wrapper the app frames, and the page in it. */
export const PAGE_PREVIEW_PREFIX = "/pages/preview/";
export const PAGE_PREVIEW_FRAME_PREFIX = "/pages/preview-frame/";
/** The banner shows at most this much of a bot's or a person's name. */
export const PAGE_BANNER_NAME_MAX = 60;
/** How long a frame ticket the wrapper mints stays valid. */
export const PAGE_FRAME_TICKET_MS = 5 * 60 * 1000;

/** The iframe sandbox of a page, in the wrapper and in the app's preview:
 * scripts only for HTML, nothing for Markdown. Never `allow-same-origin`,
 * `allow-top-navigation*`, `allow-popups*`, `allow-modals` or `allow-forms`:
 * the page can only navigate its own frame, cannot open a window or a
 * prompt() asking for a password, and cannot submit a form. */
export function pageFrameSandbox(kind: PageKind): string {
  return kind === "html" ? "allow-scripts" : "";
}

/** The CSP of the page itself (and of its preview as a meta tag, minus the
 * directives a meta tag ignores). `sandbox` without `allow-same-origin` gives
 * it an opaque origin: no Sagax cookie, storage or API. `default-src 'none'`
 * and `connect-src 'none'` stop every request (no fetch, no beacon, no remote
 * image, script or font). WebRTC, resource hints, speculation rules and
 * nested frames are outside CSP: neutered by the server and the prelude
 * (server/published-pages-render.ts). A Markdown page runs no script. `frameAncestors`
 * names who may frame it: the wrapper's origin. */
export function pageCsp(kind: PageKind, options: { meta?: boolean; frameAncestors?: string } = {}): string {
  const directives = [
    "default-src 'none'",
    kind === "html" ? "script-src 'unsafe-inline'" : "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ];
  if (!options.meta) {
    directives.push(`frame-ancestors ${options.frameAncestors ?? "'self'"}`);
    directives.push(`sandbox ${pageFrameSandbox(kind)}`.trim());
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
