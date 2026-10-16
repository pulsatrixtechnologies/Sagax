// Published pages (server/published-pages.ts, server/routes/published-pages.ts,
// server/published-pages-render.ts): approval before anything is served,
// ownership by the conversation's person, the wrapper and its sandboxed
// frame, each access level, revocation, expiry, versions, caps and storage,
// the separate pages origin, and a person's own pages only.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentCard, type AgentCardStore } from "./chat-widgets.ts";
import { json, readBody } from "./harness/http.ts";
import { pageOwnerFor, PublishedPages } from "./published-pages.ts";
import { bannerName, escapeHtml, FRAME_PRELUDE, markdownToHtml, pageDocument, wrapperBanner } from "./published-pages-render.ts";
import type { RequestAuth } from "./request-auth.ts";
import {
  createPublishedPageRoutes,
  handlePagesOriginRequest,
  handlePublishedPagePublic,
  pageReadable,
  type PageViewer,
  type PublicPageOptions,
} from "./routes/published-pages.ts";
import type { Message } from "./store.ts";
import { PAGE_LIMITS, pageCsp, pageFrameSandbox, parsePageProposal, validExpiry } from "../shared/published-pages.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let now = 1_800_000_000_000;
function store(): { pages: PublishedPages; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sagax-pages-"));
  dirs.push(dir);
  return { pages: new PublishedPages(dir, () => now), dir };
}

const HTML = "<!doctype html><html><body><h1>Rapport</h1><script>document.title='x'</script></body></html>";
const OWNER: PageViewer = { computerOwner: true };

function proposed(pages: PublishedPages, ownerId?: string, extra: { botId?: string; content?: string } = {}) {
  const result = pages.propose({ botId: extra.botId ?? "bot1", threadId: "t1", title: "Rapport", kind: "html", content: extra.content ?? HTML, ...(ownerId ? { ownerId } : {}) });
  if (!result.ok) throw new Error(result.error);
  return result;
}

type Answer = { status: number; headers: Record<string, unknown>; body: string };
function request(path: string, method = "GET", headers: Record<string, string> = {}): { req: IncomingMessage; res: ServerResponse; done: Promise<Answer> } {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = path;
  req.headers = headers;
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  let resolve!: (value: Answer) => void;
  const done = new Promise<Answer>((r) => { resolve = r; });
  res.write = ((chunk: unknown) => { if (chunk) chunks.push(Buffer.from(chunk as string)); return true; }) as typeof res.write;
  res.end = ((chunk?: unknown) => {
    if (chunk) chunks.push(Buffer.from(chunk as string));
    resolve({ status: res.statusCode, headers: res.getHeaders(), body: Buffer.concat(chunks).toString("utf8") });
    return res;
  }) as typeof res.end;
  return { req, res, done };
}

function options(pages: PublishedPages, viewer: PageViewer, separate: PublicPageOptions["separate"] = null): PublicPageOptions {
  return { pages, viewer: () => viewer, names: () => ({ botName: "Scout", personName: "Alice" }), separate };
}

async function hit(opts: PublicPageOptions, url: string, headers: Record<string, string> = {}, method = "GET"): Promise<Answer> {
  const path = new URL(url, "http://x").pathname;
  const { req, res, done } = request(url, method, { host: "sagax.example.com", "accept-language": "fr-CA", ...headers });
  const answered = handlePagesOriginRequest(opts, req, res, path, method) || handlePublishedPagePublic(opts, req, res, path, method);
  expect(answered).toBe(true);
  return done;
}

function frameSrc(wrapper: string): string {
  const src = /<iframe src="([^"]+)"/.exec(wrapper)?.[1];
  if (!src) throw new Error("no frame in the wrapper");
  return src.replace(/&amp;/g, "&");
}

/** The wrapper, then the frame it embeds, as a browser would load them. */
async function read(pages: PublishedPages, path: string, viewer: PageViewer): Promise<{ wrapper: Answer; frame?: Answer }> {
  const wrapper = await hit(options(pages, viewer), path);
  if (wrapper.status !== 200) return { wrapper };
  return { wrapper, frame: await hit(options(pages, viewer), frameSrc(wrapper.body), { "sec-fetch-dest": "iframe" }) };
}

const session = (principalId?: string): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: { id: "s1", ...(principalId ? { principalId } : {}) } as never,
});
const serviceLoopback: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };

/** organization: the person is the session's principal; a one-person
 * server: only the computer's owner (here, a session without principal). */
function routes(pages: PublishedPages, organization = true) {
  return createPublishedPageRoutes({
    pages,
    owner: (auth) => organization && auth.kind === "session" ? auth.session.principalId : undefined,
    isPerson: (auth) => organization
      ? auth.kind === "session" && Boolean(auth.session.principalId)
      : auth.kind === "session" ? !auth.session.principalId : auth.trust !== "service",
    origin: () => "https://sagax.example.com",
    reachable: () => true,
    now: () => now,
  });
}

async function call(handler: ReturnType<typeof routes>, auth: RequestAuth, method: string, path: string, body?: unknown) {
  const { req, res, done } = request(path, method, { "content-type": "application/json" });
  process.nextTick(() => {
    if (body !== undefined) req.push(JSON.stringify(body));
    req.push(null);
  });
  await handler({ req, res, url: new URL(`http://x${path}`), path, method, auth, json, readBody });
  const answer = await done;
  return { status: answer.status, body: answer.body ? JSON.parse(answer.body) as Record<string, any> : null };
}

function published(pages: PublishedPages, access: "private" | "org" | "link" = "link", ownerId?: string) {
  const { page } = proposed(pages, ownerId);
  pages.publish(page.id, { version: 1, access, expiresAt: null });
  return { id: page.id, path: pages.path(pages.get(page.id)!.linkId!) };
}

describe("approval before anything is served", () => {
  it("a proposal is stored as a draft with no reading link; nothing serves it", () => {
    const { pages, dir } = store();
    const { page, version } = proposed(pages);
    expect(page.status).toBe("draft");
    expect(version.state).toBe("proposed");
    expect(page.linkId).toBeUndefined();
    expect(pages.summary(page, "https://x", true).url).toBeUndefined();
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "published-pages.key")).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "published-pages.json")).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "published-pages", page.id, "1")).mode & 0o777).toBe(0o600);
    }
  });

  it("the bot's card route writes a proposal row and never publishes", () => {
    const { pages } = store();
    const messages: Message[] = [];
    const cardStore: AgentCardStore = {
      groupByThread: () => null,
      messagesFor: () => messages,
      appendMessage: (_threadId, message) => {
        const full = { ...message, id: `m${messages.length + 1}`, at: now } as Message;
        messages.push(full);
        return full;
      },
      patchMessage: () => null,
    };
    const result = createAgentCard({
      store: cardStore,
      bot: { id: "bot1", name: "Scout", color: "blue" as never },
      threadId: "t1",
      input: { tool: "propose_page", title: "Rapport", kind: "html", content: HTML, access: "link", publish: true },
      proposePage: (input) => {
        const made = pages.propose({ ...input, botId: "bot1", threadId: "t1" });
        return made.ok ? { ok: true, pageId: made.page.id, version: made.version.n } : made;
      },
    });
    expect(result.ok).toBe(true);
    const row = messages[0]!;
    expect(row.pagePublish).toMatchObject({ version: 1, title: "Rapport" });
    const page = pages.get(row.pagePublish!.pageId)!;
    // whatever the bot sent (access, publish), the page waits for the person
    expect(page.status).toBe("draft");
    expect(page.access).toBe("private");
    expect(page.linkId).toBeUndefined();
  });

  it("the card route refuses in a room and when the server has no pages", () => {
    const base: AgentCardStore = { groupByThread: () => ({}), messagesFor: () => [], appendMessage: () => { throw new Error("no write"); }, patchMessage: () => null };
    const input = { tool: "propose_page", title: "Rapport", kind: "html", content: HTML };
    const bot = { id: "bot1", name: "Scout", color: "blue" as never };
    expect(createAgentCard({ store: base, bot, threadId: "t1", input, proposePage: () => ({ ok: true, pageId: "x", version: 1 }) })).toMatchObject({ ok: false, status: 409 });
    expect(createAgentCard({ store: { ...base, groupByThread: () => null }, bot, threadId: "t1", input })).toMatchObject({ ok: false, status: 403 });
  });

  it("a bot's shell on a shared server and another person cannot publish", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const body = { version: 1, access: "link", expiresAt: null };
    expect((await call(handler, serviceLoopback, "POST", `/api/pages/${page.id}/publish`, body)).status).toBe(403);
    expect((await call(handler, session(), "POST", `/api/pages/${page.id}/publish`, body)).status).toBe(403);
    expect((await call(handler, session("pr_bob"), "POST", `/api/pages/${page.id}/publish`, body)).status).toBe(404);
    expect((await call(handler, session("pr_bob"), "GET", "/api/pages")).body!.pages).toEqual([]);
    expect(pages.get(page.id)!.status).toBe("draft");
    const ok = await call(handler, session("pr_alice"), "POST", `/api/pages/${page.id}/publish`, body);
    expect(ok.status).toBe(200);
    expect(ok.body!.page).toMatchObject({ status: "published", access: "link", currentVersion: 1 });
    expect(ok.body!.page.url).toMatch(/^https:\/\/sagax\.example\.com\/pages\/view\//);
  });

  it("publish needs an explicit access and a valid expiry; a declined version never publishes", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const alice = session("pr_alice");
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1 })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "everyone" })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "org", expiresAt: now - 1 })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/decline`, { version: 1 })).status).toBe(200);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "org", expiresAt: null })).status).toBe(409);
  });
});

describe("ownership: the conversation's person, not the bot's owner", () => {
  it("a member's private thread with someone else's team bot gives the member the page", async () => {
    const { pages } = store();
    // the thread records the member; the bot belongs to its owner
    const ownerId = pageOwnerFor({ ownerPrincipalId: "pr_member" }, "pr_botowner");
    expect(ownerId).toBe("pr_member");
    const { page } = proposed(pages, ownerId);
    const handler = routes(pages);
    // the bot owner neither sees nor publishes it
    expect((await call(handler, session("pr_botowner"), "GET", "/api/pages")).body!.pages).toEqual([]);
    expect((await call(handler, session("pr_botowner"), "GET", `/api/pages/${page.id}`)).status).toBe(404);
    expect((await call(handler, session("pr_botowner"), "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "private", expiresAt: null })).status).toBe(404);
    // the member does
    expect((await call(handler, session("pr_member"), "GET", "/api/pages")).body!.pages.map((entry: { id: string }) => entry.id)).toEqual([page.id]);
    const ok = await call(handler, session("pr_member"), "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "private", expiresAt: null });
    expect(ok.status).toBe(200);
    // and only the member reads it
    const path = ok.body!.page.path as string;
    expect((await read(pages, path, { principalId: "pr_botowner", computerOwner: false })).wrapper.status).toBe(404);
    expect((await read(pages, path, { principalId: "pr_member", computerOwner: false })).frame?.status).toBe(200);
  });

  it("a thread with no recorded owner (older, webhook) falls back to the bot owner", () => {
    expect(pageOwnerFor(undefined, "pr_botowner")).toBe("pr_botowner");
    expect(pageOwnerFor({}, "PR_BotOwner")).toBe("pr_botowner");
  });

  it("on a one-person server only the computer's owner manages and reads private pages", async () => {
    const { pages } = store();
    const { page } = proposed(pages);
    const handler = routes(pages, false);
    // a paired session that is not the computer's owner
    expect((await call(handler, session("pr_guest"), "GET", "/api/pages")).status).toBe(403);
    expect((await call(handler, session("pr_guest"), "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null })).status).toBe(403);
    expect((await call(handler, session(), "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "private", expiresAt: null })).status).toBe(200);
    const path = pages.path(pages.get(page.id)!.linkId!);
    expect((await read(pages, path, { computerOwner: false })).wrapper.status).toBe(404);
    expect((await read(pages, path, OWNER)).frame?.status).toBe(200);
  });
});

describe("wrapper and sandboxed frame", () => {
  it("the reader gets a Sagax wrapper with a permanent banner and the page in a scripts-only frame", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const { wrapper, frame } = await read(pages, path, null);
    expect(wrapper.status).toBe(200);
    expect(wrapper.body).toContain(escapeHtml(wrapperBanner({ botName: "Scout", personName: "Alice", lang: "fr" })));
    expect(wrapper.body).toContain("jamais de mot de passe");
    expect(wrapper.body).not.toContain("<script");
    expect(wrapper.body).toMatch(/<iframe src="\/pages\/frame\/[^"]+\?t=[^"]+" sandbox="allow-scripts"/);
    const csp = String(wrapper.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // the frame may load this page's frame path and nothing else
    const token = path.slice("/pages/view/".length);
    expect(csp).toContain(`frame-src sagax.example.com/pages/frame/${token};`);
    expect(csp).not.toMatch(/frame-src[^;]*('self'|\*|https:)/);
    expect(wrapper.headers["x-frame-options"]).toBe("DENY");
    expect(wrapper.headers["set-cookie"]).toBeUndefined();
    expect(frame!.status).toBe(200);
    expect(frame!.body).toContain("<h1>Rapport</h1>");
    // the prelude runs first: WebRTC and resource hints removed
    expect(frame!.body.indexOf(FRAME_PRELUDE)).toBe("<!doctype html>".length);
  });

  it("the page itself: sandbox without same-origin, top navigation, popups, modals or forms; no network", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const { frame } = await read(pages, path, null);
    const csp = String(frame!.headers["content-security-policy"]);
    expect(csp).toMatch(/; sandbox allow-scripts$/);
    for (const flag of ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-modals", "allow-forms"]) expect(csp).not.toContain(flag);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(frame!.headers["set-cookie"]).toBeUndefined();
    expect(frame!.headers["cache-control"]).toBe("no-store");
    expect(frame!.headers["referrer-policy"]).toBe("no-referrer");
    expect(frame!.headers["x-content-type-options"]).toBe("nosniff");
    for (const kind of ["html", "markdown"] as const) {
      for (const flag of ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-modals", "allow-forms"]) expect(pageFrameSandbox(kind)).not.toContain(flag);
    }
  });

  it("the frame is never the main entry: no ticket, a forged or expired ticket, or a top-level load is a 404", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const { wrapper } = await read(pages, path, null);
    const src = frameSrc(wrapper.body);
    const bare = src.split("?")[0]!;
    expect((await hit(options(pages, null), bare, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, null), `${bare}?t=${now + 1000}.${"A".repeat(32)}`, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, null), src, { "sec-fetch-dest": "document" })).status).toBe(404);
    expect((await hit(options(pages, null), src, { "sec-fetch-dest": "iframe" })).status).toBe(200);
    const before = now;
    now += 6 * 60 * 1000;
    try {
      expect((await hit(options(pages, null), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    } finally {
      now = before;
    }
  });

  it("Markdown runs no script, escapes raw HTML and writes links as text", () => {
    expect(pageCsp("markdown")).toContain("script-src 'none'");
    expect(pageCsp("markdown")).toMatch(/; sandbox$/);
    const html = markdownToHtml("# Titre\n\n<script>alert(1)</script> **gras** [lien](javascript:alert(1)) [ok](https://example.com)\n\n- a\n- b\n\n```\n<b>x</b>\n```");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<a ");
    expect(html).toContain("ok (<span class=\"url\">https://example.com</span>)");
    expect(html).toContain("[lien](javascript:alert(1))");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>");
  });

  it("an HTML page starts with the prelude; Markdown has no script at all", () => {
    expect(pageDocument({ kind: "html", title: "R", content: HTML }).startsWith(`<!doctype html>${FRAME_PRELUDE}`)).toBe(true);
    expect(pageDocument({ kind: "html", title: "R", content: "<p>x</p>" }).startsWith(FRAME_PRELUDE)).toBe(true);
    expect(pageDocument({ kind: "markdown", title: "R", content: "# x" })).not.toContain("<script");
  });

  it("the banner keeps names to one short line", () => {
    expect(bannerName("  Scout\n the   bot ")).toBe("Scout the bot");
    const long = bannerName("x".repeat(200));
    expect(long.length).toBe(60);
    expect(wrapperBanner({ botName: "y".repeat(500), personName: "Alice", lang: "en" }).length).toBeLessThan(200);
  });

  it("only GET and HEAD, and the reading paths never reach the API", async () => {
    const { pages } = store();
    expect((await hit(options(pages, OWNER), "/pages/view/x", {}, "POST")).status).toBe(405);
    const other = request("/api/pages", "GET", { host: "sagax.example.com" });
    expect(handlePublishedPagePublic(options(pages, OWNER), other.req, other.res, "/api/pages", "GET")).toBe(false);
  });
});

describe("separate pages origin (SAGAX_PAGES_ORIGIN)", () => {
  const separate = { pagesOrigin: new URL("https://pages.example.net"), appOrigin: new URL("https://sagax.example.com") };

  it("the wrapper frames the pages origin, which serves the frame only, framed only by the app", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const wrapper = await hit(options(pages, null, separate), path);
    const src = frameSrc(wrapper.body);
    expect(src.startsWith("https://pages.example.net/pages/frame/")).toBe(true);
    expect(String(wrapper.headers["content-security-policy"])).toContain(`frame-src https://pages.example.net${new URL(src).pathname};`);
    const frame = await hit(options(pages, null, separate), `${new URL(src).pathname}${new URL(src).search}`, { host: "pages.example.net", "sec-fetch-dest": "iframe" });
    expect(frame.status).toBe(200);
    expect(String(frame.headers["content-security-policy"])).toContain("frame-ancestors https://sagax.example.com;");
    // the app origin no longer serves frames, and the pages origin serves nothing else
    expect((await hit(options(pages, null, separate), `${new URL(src).pathname}${new URL(src).search}`, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    for (const other of ["/", "/api/pages", "/api/health", path]) {
      const { req, res, done } = request(other, "GET", { host: "pages.example.net" });
      expect(handlePagesOriginRequest(options(pages, OWNER, separate), req, res, new URL(other, "http://x").pathname, "GET")).toBe(true);
      expect((await done).status).toBe(404);
    }
    // a request to the app's host is not the pages origin's
    const app = request("/api/pages", "GET", { host: "sagax.example.com" });
    expect(handlePagesOriginRequest(options(pages, OWNER, separate), app.req, app.res, "/api/pages", "GET")).toBe(false);
  });
});

describe("access levels", () => {
  it("pageReadable: link for anyone, org for any person of the server, private for its person", () => {
    const bob = { principalId: "pr_b", computerOwner: false };
    expect(pageReadable({ access: "link", ownerId: "pr_a" }, null)).toBe(true);
    expect(pageReadable({ access: "org", ownerId: "pr_a" }, null)).toBe(false);
    expect(pageReadable({ access: "org", ownerId: "pr_a" }, bob)).toBe(true);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, bob)).toBe(false);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, { principalId: "PR_A", computerOwner: false })).toBe(true);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, OWNER)).toBe(false);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, null)).toBe(false);
    // a one-person server: its computer's owner, not every paired session
    expect(pageReadable({ access: "private" }, OWNER)).toBe(true);
    expect(pageReadable({ access: "private" }, { computerOwner: false })).toBe(false);
    expect(pageReadable({ access: "org" }, { computerOwner: false })).toBe(true);
  });

  it("each level over the reading link, with the same 404 for a reader who may not see it", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", "pr_alice");
    const made = await hit(options(pages, { principalId: "pr_alice", computerOwner: false }), `/pages/view/${"A".repeat(22)}.${"B".repeat(32)}`);
    const anonymous = (await read(pages, path, null)).wrapper;
    expect(anonymous.status).toBe(404);
    expect(anonymous.body).toBe(made.body);
    expect((await read(pages, path, { principalId: "pr_bob", computerOwner: false })).wrapper.status).toBe(404);
    expect((await read(pages, path, { principalId: "pr_alice", computerOwner: false })).frame?.status).toBe(200);
    pages.update(id, { access: "org" });
    expect((await read(pages, path, null)).wrapper.status).toBe(404);
    expect((await read(pages, path, { principalId: "pr_bob", computerOwner: false })).frame?.status).toBe(200);
    pages.update(id, { access: "link" });
    expect((await read(pages, path, null)).frame?.status).toBe(200);
  });
});

describe("revocation, expiry and versions", () => {
  it("revoking takes the link and its frames down at once, and publishing again mints a new link", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const alice = session("pr_alice");
    const first = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null });
    const oldPath = first.body!.page.path as string;
    const before = await read(pages, oldPath, null);
    expect(before.frame?.status).toBe(200);
    const revoked = await call(handler, alice, "POST", `/api/pages/${page.id}/revoke`);
    expect(revoked.body!.page).toMatchObject({ status: "revoked", currentVersion: null });
    expect(revoked.body!.page.url).toBeUndefined();
    expect((await read(pages, oldPath, null)).wrapper.status).toBe(404);
    // a frame ticket minted before the revocation is dead too
    expect((await hit(options(pages, null), frameSrc(before.wrapper.body), { "sec-fetch-dest": "iframe" })).status).toBe(404);
    const again = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null });
    expect(again.body!.page.path).not.toBe(oldPath);
    expect((await read(pages, oldPath, null)).wrapper.status).toBe(404);
    expect((await read(pages, again.body!.page.path, null)).frame?.status).toBe(200);
    await call(handler, alice, "POST", `/api/pages/${page.id}/revoke`);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { access: "org" })).status).toBe(409);
  });

  it("an expired page is not served and reads as expired to its person", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const alice = session("pr_alice");
    const expiresAt = now + 60 * 60 * 1000;
    const done = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt });
    const path = done.body!.page.path as string;
    expect((await read(pages, path, null)).frame?.status).toBe(200);
    const before = now;
    now = expiresAt;
    try {
      expect((await read(pages, path, null)).wrapper.status).toBe(404);
      expect((await call(handler, alice, "GET", `/api/pages/${page.id}`)).body!.page.expired).toBe(true);
      expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { expiresAt: null })).status).toBe(200);
      expect((await read(pages, path, null)).frame?.status).toBe(200);
    } finally {
      now = before;
    }
  });

  it("a new version waits for its own Publish; readers keep the published one", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "link", "pr_alice");
    const second = pages.propose({ pageId: id, botId: "bot1", threadId: "t1", title: "Rapport v2", kind: "markdown", content: "# v2" });
    expect(second.ok && second.version.n).toBe(2);
    expect((await read(pages, path, null)).frame?.body).toContain("<h1>Rapport</h1>");
    pages.publish(id, { version: 2, access: "link", expiresAt: null });
    expect((await read(pages, path, null)).frame?.body).toContain("<h1>v2</h1>");
    expect(pages.propose({ pageId: id, botId: "bot2", threadId: "t2", title: "x", kind: "html", content: "x" }).ok).toBe(false);
    const preview = await call(routes(pages), session("pr_alice"), "GET", `/api/pages/${id}/versions/1`);
    expect(preview.body!.version.previewPath).toBe(`/pages/preview/${id}/1`);
    expect(preview.body!.version.html).toBeUndefined();
  });

  it("delete removes the page, its content files and its link", async () => {
    const { pages, dir } = store();
    const { id, path } = published(pages, "link", "pr_alice");
    expect(existsSync(join(dir, "published-pages", id))).toBe(true);
    expect((await call(routes(pages), session("pr_alice"), "DELETE", `/api/pages/${id}`)).status).toBe(200);
    expect(pages.get(id)).toBeNull();
    expect(existsSync(join(dir, "published-pages", id))).toBe(false);
    expect((await read(pages, path, null)).wrapper.status).toBe(404);
  });
});

describe("caps and storage", () => {
  it("content lives outside the index, and a version beyond the cap drops the oldest unpublished one", () => {
    const { pages, dir } = store();
    const { page } = proposed(pages, "pr_alice", { content: "<p>secret-free marker</p>" });
    expect(readFileSync(join(dir, "published-pages.json"), "utf8")).not.toContain("secret-free marker");
    expect(pages.content(page.id, 1)).toBe("<p>secret-free marker</p>");
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    for (let i = 0; i < PAGE_LIMITS.versions + 2; i += 1) pages.propose({ pageId: page.id, botId: "bot1", threadId: "t1", title: "x", kind: "html", content: `v${i}` });
    const kept = pages.get(page.id)!.versions;
    expect(kept).toHaveLength(PAGE_LIMITS.versions);
    expect(kept.some((version) => version.n === 1)).toBe(true);
    expect(kept.some((version) => version.n === 2)).toBe(false);
    expect(existsSync(join(dir, "published-pages", page.id, "2"))).toBe(false);
  });

  it("per person and per bot caps", () => {
    const { pages } = store();
    for (let i = 0; i < PAGE_LIMITS.pagesPerOwner; i += 1) proposed(pages, "pr_alice", { botId: `bot${i}` });
    expect(pages.propose({ botId: "botx", threadId: "t9", title: "x", kind: "html", content: "x", ownerId: "pr_alice" })).toMatchObject({ ok: false, code: "too_many_owner" });
    expect(pages.propose({ botId: "botx", threadId: "t9", title: "x", kind: "html", content: "x", ownerId: "pr_bob" }).ok).toBe(true);
    for (let i = 0; i < PAGE_LIMITS.pagesPerBot - 1; i += 1) proposed(pages, `pr_p${i}`, { botId: "busy" });
    expect(proposed(pages, "pr_last", { botId: "busy" }).ok).toBe(true);
    expect(pages.propose({ botId: "busy", threadId: "t9", title: "x", kind: "html", content: "x", ownerId: "pr_other" })).toMatchObject({ ok: false, code: "too_many_bot" });
  });

  it("re-reads the index only when it changed on disk", () => {
    const { pages, dir } = store();
    const { page } = proposed(pages);
    expect(pages.get(page.id)).not.toBeNull();
    // another writer (a second instance on the same folder) is seen
    const other = new PublishedPages(dir, () => now);
    other.remove(page.id);
    expect(pages.get(page.id)).toBeNull();
  });
});

describe("input checks", () => {
  it("parsePageProposal and validExpiry", () => {
    expect(parsePageProposal({ title: "x", kind: "pdf", content: "x" }).ok).toBe(false);
    expect(parsePageProposal({ title: "", kind: "html", content: "x" }).ok).toBe(false);
    expect(parsePageProposal({ title: "x", kind: "html", content: "x".repeat(600 * 1024) }).ok).toBe(false);
    expect(parsePageProposal({ title: "x", kind: "html", content: "x", page_id: "../../etc" }).ok).toBe(false);
    expect(parsePageProposal({ title: "  A   title ", kind: "markdown", content: "# x" })).toEqual({ ok: true, value: { title: "A title", kind: "markdown", content: "# x" } });
    expect(validExpiry(null, now)).toEqual({ ok: true, value: null });
    expect(validExpiry(now + 1000, now)).toEqual({ ok: true, value: now + 1000 });
    expect(validExpiry(now, now).ok).toBe(false);
    expect(validExpiry(now + 400 * 24 * 60 * 60 * 1000, now).ok).toBe(false);
    expect(validExpiry("tomorrow", now).ok).toBe(false);
  });
});

describe("the app's preview (review of #646, round 2)", () => {
  it("its person gets the same wrapper and banner, framed by the app only, for a version never published", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const wrapper = await hit(options(pages, alice), `/pages/preview/${page.id}/1`);
    expect(wrapper.status).toBe(200);
    expect(wrapper.body).toContain("Aperçu d&#39;une page proposée par Scout pour Alice");
    expect(wrapper.body).not.toContain("<script");
    const csp = String(wrapper.headers["content-security-policy"]);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain(`frame-src sagax.example.com/pages/preview-frame/${page.id}/1;`);
    expect(wrapper.headers["x-frame-options"]).toBe("SAMEORIGIN");
    const src = frameSrc(wrapper.body);
    expect(src.startsWith(`/pages/preview-frame/${page.id}/1?t=`)).toBe(true);
    const frame = await hit(options(pages, alice), src, { "sec-fetch-dest": "iframe" });
    expect(frame.status).toBe(200);
    expect(String(frame.headers["content-security-policy"])).toMatch(/; sandbox allow-scripts$/);
    expect(frame.body).toContain("<h1>Rapport</h1>");
  });

  it("nobody else previews: another person, nobody signed in, or someone holding the ticket", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const bob: PageViewer = { principalId: "pr_bob", computerOwner: false };
    expect((await hit(options(pages, bob), `/pages/preview/${page.id}/1`)).status).toBe(404);
    expect((await hit(options(pages, null), `/pages/preview/${page.id}/1`)).status).toBe(404);
    const src = frameSrc((await hit(options(pages, alice), `/pages/preview/${page.id}/1`)).body);
    expect((await hit(options(pages, bob), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, null), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, alice), src, { "sec-fetch-dest": "document" })).status).toBe(404);
    // a reading ticket never opens a preview frame, nor the other way round
    expect((await hit(options(pages, alice), src.replace("/pages/preview-frame/", "/pages/frame/"), { "sec-fetch-dest": "iframe" })).status).toBe(404);
  });
});

describe("the frame checks its reader again (review of #646, round 2)", () => {
  it("on the app's origin: the live session, not only the ticket", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", "pr_alice");
    const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const src = frameSrc((await hit(options(pages, alice), path)).body);
    expect((await hit(options(pages, alice), src, { "sec-fetch-dest": "iframe" })).status).toBe(200);
    // the same ticket, presented without Alice's session
    expect((await hit(options(pages, null), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, { principalId: "pr_bob", computerOwner: false }), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    // and Alice's page turned to org: anyone signed in reads it
    pages.update(id, { access: "org" });
    expect((await hit(options(pages, { principalId: "pr_bob", computerOwner: false }), src, { "sec-fetch-dest": "iframe" })).status).toBe(200);
  });

  it("on the separate origin: the ticket's reader, still active", async () => {
    const separate = { pagesOrigin: new URL("https://pages.example.net"), appOrigin: new URL("https://sagax.example.com") };
    const { pages } = store();
    const { path } = published(pages, "private", "pr_alice");
    const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const src = new URL(frameSrc((await hit(options(pages, alice, separate), path)).body));
    const at = `${src.pathname}${src.search}`;
    const frame = (active: boolean) => hit({ ...options(pages, null, separate), viewerActive: () => active }, at, { host: "pages.example.net", "sec-fetch-dest": "iframe" });
    expect((await frame(true)).status).toBe(200);
    expect((await frame(false)).status).toBe(404);
  });
});

describe("a disabled or deleted person's pages, and admin revoke (review of #646, round 2)", () => {
  it("nothing of a disabled person is served, wrapper or frame", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_alice");
    const src = frameSrc((await hit(options(pages, null), path)).body);
    const gone = { ...options(pages, null), ownerActive: () => false };
    expect((await hit(gone, path)).status).toBe(404);
    expect((await hit(gone, src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
  });

  it("an organization admin lists every page and revokes one, audited; others are refused", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "link", "pr_alice");
    const rows: unknown[] = [];
    const handler = createPublishedPageRoutes({
      pages,
      owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
      isPerson: () => true,
      isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === "pr_admin",
      audit: (_auth, _req, row) => rows.push(row),
      origin: () => "https://sagax.example.com",
      reachable: () => true,
      now: () => now,
    });
    expect((await call(handler, session("pr_bob"), "GET", "/api/admin/pages")).status).toBe(403);
    expect((await call(handler, session("pr_bob"), "POST", `/api/admin/pages/${id}/revoke`)).status).toBe(403);
    const listed = await call(handler, session("pr_admin"), "GET", "/api/admin/pages");
    expect(listed.body!.pages.map((page: { id: string; ownerId: string }) => [page.id, page.ownerId])).toEqual([[id, "pr_alice"]]);
    // never the link or its path: they carry the token
    expect(listed.body!.pages[0].url).toBeUndefined();
    expect(listed.body!.pages[0].path).toBeUndefined();
    expect(JSON.stringify(listed.body)).not.toContain(path.slice("/pages/view/".length));
    const revoked = await call(handler, session("pr_admin"), "POST", `/api/admin/pages/${id}/revoke`);
    expect(revoked.body!.page.status).toBe("revoked");
    expect(revoked.body!.page.path).toBeUndefined();
    expect(rows).toEqual([{ action: "page.revoke", target: { kind: "page", id, name: "Rapport" } }]);
    expect((await read(pages, path, null)).wrapper.status).toBe(404);
  });
});

describe("per-person bytes and the pages host (review of #646, round 2)", () => {
  it("a person's pages are capped in bytes, for new pages and new versions alike", () => {
    const { pages } = store();
    const big = "x".repeat(PAGE_LIMITS.contentBytes);
    const ids: string[] = [];
    for (let p = 0; p < PAGE_LIMITS.bytesPerOwner / PAGE_LIMITS.contentBytes / PAGE_LIMITS.versions; p += 1) {
      const first = proposed(pages, "pr_alice", { botId: `b${p}`, content: big });
      ids.push(first.page.id);
      for (let v = 1; v < PAGE_LIMITS.versions; v += 1) expect(pages.propose({ pageId: first.page.id, botId: `b${p}`, threadId: "t1", title: "x", kind: "html", content: big }).ok).toBe(true);
    }
    expect(pages.propose({ botId: "bz", threadId: "t1", title: "x", kind: "html", content: "x", ownerId: "pr_alice" })).toMatchObject({ ok: false, code: "owner_full" });
    expect(pages.propose({ pageId: ids[0], botId: "b0", threadId: "t1", title: "x", kind: "html", content: "x" })).toMatchObject({ ok: false, code: "owner_full" });
    expect(pages.propose({ botId: "bz", threadId: "t1", title: "x", kind: "html", content: "x", ownerId: "pr_bob" }).ok).toBe(true);
  }, 120_000);

  it("SAGAX_PAGES_ORIGIN without a known app origin: that host serves nothing at all", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const src = frameSrc((await hit(options(pages, null), path)).body);
    const fenced = { ...options(pages, OWNER), pagesHost: "pages.example.net" };
    for (const other of [src, path, "/", "/api/pages", "/api/health"]) {
      const { req, res, done } = request(other, "GET", { host: "pages.example.net", "sec-fetch-dest": "iframe" });
      expect(handlePagesOriginRequest(fenced, req, res, new URL(other, "http://x").pathname, "GET")).toBe(true);
      expect((await done).status).toBe(404);
    }
    const app = request("/api/pages", "GET", { host: "sagax.example.com" });
    expect(handlePagesOriginRequest(fenced, app.req, app.res, "/api/pages", "GET")).toBe(false);
  });
});

describe("frame-src names the known public origin (review of #646, round 3)", () => {
  it("with its scheme when the request came in on that host, the Host header otherwise", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const token = path.slice("/pages/view/".length);
    const known = { ...options(pages, null), appOrigin: new URL("https://sagax.example.com") };
    const onPublic = await hit(known, path);
    expect(String(onPublic.headers["content-security-policy"])).toContain(`frame-src https://sagax.example.com/pages/frame/${token};`);
    const onLoopback = await hit(known, path, { host: "127.0.0.1:4321" });
    expect(String(onLoopback.headers["content-security-policy"])).toContain(`frame-src 127.0.0.1:4321/pages/frame/${token};`);
  });

  it("the served HTML has no link hint, nested frame or speculation rules left, and DNS prefetch off", async () => {
    const { pages } = store();
    const { page } = proposed(pages, undefined, { content: '<!doctype html><link rel=prerender href="http://evil.example/x"><iframe src="http://evil.example"></iframe><script type=speculationrules>{}</script><p>ok</p>' });
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    const { frame } = await read(pages, pages.path(pages.get(page.id)!.linkId!), null);
    expect(frame!.body).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">');
    expect(frame!.body).not.toMatch(/<link[\s>]/i);
    expect(frame!.body).not.toMatch(/<iframe[\s>]/i);
    expect(frame!.body).not.toMatch(/type=speculationrules>/i);
    expect(frame!.body).toContain("<p>ok</p>");
  });
});
