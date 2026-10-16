// Published pages (server/published-pages.ts, server/routes/published-pages.ts,
// server/published-pages-render.ts): approval before anything is served,
// sandbox and CSP isolation of the served bytes, each access level,
// revocation, expiry, versions, and a person's own pages only.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentCard, type AgentCardStore } from "./chat-widgets.ts";
import { json, readBody } from "./harness/http.ts";
import { PublishedPages } from "./published-pages.ts";
import { markdownToHtml, pageDocument } from "./published-pages-render.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createPublishedPageRoutes, handlePublishedPagePublic, pageReadable, type PageViewer } from "./routes/published-pages.ts";
import type { Message } from "./store.ts";
import { PAGE_FRAME_SANDBOX, pageCsp, parsePageProposal, validExpiry } from "../shared/published-pages.ts";

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

function proposed(pages: PublishedPages, ownerId?: string) {
  const result = pages.propose({ botId: "bot1", threadId: "t1", title: "Rapport", kind: "html", content: HTML, ...(ownerId ? { ownerId } : {}) });
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

async function view(pages: PublishedPages, path: string, viewer: PageViewer, method = "GET"): Promise<Answer> {
  const { req, res, done } = request(path, method, { "accept-language": "fr-CA" });
  expect(handlePublishedPagePublic(pages, () => viewer, req, res, path, method)).toBe(true);
  return done;
}

const session = (principalId?: string): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: { id: "s1", ...(principalId ? { principalId } : {}) } as never,
});
const serviceLoopback: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };

function routes(pages: PublishedPages, organization = true) {
  return createPublishedPageRoutes({
    pages,
    owner: (auth) => organization && auth.kind === "session" ? auth.session.principalId : undefined,
    isPerson: (auth) => auth.kind === "session" ? (!organization || Boolean(auth.session.principalId)) : auth.trust !== "service" && !organization,
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

describe("approval before anything is served", () => {
  it("a proposal is stored as a draft with no reading link; nothing serves it", async () => {
    const { pages, dir } = store();
    const { page, version } = proposed(pages);
    expect(page.status).toBe("draft");
    expect(version.state).toBe("proposed");
    expect(page.linkId).toBeUndefined();
    expect(pages.summary(page, "https://x", true).url).toBeUndefined();
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "published-pages.key")).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "published-pages.json")).mode & 0o777).toBe(0o600);
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

describe("sandbox and CSP isolation", () => {
  it("serves the page under a sandbox without allow-same-origin and with no network", async () => {
    const { pages } = store();
    const { page } = proposed(pages);
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    const answer = await view(pages, pages.path(pages.get(page.id)!.linkId!), null);
    expect(answer.status).toBe(200);
    const csp = String(answer.headers["content-security-policy"]);
    expect(csp).toMatch(/(^|; )sandbox allow-scripts/);
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toContain("allow-top-navigation");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(answer.headers["set-cookie"]).toBeUndefined();
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(answer.headers["referrer-policy"]).toBe("no-referrer");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.body).toBe(HTML);
  });

  it("a Markdown page runs no script and its raw HTML is escaped", async () => {
    expect(pageCsp("markdown")).toContain("script-src 'none'");
    expect(pageCsp("markdown")).toMatch(/; sandbox$/);
    const html = markdownToHtml("# Titre\n\n<script>alert(1)</script> **gras** [lien](javascript:alert(1)) [ok](https://example.com)\n\n- a\n- b\n\n```\n<b>x</b>\n```");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("href=\"javascript:");
    expect(html).toContain("<a href=\"https://example.com\"");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>");
  });

  it("the app's preview carries the CSP as a meta tag and its frame never gets same-origin", () => {
    expect(PAGE_FRAME_SANDBOX).not.toContain("allow-same-origin");
    expect(PAGE_FRAME_SANDBOX).not.toContain("allow-top-navigation");
    const doc = pageDocument({ kind: "html", title: "R", content: HTML }, { meta: true });
    expect(doc.startsWith("<!doctype html><meta http-equiv=\"Content-Security-Policy\"")).toBe(true);
    expect(doc).toContain("connect-src &#39;none&#39;");
    expect(pageCsp("html", { meta: true })).not.toContain("sandbox");
  });

  it("only GET and HEAD, and the reading path never reaches the API", async () => {
    const { pages } = store();
    const { req, res, done } = request("/pages/view/x", "POST");
    expect(handlePublishedPagePublic(pages, () => ({}), req, res, "/pages/view/x", "POST")).toBe(true);
    expect((await done).status).toBe(405);
    const other = request("/api/pages", "GET");
    expect(handlePublishedPagePublic(pages, () => ({}), other.req, other.res, "/api/pages", "GET")).toBe(false);
  });
});

describe("access levels", () => {
  it("pageReadable: link for anyone, org for any person of the server, private for its person", () => {
    expect(pageReadable({ access: "link", ownerId: "pr_a" }, null)).toBe(true);
    expect(pageReadable({ access: "org", ownerId: "pr_a" }, null)).toBe(false);
    expect(pageReadable({ access: "org", ownerId: "pr_a" }, { principalId: "pr_b" })).toBe(true);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, { principalId: "pr_b" })).toBe(false);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, { principalId: "PR_A" })).toBe(true);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, {})).toBe(false);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, null)).toBe(false);
    // a one-person server: its owner is every session
    expect(pageReadable({ access: "private" }, {})).toBe(true);
    expect(pageReadable({ access: "private" }, { principalId: "pr_a" })).toBe(false);
  });

  it("each level over the reading link, with the same 404 for a reader who may not see it", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    pages.publish(page.id, { version: 1, access: "private", expiresAt: null });
    const path = pages.path(pages.get(page.id)!.linkId!);
    const made = await view(pages, `/pages/view/${"A".repeat(22)}.${"B".repeat(32)}`, { principalId: "pr_alice" });
    const anonymous = await view(pages, path, null);
    expect(anonymous.status).toBe(404);
    expect(anonymous.body).toBe(made.body);
    expect((await view(pages, path, { principalId: "pr_bob" })).status).toBe(404);
    expect((await view(pages, path, { principalId: "pr_alice" })).status).toBe(200);
    pages.update(page.id, { access: "org" });
    expect((await view(pages, path, null)).status).toBe(404);
    expect((await view(pages, path, { principalId: "pr_bob" })).status).toBe(200);
    pages.update(page.id, { access: "link" });
    expect((await view(pages, path, null)).status).toBe(200);
  });
});

describe("revocation, expiry and versions", () => {
  it("revoking takes the link down at once, and publishing again mints a new link", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const alice = session("pr_alice");
    const published = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null });
    const oldPath = published.body!.page.path as string;
    expect((await view(pages, oldPath, null)).status).toBe(200);
    const revoked = await call(handler, alice, "POST", `/api/pages/${page.id}/revoke`);
    expect(revoked.body!.page).toMatchObject({ status: "revoked", currentVersion: null });
    expect(revoked.body!.page.url).toBeUndefined();
    expect((await view(pages, oldPath, null)).status).toBe(404);
    const again = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null });
    expect(again.body!.page.path).not.toBe(oldPath);
    expect((await view(pages, oldPath, null)).status).toBe(404);
    expect((await view(pages, again.body!.page.path, null)).status).toBe(200);
    // changing who can see it needs a published page
    await call(handler, alice, "POST", `/api/pages/${page.id}/revoke`);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { access: "org" })).status).toBe(409);
  });

  it("an expired page is not served and reads as expired to its person", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const alice = session("pr_alice");
    const expiresAt = now + 60 * 60 * 1000;
    const published = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt });
    const path = published.body!.page.path as string;
    expect((await view(pages, path, null)).status).toBe(200);
    const before = now;
    now = expiresAt;
    try {
      expect((await view(pages, path, null)).status).toBe(404);
      expect((await call(handler, alice, "GET", `/api/pages/${page.id}`)).body!.page.expired).toBe(true);
      // the person extends it, and the same link reads again
      expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { expiresAt: null })).status).toBe(200);
      expect((await view(pages, path, null)).status).toBe(200);
    } finally {
      now = before;
    }
  });

  it("a new version waits for its own Publish; readers keep the published one", async () => {
    const { pages } = store();
    const first = proposed(pages, "pr_alice");
    pages.publish(first.page.id, { version: 1, access: "link", expiresAt: null });
    const path = pages.path(pages.get(first.page.id)!.linkId!);
    const second = pages.propose({ pageId: first.page.id, botId: "bot1", threadId: "t1", title: "Rapport v2", kind: "markdown", content: "# v2" });
    expect(second.ok && second.version.n).toBe(2);
    expect((await view(pages, path, null)).body).toBe(HTML);
    pages.publish(first.page.id, { version: 2, access: "link", expiresAt: null });
    expect((await view(pages, path, null)).body).toContain("<h1>v2</h1>");
    // a bot of another conversation cannot add a version to this page
    expect(pages.propose({ pageId: first.page.id, botId: "bot2", threadId: "t2", title: "x", kind: "html", content: "x" }).ok).toBe(false);
    const preview = await call(routes(pages), session("pr_alice"), "GET", `/api/pages/${first.page.id}/versions/1`);
    expect(preview.body!.version.html).toContain("Content-Security-Policy");
  });

  it("delete removes the page and its link", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    const path = pages.path(pages.get(page.id)!.linkId!);
    expect((await call(routes(pages), session("pr_alice"), "DELETE", `/api/pages/${page.id}`)).status).toBe(200);
    expect(pages.get(page.id)).toBeNull();
    expect((await view(pages, path, null)).status).toBe(404);
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
