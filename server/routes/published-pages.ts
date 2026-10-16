// Published pages (server/published-pages.ts, shared/published-pages.ts).
//
// Before the auth gate (handlePublishedPagePublic, server/index.ts):
//   GET /pages/view/<token>    the reader's entry: a Sagax wrapper with a
//     permanent banner ("not a Sagax screen, never enter a password") and the
//     page in an iframe sandboxed to scripts only (Markdown: nothing). Its
//     CSP runs no script, frames only this page's frame path (`frame-src`
//     with the path, so the page cannot navigate its frame anywhere else)
//     and cannot itself be framed. Who may read it is checked here:
//     "link" anyone holding the link; "org" a signed-in person of this
//     server; "private" only the page's person (on a one-person server, the
//     computer's owner). A bad signature, a revoked link, an expired page
//     and a reader who may not see it all answer the same 404.
//   GET /pages/frame/<token>?t=<ticket>   the page itself, only with the
//     wrapper's five-minute ticket, only as an iframe when the browser says
//     (Sec-Fetch-Dest), under `sandbox` without allow-same-origin (opaque
//     origin), no network, `frame-ancestors` the wrapper's origin, no-store,
//     no Set-Cookie. With SAGAX_PAGES_ORIGIN the frames are served only on
//     that origin, which serves nothing else (handlePagesOriginRequest).
//
// Behind the gate, a person's own pages only (never another's, never a
// bot's shell, never a paired device that is not the computer's owner on a
// one-person server):
//   GET    /api/pages                       { pages: [...] }
//   GET    /api/pages/:id                   { page }
//   GET    /api/pages/:id/versions/:n       { version: { n, kind, title, state, previewPath } }
//          previewPath: /pages/preview/<id>/<n>, the wrapper the app frames
//   GET    /pages/preview/<id>/<n>          (before the gate) the page's person
//          only: the same wrapper (banner) framing /pages/preview-frame/...
//   GET    /api/admin/pages                 organization admins: every page
//   POST   /api/admin/pages/:id/revoke      organization admins (audited)
//   POST   /api/pages/:id/publish           { version, access, expiresAt|null }
//          the person's approval: the only way a version is published
//   POST   /api/pages/:id/decline           { version }
//   PATCH  /api/pages/:id                   { access?, expiresAt? } while published
//   POST   /api/pages/:id/revoke            stop serving now; the link is gone
//   DELETE /api/pages/:id
import type { IncomingMessage, ServerResponse } from "node:http";

import type { PageError, PageRecord, PageVersionRecord, PublishedPages } from "../published-pages.ts";
import { pageDocument, wrapperDocument } from "../published-pages-render.ts";
import type { RequestAuth } from "../request-auth.ts";
import {
  PAGE_ACCESS,
  PAGE_FRAME_PREFIX,
  PAGE_PREVIEW_FRAME_PREFIX,
  PAGE_PREVIEW_PREFIX,
  PAGE_VIEW_PREFIX,
  pageCsp,
  validExpiry,
  type PageAccess,
} from "../../shared/published-pages.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Who is reading: null for nobody signed in. `principalId` is the person
 * on an organization server; `computerOwner` is the owner of a one-person
 * server (its other paired sessions are not). */
export type PageViewer = { principalId?: string; computerOwner: boolean } | null;

/** Whether this reader may read this page. Pure. */
export function pageReadable(page: Pick<PageRecord, "access" | "ownerId">, viewer: PageViewer): boolean {
  if (page.access === "link") return true;
  if (!viewer) return false;
  if (page.access === "org") return true;
  if (page.ownerId === undefined) return viewer.computerOwner;
  return (viewer.principalId ?? "").toLowerCase() === page.ownerId.toLowerCase();
}

/** Whether this reader is the page's own person (the preview). Pure. */
export function pageOwnedBy(page: Pick<PageRecord, "ownerId">, viewer: PageViewer): boolean {
  return pageReadable({ access: "private", ownerId: page.ownerId }, viewer);
}

/** A viewer as a frame ticket carries it, and back. Pure. */
export function viewerKey(viewer: PageViewer): string {
  if (!viewer) return "anon";
  if (viewer.principalId) return `p:${viewer.principalId.toLowerCase()}`;
  return viewer.computerOwner ? "owner" : "member";
}
export function viewerFromKey(key: string): PageViewer {
  if (key === "owner") return { computerOwner: true };
  if (key === "member") return { computerOwner: false };
  if (key.startsWith("p:") && key.length > 2) return { principalId: key.slice(2), computerOwner: false };
  return null;
}

export interface PublicPageOptions {
  pages: PublishedPages | null;
  viewer(req: IncomingMessage): PageViewer;
  /** The banner's names: the bot, and the person it published for. */
  names(page: PageRecord): { botName: string; personName: string };
  /** False when the page's person was disabled or deleted: nothing of theirs
   * is served. Absent: always active. */
  ownerActive?(page: PageRecord): boolean;
  /** Whether a viewer a ticket carries is still a person allowed in (not
   * disabled), for frames on the separate origin, which see no cookie. */
  viewerActive?(viewer: PageViewer): boolean;
  /** The host of SAGAX_PAGES_ORIGIN when it is set, used or not: that host
   * never serves the app. */
  pagesHost?: string | null;
  /** This app's public origin when it is known (organization public origin
   * or custom domain): the wrapper's frame-src names it, with its scheme,
   * whenever the request came in on that host. */
  appOrigin?: URL | null;
  /** SAGAX_PAGES_ORIGIN and this app's own origin (the frames' only
   * ancestor), when both are known: frames are then served there only. */
  separate?: { pagesOrigin: URL; appOrigin: URL } | null;
}

const NOT_FOUND_HTML = (language: "fr" | "en") => language === "fr"
  ? "<!doctype html><meta charset=\"utf-8\"><title>Page introuvable</title><p>Cette page n'existe pas, n'est plus publiée ou vous n'y avez pas accès. Si elle vous a été partagée, connectez-vous à Sagax dans ce navigateur, puis rouvrez le lien.</p>"
  : "<!doctype html><meta charset=\"utf-8\"><title>Page not found</title><p>This page does not exist, is no longer published, or you cannot see it. If it was shared with you, sign in to Sagax in this browser, then open the link again.</p>";

function language(req: IncomingMessage): "fr" | "en" {
  const header = typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : "";
  return /^\s*fr\b/i.test(header) ? "fr" : "en";
}

function hostOf(req: IncomingMessage): string | null {
  const host = typeof req.headers.host === "string" ? req.headers.host.trim().toLowerCase() : "";
  return /^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/.test(host) ? host : null;
}

function common(res: ServerResponse): void {
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=()");
}

function notFound(req: IncomingMessage, res: ServerResponse, method: string): true {
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox", "x-frame-options": "DENY" });
  res.end(method === "HEAD" ? undefined : NOT_FOUND_HTML(language(req)));
  return true;
}

function tokenAfter(path: string, prefix: string): string {
  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return "";
  }
}

function query(req: IncomingMessage, name: string): string {
  try {
    return new URL(req.url ?? "/", "http://x").searchParams.get(name) ?? "";
  } catch {
    return "";
  }
}

const ownerActive = (options: PublicPageOptions, page: PageRecord) => options.ownerActive?.(page) ?? true;

/** A preview address: `<pageId>/<n>`. */
function previewTarget(options: PublicPageOptions, rest: string): { page: PageRecord; version: PageVersionRecord } | null {
  const match = /^([A-Za-z0-9_-]{8,40})\/(\d{1,4})$/.exec(rest);
  if (!match || !options.pages) return null;
  const page = options.pages.get(match[1]!);
  const version = page?.versions.find((entry) => entry.n === Number(match[2]));
  return page && version ? { page, version } : null;
}

/** The wrapper: banner, then the page in its sandboxed frame. `preview` is
 * the app's own preview of a version (its person only; framed by the app). */
function sendWrapper(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, method: string,
  input: { page: PageRecord; version: PageVersionRecord; framePath: string; ticket: string; preview: boolean }): true {
  const separate = options.separate ?? null;
  const host = hostOf(req);
  // A host-source with a path: the frame may load this page's frame path and
  // nothing else, so the page cannot navigate its frame to another site.
  const known = options.appOrigin && host === options.appOrigin.host.toLowerCase() ? options.appOrigin.origin : null;
  const frameSource = separate
    ? `${separate.pagesOrigin.origin}${input.framePath}`
    : known ? `${known}${input.framePath}` : host ? `${host}${input.framePath}` : "'self'";
  const csp = [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    `frame-src ${frameSource}`,
    `child-src ${frameSource}`,
    "base-uri 'none'",
    "form-action 'none'",
    input.preview ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
  ].join("; ");
  if (!input.preview) res.setHeader("cross-origin-opener-policy", "same-origin");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp, "x-frame-options": input.preview ? "SAMEORIGIN" : "DENY" });
  const names = options.names(input.page);
  res.end(method === "HEAD" ? undefined : wrapperDocument({
    title: input.version.title,
    kind: input.version.kind,
    botName: names.botName,
    personName: names.personName,
    frameUrl: `${separate ? separate.pagesOrigin.origin : ""}${input.framePath}?t=${encodeURIComponent(input.ticket)}`,
    lang: language(req),
    preview: input.preview,
  }));
  return true;
}

function serveWrapper(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): true {
  const token = tokenAfter(path, PAGE_VIEW_PREFIX);
  const opened = token && options.pages ? options.pages.open(token) : null;
  const viewer = options.viewer(req);
  if (!opened || !ownerActive(options, opened.page) || !pageReadable(opened.page, viewer)) return notFound(req, res, method);
  const subject = `link:${opened.page.linkId!}`;
  return sendWrapper(options, req, res, method, { ...opened, framePath: `${PAGE_FRAME_PREFIX}${token}`, ticket: options.pages!.frameTicket(subject, viewerKey(viewer)), preview: false });
}

function servePreviewWrapper(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): true {
  const rest = tokenAfter(path, PAGE_PREVIEW_PREFIX);
  const target = previewTarget(options, rest);
  const viewer = options.viewer(req);
  if (!target || !ownerActive(options, target.page) || !pageOwnedBy(target.page, viewer)) return notFound(req, res, method);
  const subject = `preview:${target.page.id}:${target.version.n}`;
  return sendWrapper(options, req, res, method, { ...target, framePath: `${PAGE_PREVIEW_FRAME_PREFIX}${rest}`, ticket: options.pages!.frameTicket(subject, viewerKey(viewer)), preview: true });
}

/** The page itself. Never the main entry; the ticket the wrapper minted for
 * this page and this reader; and the reader checked again: the live cookie
 * on the app's origin, or the ticket's reader (still active) on the
 * separate origin, which sees no cookie. */
function serveFrame(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): true {
  const dest = req.headers["sec-fetch-dest"];
  if (typeof dest === "string" && dest !== "iframe") return notFound(req, res, method);
  const pages = options.pages;
  if (!pages) return notFound(req, res, method);
  const preview = path.startsWith(PAGE_PREVIEW_FRAME_PREFIX);
  let target: { page: PageRecord; version: PageVersionRecord } | null;
  let subject: string;
  if (preview) {
    target = previewTarget(options, tokenAfter(path, PAGE_PREVIEW_FRAME_PREFIX));
    subject = target ? `preview:${target.page.id}:${target.version.n}` : "";
  } else {
    target = pages.open(tokenAfter(path, PAGE_FRAME_PREFIX));
    subject = target ? `link:${target.page.linkId!}` : "";
  }
  const bound = target ? pages.verifyFrameTicket(subject, query(req, "t")) : null;
  if (!target || bound === null || !ownerActive(options, target.page)) return notFound(req, res, method);
  const reader = options.separate ? viewerFromKey(bound) : options.viewer(req);
  if (options.separate && reader && options.viewerActive && !options.viewerActive(reader)) return notFound(req, res, method);
  const allowed = preview ? pageOwnedBy(target.page, reader) : pageReadable(target.page, reader);
  const content = allowed ? pages.content(target.page.id, target.version.n) : null;
  if (content === null) return notFound(req, res, method);
  const ancestors = options.separate ? options.separate.appOrigin.origin : "'self'";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(target.version.kind, { frameAncestors: ancestors }) });
  res.end(method === "HEAD" ? undefined : pageDocument({ kind: target.version.kind, title: target.version.title, content, lang: language(req) }));
  return true;
}

function refuseMethod(res: ServerResponse): true {
  res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8", "content-security-policy": "default-src 'none'; sandbox" });
  res.end();
  return true;
}

const isFramePath = (path: string) => path.startsWith(PAGE_FRAME_PREFIX) || path.startsWith(PAGE_PREVIEW_FRAME_PREFIX);

/** On the pages origin (SAGAX_PAGES_ORIGIN), the server answers the page
 * frames and nothing else: no app, no API, no sign-in. When the app's own
 * origin is unknown the separation is off and that host answers nothing at
 * all. True when the request was for that host (it is then answered). */
export function handlePagesOriginRequest(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): boolean {
  const pagesHost = (options.separate?.pagesOrigin.host ?? options.pagesHost ?? "").toLowerCase();
  if (!pagesHost || hostOf(req) !== pagesHost) return false;
  common(res);
  if (method !== "GET" && method !== "HEAD") return refuseMethod(res);
  if (!options.separate || !isFramePath(path)) return notFound(req, res, method);
  return serveFrame(options, req, res, path, method);
}

/** Answer a published page's wrapper, preview or frame on the app's origin;
 * false when the request is not one. */
export function handlePublishedPagePublic(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): boolean {
  const view = path.startsWith(PAGE_VIEW_PREFIX);
  const previewWrapper = path.startsWith(PAGE_PREVIEW_PREFIX);
  const frame = isFramePath(path);
  if (!view && !previewWrapper && !frame) return false;
  common(res);
  if (method !== "GET" && method !== "HEAD") return refuseMethod(res);
  if (view) return serveWrapper(options, req, res, path, method);
  if (previewWrapper) return servePreviewWrapper(options, req, res, path, method);
  // With a separate pages origin, frames live there only.
  if (options.separate) return notFound(req, res, method);
  return serveFrame(options, req, res, path, method);
}

export interface PublishedPageRouteDeps {
  pages: PublishedPages;
  /** The person's principal id on an organization server; undefined for the
   * owner of a one-person server (who manages every page). */
  owner(auth: RequestAuth): string | undefined;
  /** False for a caller that is no person: a bot's shell on a shared
   * server, or on a one-person server a paired session that is not the
   * computer's owner (computerOwner in server/index.ts). */
  isPerson(auth: RequestAuth): boolean;
  /** Where links point: the server's public address, else the request's. */
  origin(req: IncomingMessage): string;
  reachable(origin: string): boolean;
  /** An organization admin (the admin routes below). */
  isAdmin?(auth: RequestAuth): boolean;
  /** Write an admin activity row (category security) for an admin's act. */
  audit?(auth: RequestAuth, req: IncomingMessage, row: { action: string; target: { kind: string; id: string; name?: string } }): void;
  now?(): number;
}

function failed(result: unknown): result is PageError {
  return Boolean(result) && typeof result === "object" && (result as { ok?: unknown }).ok === false;
}

export function createPublishedPageRoutes(deps: PublishedPageRouteDeps): RouteHandler {
  const now = () => deps.now?.() ?? Date.now();
  const mine = (auth: RequestAuth, page: PageRecord) => {
    const owner = deps.owner(auth);
    return owner === undefined || (page.ownerId ?? "").toLowerCase() === owner.toLowerCase();
  };
  const wire = (page: PageRecord, req: IncomingMessage) => {
    const origin = deps.origin(req);
    return deps.pages.summary(page, origin, deps.reachable(origin));
  };
  // An admin's view of a page: never its link or path (they carry the token).
  const adminWire = (page: PageRecord, req: IncomingMessage) => {
    const { url: _url, path: _path, reachable: _reachable, ...rest } = wire(page, req);
    return { ...rest, ownerId: page.ownerId ?? null };
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    // Organization admins: every page, and Revoke (audited). Never publish,
    // change access or read another person's content from here.
    if (path === "/api/admin/pages" || path.startsWith("/api/admin/pages/")) {
      res.setHeader("cache-control", "no-store");
      if (!deps.isAdmin?.(auth)) return json(res, 403, { error: "Only an organization admin manages every page.", code: "admin_only" });
      if (path === "/api/admin/pages" && method === "GET") {
        return json(res, 200, { pages: deps.pages.list(undefined).map((page) => adminWire(page, req)) });
      }
      const revoke = /^\/api\/admin\/pages\/([\w-]+)\/revoke$/.exec(path);
      if (revoke && method === "POST") {
        const page = deps.pages.get(revoke[1]!);
        if (!page) return json(res, 404, { error: "This page does not exist.", code: "not_found" });
        const result = deps.pages.revoke(page.id, deps.owner(auth) ?? "admin");
        if (failed(result)) return json(res, result.status, { error: result.error, code: result.code });
        const title = result.versions.at(-1)?.title;
        deps.audit?.(auth, req, { action: "page.revoke", target: { kind: "page", id: page.id, ...(title ? { name: title } : {}) } });
        return json(res, 200, { page: adminWire(result, req) });
      }
      return PASS;
    }
    if (path !== "/api/pages" && !path.startsWith("/api/pages/")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!deps.isPerson(auth)) return json(res, 403, { error: "Only a signed-in person manages published pages.", code: "person_only" });
    if (path === "/api/pages" && method === "GET") {
      return json(res, 200, { pages: deps.pages.list(deps.owner(auth)).map((page) => wire(page, req)) });
    }
    const match = /^\/api\/pages\/([\w-]+)(?:\/(publish|decline|revoke)|\/versions\/(\d+))?$/.exec(path);
    if (!match) return PASS;
    const page = deps.pages.get(match[1]!);
    // Another person's page reads exactly like a missing one.
    if (!page || !mine(auth, page)) return json(res, 404, { error: "This page does not exist.", code: "not_found" });
    const action = match[2];
    const versionPath = match[3];
    const answer = (result: PageRecord | PageError) => failed(result)
      ? json(res, result.status, { error: result.error, code: result.code })
      : json(res, 200, { page: wire(result, req) });

    if (versionPath !== undefined && method === "GET") {
      const version = page.versions.find((entry) => entry.n === Number(versionPath));
      if (!version) return json(res, 404, { error: "This version does not exist.", code: "no_version" });
      // Never the content: the app previews a version through the same
      // wrapper and sandboxed frame readers get (no srcdoc in the app).
      return json(res, 200, { version: { n: version.n, kind: version.kind, title: version.title, state: version.state, previewPath: `${PAGE_PREVIEW_PREFIX}${page.id}/${version.n}` } });
    }
    if (!action && method === "GET") return json(res, 200, { page: wire(page, req) });
    if (!action && method === "DELETE") {
      deps.pages.remove(page.id);
      return json(res, 200, { ok: true });
    }
    const by = deps.owner(auth);
    if (!action && method === "PATCH") {
      const body = await readBody(req) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return json(res, 400, { error: "Send { access?, expiresAt? }.", code: "bad_body" });
      const access = body.access;
      if (access !== undefined && !PAGE_ACCESS.includes(access as PageAccess)) return json(res, 400, { error: "access: private, org or link.", code: "bad_access" });
      let expiresAt: number | null | undefined;
      if ("expiresAt" in body) {
        const checked = validExpiry(body.expiresAt, now());
        if (!checked.ok) return json(res, 400, { error: "expiresAt: a future time within a year, or null.", code: "bad_expiry" });
        expiresAt = checked.value;
      }
      return answer(deps.pages.update(page.id, { ...(access !== undefined ? { access: access as PageAccess } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}), ...(by ? { by } : {}) }));
    }
    if (method !== "POST") return PASS;
    if (action === "revoke") return answer(deps.pages.revoke(page.id, by));
    const body = await readBody(req) as Record<string, unknown> | null;
    const version = body && typeof body === "object" ? body.version : undefined;
    if (typeof version !== "number" || !Number.isSafeInteger(version)) return json(res, 400, { error: "version: the version number to act on.", code: "bad_version" });
    if (action === "decline") return answer(deps.pages.decline(page.id, version, by));
    // publish: who may see it is the person's choice, never a default the bot set
    const access = body!.access;
    if (!PAGE_ACCESS.includes(access as PageAccess)) return json(res, 400, { error: "access: choose private, org or link.", code: "bad_access" });
    const expiry = validExpiry(body!.expiresAt, now());
    if (!expiry.ok) return json(res, 400, { error: "expiresAt: a future time within a year, or null.", code: "bad_expiry" });
    return answer(deps.pages.publish(page.id, { version, access: access as PageAccess, expiresAt: expiry.value, ...(by ? { by } : {}) }));
  };
}
