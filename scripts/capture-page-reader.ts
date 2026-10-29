// Headless captures of a published page as its reader sees it
// (/pages/view/<token>): the wrapper, its bar and the page in its frame,
// light and dark, for a reader who is not signed in and for the page's own
// person (Share open). A throwaway server answers the reading link with the
// real handlers (server/routes/published-pages.ts) over a temporary store;
// the built reader script comes from SAGAX_STATIC_DIR (default dist/, run
// `pnpm exec vite build` first). Nothing touches the person's data.
//
//   node --experimental-strip-types scripts/capture-page-reader.ts <outDir> [prefix]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

import { json, readBody } from "../server/harness/http.ts";
import { PublishedPages } from "../server/published-pages.ts";
import type { RequestAuth } from "../server/request-auth.ts";
import * as routesModule from "../server/routes/published-pages.ts";
import type { PageViewer, PublicPageOptions } from "../server/routes/published-pages.ts";
import { PASS } from "../server/routes/table.ts";

const outDir = resolve(process.argv[2] ?? "captures");
const prefix = process.argv[3] ?? "page-reader";
const staticDir = resolve(process.env.SAGAX_STATIC_DIR ?? "dist");
mkdirSync(outDir, { recursive: true });

const OWNER = "pr_owner_capture";
const READER = "pr_reader_capture";
const data = mkdtempSync(join(tmpdir(), "sagax-page-reader-capture-"));
const pages = new PublishedPages(data);

const HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport mensuel</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:48rem;margin:2.5rem auto;padding:0 1.25rem;color:#1f2328;background:#fff}
h1{font-size:2rem;margin:0 0 .25rem}.lead{color:#57606a;margin-top:0}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:1.5rem 0}.card{border:1px solid #d0d7de;border-radius:10px;padding:12px}
.card b{display:block;font-size:1.6rem}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #d0d7de;padding:.45rem .5rem;text-align:left}
@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}.lead{color:#9198a1}.card,th,td{border-color:#30363d}}</style></head>
<body><h1>Rapport mensuel</h1><p class="lead">Résumé des activités du mois d'octobre.</p>
<div class="cards"><div class="card"><b>128</b>Demandes traitées</div><div class="card"><b>96 %</b>Résolues à temps</div><div class="card"><b>4,7</b>Satisfaction</div></div>
<h2>Faits saillants</h2><p>Le volume de demandes a augmenté de 12 % par rapport au mois précédent. Le temps moyen de résolution est passé sous la barre des quatre heures.</p>
<table><thead><tr><th>Catégorie</th><th>Demandes</th><th>Délai moyen</th></tr></thead><tbody>
<tr><td>Postes de travail</td><td>54</td><td>2 h 40</td></tr><tr><td>Réseau</td><td>31</td><td>5 h 10</td></tr><tr><td>Comptes et accès</td><td>43</td><td>1 h 55</td></tr></tbody></table>
<h2>Prochaines étapes</h2><p>Renouveler les postes les plus anciens et documenter la procédure d'accueil des nouveaux employés.</p>
${"<p>Notes de suivi détaillées pour l'équipe.</p>".repeat(12)}</body></html>`;

// CAPTURE_KIND=markdown|presentation: the same report in our own Markdown
const KIND = process.env.CAPTURE_KIND === "markdown" || process.env.CAPTURE_KIND === "presentation" ? process.env.CAPTURE_KIND : "html";
const MARKDOWN = KIND === "presentation"
  ? "# Bilan du trimestre\n\nTrois chiffres à retenir.\n\n---\n\n## Demandes\n\n- 128 traitées\n- 96 % à temps\n\n---\n\n## Prochaines étapes\n\n1. Renouveler les postes\n2. Documenter l'accueil"
  : "# Rapport mensuel\n\nRésumé des activités du mois d'octobre.\n\n## Faits saillants\n\n| Catégorie | Demandes |\n|---|---|\n| Postes | 54 |\n| Réseau | 31 |\n\n" + "Notes de suivi détaillées pour l'équipe.\n\n".repeat(30);
const made = pages.propose({ ownerId: OWNER, botId: "bot_capture", threadId: "t_capture", title: "Rapport mensuel", kind: KIND, content: KIND === "html" ? HTML : MARKDOWN });
if (!made.ok) throw new Error(made.error);
pages.publish(made.page.id, { version: 1, access: "link", expiresAt: null, by: OWNER });
pages.setInvites(made.page.id, { people: [READER], teams: [] }, OWNER);
const pageId = made.page.id;
// two annotations already there (2026-10-28, Annotate), on the HTML report
if (KIND === "html") {
  const first = pages.addThread(pageId, { by: READER, version: 1, text: "Peut-on ajouter la comparaison avec le trimestre précédent ?",
    anchor: { kind: "text", quote: "Le volume de demandes a augmenté de 12 %", prefix: "Faits saillants", suffix: " par rapport au mois précédent", path: "body > p:nth-of-type(2)", tag: "p" } });
  if (first.ok) pages.reply(pageId, first.thread.id, { by: OWNER, text: "Oui, je demande au bot de l'ajouter." });
  pages.addThread(pageId, { by: OWNER, version: 1, text: "Vérifier le délai du réseau avant l'envoi.",
    anchor: { kind: "element", quote: "Réseau 31 5 h 10", prefix: "", suffix: "", path: "body > table > tbody > tr:nth-of-type(2)", tag: "tr" } });
}
const viewPath = pages.path(pages.get(pageId)!.linkId!);

function who(req: IncomingMessage): string {
  return /(?:^|;\s*)who=(\w+)/.exec(String(req.headers.cookie ?? ""))?.[1] ?? "anon";
}
function viewerOf(req: IncomingMessage): PageViewer {
  const name = who(req);
  return name === "owner" ? { principalId: OWNER, computerOwner: false } : name === "reader" ? { principalId: READER, computerOwner: false } : null;
}
function authOf(req: IncomingMessage): RequestAuth {
  const viewer = viewerOf(req);
  return { kind: "session", via: "cookie", scopes: ["client"], session: { id: `s_${who(req)}`, ...(viewer?.principalId ? { principalId: viewer.principalId } : {}) } as never };
}

const options: PublicPageOptions = {
  pages,
  viewer: viewerOf,
  names: () => ({ botName: "Scout", personName: "Page owner" }),
  teamsOf: () => [],
  ...(typeof (routesModule as Record<string, unknown>).readerAssetsFrom === "function"
    ? { readerAssets: () => (routesModule as unknown as { readerAssetsFrom(dir: string): unknown }).readerAssetsFrom(staticDir) } : {}),
} as PublicPageOptions;

const apiRoutes = routesModule.createPublishedPageRoutes({
  pages,
  owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
  isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
  origin: (req) => `http://${req.headers.host}`,
  reachable: () => true,
  ...({ reader: (auth: RequestAuth) => auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, computerOwner: false } : null } as object),
  ...({ names: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id === OWNER ? "Page owner" : id === READER ? "Invited reader" : "Scout"])) } as object),
} as Parameters<typeof routesModule.createPublishedPageRoutes>[0]);

const DIRECTORY = {
  people: [
    { principalId: OWNER, name: "Page owner", login: "owner", email: "owner@example.com" },
    { principalId: READER, name: "Invited reader", login: "reader", email: "reader@example.com" },
    { principalId: "pr_other_capture", name: "Colleague", login: "colleague", email: "colleague@example.com" },
  ],
  teams: [{ id: "team_capture", name: "Soutien technique", members: [READER, "pr_other_capture"], managers: [OWNER] }],
};

const MIME: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  if (routesModule.handlePublishedPagePublic(options, req, res, path, method)) return;
  if (path === "/api/org/directory") return json(res, 200, DIRECTORY);
  if (path === "/api/org") return json(res, 200, { org: { identity: { kind: "perspicax" } } });
  if (path.startsWith("/api/")) {
    const answered = await apiRoutes({ req, res, url, path, method, auth: authOf(req), json, readBody });
    if (answered !== PASS) return;
    return json(res, 404, { error: "no route" });
  }
  if (path.startsWith("/assets/")) {
    try {
      const body = readFileSync(join(staticDir, path.replace(/\.\./g, "")));
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
      return;
    } catch { /* below */ }
  }
  res.writeHead(404);
  res.end();
}

const server = createServer((req, res) => { void handle(req, res).catch((error) => { console.error(error); res.writeHead(500); res.end(); }); });
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `${prefix}-${name}.png`) });
  console.log(join(outDir, `${prefix}-${name}.png`));
}

try {
  for (const scheme of ["light", "dark"] as const) {
    for (const person of ["anon", "owner", "reader"] as const) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, locale: "fr-CA", extraHTTPHeaders: { "accept-language": "fr-CA" } });
      await context.addCookies([{ name: "who", value: person, url: base }]);
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error(`[${person}/${scheme}] ${error.message}`));
      await page.goto(`${base}${viewPath}`);
      await page.waitForLoadState("networkidle");
      await shot(page, `${person}-${scheme}`);
      if (person === "anon" && await page.locator("[data-reader-pdf]").count()) {
        // what Download PDF writes: the browser's print of the wrapper
        await page.pdf({ path: join(outDir, `${prefix}-${person}-${scheme}.pdf`), format: "A4", preferCSSPageSize: true });
        console.log(join(outDir, `${prefix}-${person}-${scheme}.pdf`));
      }
      if (person === "reader" && await page.locator("[data-reader-annotate]").count()) {
        await page.locator("[data-reader-annotate]").click();
        await page.waitForSelector("[data-reader-panel] [data-thread]");
        await shot(page, `${person}-${scheme}-annotate`);
        // a new selection in the page: the composer opens in the panel
        await page.frames()[1]!.evaluate(() => {
          const target = [...document.querySelectorAll("p")].find((p) => p.textContent?.startsWith("Renouveler"))!;
          const range = document.createRange();
          range.setStart(target.firstChild!, 0);
          range.setEnd(target.firstChild!, 33);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(range);
          document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        });
        await page.waitForSelector("[data-reader-draft]");
        await page.locator("[data-reader-draft] textarea").fill("Préciser l'échéancier.");
        await shot(page, `${person}-${scheme}-draft`);
      }
      if (person === "owner") {
        const share = page.locator("[data-reader-share]");
        if (await share.count()) {
          await share.click();
          await page.waitForSelector("[data-page-share-popover]");
          await shot(page, `${person}-${scheme}-share`);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
  rmSync(data, { recursive: true, force: true });
}
