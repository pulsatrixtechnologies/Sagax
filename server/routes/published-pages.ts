// Published pages (server/published-pages.ts, shared/published-pages.ts).
//
// Before the auth gate (handlePublishedPagePublic, server/index.ts):
//   GET /pages/view/<token>   the published version, sandboxed:
//     `Content-Security-Policy: sandbox ...` without allow-same-origin (an
//     opaque origin, even opened in a tab), no network (connect-src 'none',
//     default-src 'none'), no framing, no-store, no Set-Cookie.
//   Who may read it: "link" anyone holding the link; "org" a signed-in
//   person of this server (or this computer's owner on a one-person
//   server); "private" only the page's person. A bad signature, a revoked
//   link, an expired page and a reader who may not see it all answer the
//   same 404.
//
// Behind the gate, a person's own pages only (never another's, never a
// bot's shell on a shared server):
//   GET    /api/pages                       { pages: [...] }
//   GET    /api/pages/:id                   { page }
//   GET    /api/pages/:id/versions/:n       { version: { n, kind, title, html } }
//          html carries the CSP as a meta tag, for the app's sandboxed preview
//   POST   /api/pages/:id/publish           { version, access, expiresAt|null }
//          the person's approval: the only way a version is published
//   POST   /api/pages/:id/decline           { version }
//   PATCH  /api/pages/:id                   { access?, expiresAt? } while published
//   POST   /api/pages/:id/revoke            stop serving now; the link is gone
//   DELETE /api/pages/:id
import type { IncomingMessage, ServerResponse } from "node:http";

import type { PageError, PageRecord, PublishedPages } from "../published-pages.ts";
import { pageDocument } from "../published-pages-render.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PAGE_ACCESS, PAGE_VIEW_PREFIX, pageCsp, validExpiry, type PageAccess } from "../../shared/published-pages.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Who is reading: null for nobody signed in. `principalId` is absent on a
 * one-person server, whose every session is its owner's. */
export type PageViewer = { principalId?: string } | null;

/** Whether this reader may read this page. Pure. */
export function pageReadable(page: Pick<PageRecord, "access" | "ownerId">, viewer: PageViewer): boolean {
  if (page.access === "link") return true;
  if (!viewer) return false;
  if (page.access === "org") return true;
  if (page.ownerId === undefined) return viewer.principalId === undefined;
  return (viewer.principalId ?? "").toLowerCase() === page.ownerId.toLowerCase();
}

const NOT_FOUND_HTML = (language: "fr" | "en") => language === "fr"
  ? "<!doctype html><meta charset=\"utf-8\"><title>Page introuvable</title><p>Cette page n'existe pas, n'est plus publiée ou vous n'y avez pas accès. Si elle vous a été partagée, connectez-vous à Sagax dans ce navigateur, puis rouvrez le lien.</p>"
  : "<!doctype html><meta charset=\"utf-8\"><title>Page not found</title><p>This page does not exist, is no longer published, or you cannot see it. If it was shared with you, sign in to Sagax in this browser, then open the link again.</p>";

function language(req: IncomingMessage): "fr" | "en" {
  const header = typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : "";
  return /^\s*fr\b/i.test(header) ? "fr" : "en";
}

/** Answer a published page's reading link; false when the request is not one. */
export function handlePublishedPagePublic(
  pages: PublishedPages | null,
  viewer: (req: IncomingMessage) => PageViewer,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): boolean {
  if (!path.startsWith(PAGE_VIEW_PREFIX)) return false;
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=()");
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8", "content-security-policy": "default-src 'none'; sandbox" });
    res.end();
    return true;
  }
  let token = "";
  try {
    token = decodeURIComponent(path.slice(PAGE_VIEW_PREFIX.length));
  } catch {
    token = "";
  }
  const opened = token ? pages?.open(token) ?? null : null;
  if (!opened || !pageReadable(opened.page, viewer(req))) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox" });
    res.end(method === "HEAD" ? undefined : NOT_FOUND_HTML(language(req)));
    return true;
  }
  const { version } = opened;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(version.kind) });
  res.end(method === "HEAD" ? undefined : pageDocument({ kind: version.kind, title: version.title, content: version.content, lang: language(req) }));
  return true;
}

export interface PublishedPageRouteDeps {
  pages: PublishedPages;
  /** The person's principal id on an organization server; undefined for the
   * owner of a one-person server (who manages every page). */
  owner(auth: RequestAuth): string | undefined;
  /** False for a caller that is no person (a bot's shell on a shared server). */
  isPerson(auth: RequestAuth): boolean;
  /** Where links point: the server's public address, else the request's. */
  origin(req: IncomingMessage): string;
  reachable(origin: string): boolean;
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
  return async ({ req, res, path, method, auth, json, readBody }) => {
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
      return json(res, 200, { version: { n: version.n, kind: version.kind, title: version.title, state: version.state, html: pageDocument(version, { meta: true }) } });
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
