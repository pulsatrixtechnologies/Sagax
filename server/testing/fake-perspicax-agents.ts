// A fake of Perspicax's cloud agents API (`/api/v1/agents`, Perspicax PR
// #372 plus the artifact routes of its spec section 10.1), in process, on
// 127.0.0.1. Tests use it, and `SAGAX_CODE_FIXTURE=1` starts one inside a
// verification server so the desktop's Code section can be driven before
// the real API is deployed. It never runs an agent: a run plays a short
// script of events on a timer (states, messages, a tool call, an approval,
// a commit, a draft PR) so the list, the run view and the live stream move.
//
// Every name and repository here is neutral sample data.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_PERSPICAX_TOKEN = "fixture-access-token";

interface FakeEnv {
  id: string;
  name: string;
  owner_id: string;
  scope: string;
  repos: { provider: string; owner: string; name: string; default_branch: string }[];
  engine_default: string;
  model_default: string;
  token_source: string;
  client_data: boolean;
  health: string;
  archived: boolean;
}

interface FakeRun {
  id: string;
  env_id: string;
  repo: string;
  base_branch: string;
  branch: string;
  title: string;
  prompt: string;
  engine: string;
  model: string;
  token_source: string;
  origin: string;
  origin_ref: string;
  requested_by: string;
  runs_as: string;
  state: string;
  pr: Record<string, unknown>;
  stats: Record<string, unknown>;
  usage: Record<string, unknown>;
  error: string;
  unread: boolean;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

interface FakeEvent {
  run_id: string;
  seq: number;
  at: string;
  kind: string;
  payload: Record<string, unknown>;
}

interface Script {
  /** steps still to play, one per tick */
  steps: ((run: FakeRun) => void)[];
}

export interface FakePerspicaxAgents {
  url: string;
  token: string;
  close(): Promise<void>;
  /** Plays one tick of every scripted run (tests drive time with it). */
  tick(): void;
  runs(): FakeRun[];
  events(runId: string): FakeEvent[];
}

export interface FakePerspicaxOptions {
  /** Milliseconds between script steps; 0 = only `tick()` advances. */
  tickMs?: number;
  /** Seed sample environments and runs (default true). */
  seed?: boolean;
  token?: string;
  now?: () => number;
  port?: number;
}

const PERSON = "person_demo";

const iso = (ms: number) => new Date(ms).toISOString();
const ulid = () => randomBytes(8).toString("hex");

// ---------------------------------------------------------------- sample diffs

const DIFF_PAGINATION = `diff --git a/src/invoices/list.ts b/src/invoices/list.ts
index 3f1c2aa..8b7d9e1 100644
--- a/src/invoices/list.ts
+++ b/src/invoices/list.ts
@@ -12,14 +12,22 @@ import { db } from "../db";
 export interface Page<T> {
   items: T[];
   total: number;
 }

-export async function listInvoices(page: number): Promise<Page<Invoice>> {
-  const offset = page * 50;
-  const rows = await db.invoices.find({ offset, limit: 50 });
-  return { items: rows, total: rows.length };
+const PAGE_SIZE = 50;
+
+export async function listInvoices(page: number): Promise<Page<Invoice>> {
+  const safe = Number.isInteger(page) && page >= 0 ? page : 0;
+  const [rows, total] = await Promise.all([
+    db.invoices.find({ offset: safe * PAGE_SIZE, limit: PAGE_SIZE, orderBy: "issued_at desc" }),
+    db.invoices.count(),
+  ]);
+  return { items: rows, total };
 }

 export function pageCount(total: number): number {
-  return Math.ceil(total / 50);
+  return Math.max(1, Math.ceil(total / PAGE_SIZE));
 }
diff --git a/src/invoices/list.test.ts b/src/invoices/list.test.ts
new file mode 100644
index 0000000..1d2e3f4
--- /dev/null
+++ b/src/invoices/list.test.ts
@@ -0,0 +1,18 @@
+import { describe, expect, it } from "vitest";
+import { pageCount } from "./list";
+
+describe("pageCount", () => {
+  it("is never zero", () => {
+    expect(pageCount(0)).toBe(1);
+  });
+
+  it("rounds up", () => {
+    expect(pageCount(51)).toBe(2);
+  });
+
+  it("counts exact pages", () => {
+    expect(pageCount(100)).toBe(2);
+  });
+});
+
+// The total now comes from count(), not from the page length.
diff --git a/docs/invoices.md b/docs/invoices.md
index 77aa001..77aa002 100644
--- a/docs/invoices.md
+++ b/docs/invoices.md
@@ -1,6 +1,9 @@
 # Factures

 La liste affiche 50 factures par page.
-Le total affiché était celui de la page.
+
+## Pagination
+
+- Le total vient de \`count()\` : il compte toutes les factures.
+- Une page invalide revient à la première.

 Voir aussi \`src/invoices/list.ts\`.
`;

const DIFF_TESTS = `diff --git a/src/export/csv.ts b/src/export/csv.ts
index 1111111..2222222 100644
--- a/src/export/csv.ts
+++ b/src/export/csv.ts
@@ -1,9 +1,15 @@
-export function toCsv(rows: string[][]): string {
-  return rows.map((row) => row.join(",")).join("\\n");
+const NEEDS_QUOTES = /[",\\n\\r]/;
+
+function cell(value: string): string {
+  const safe = /^[=+\\-@]/.test(value) ? \`'\${value}\` : value;
+  return NEEDS_QUOTES.test(safe) ? \`"\${safe.replaceAll('"', '""')}"\` : safe;
+}
+
+export function toCsv(rows: string[][]): string {
+  return rows.map((row) => row.map(cell).join(",")).join("\\r\\n");
 }

 export function header(columns: string[]): string[] {
   return columns.map((column) => column.trim());
 }
diff --git a/src/export/csv.test.ts b/src/export/csv.test.ts
new file mode 100644
--- /dev/null
+++ b/src/export/csv.test.ts
@@ -0,0 +1,12 @@
+import { expect, it } from "vitest";
+import { toCsv } from "./csv";
+
+it("quotes commas and quotes", () => {
+  expect(toCsv([["a,b", 'say "hi"']])).toBe('"a,b","say ""hi"""');
+});
+
+it("neutralises spreadsheet formulas", () => {
+  expect(toCsv([["=SUM(A1)"]])).toBe("'=SUM(A1)");
+});
+
+it("uses CRLF", () => expect(toCsv([["a"], ["b"]])).toBe("a\\r\\nb"));
`;

const DIFF_MCP = `diff --git a/server/mcp/listen.ts b/server/mcp/listen.ts
index 4444444..5555555 100644
--- a/server/mcp/listen.ts
+++ b/server/mcp/listen.ts
@@ -3,8 +3,14 @@ import { createServer } from "node:http";
 export function listen(port: number) {
   const server = createServer(handle);
-  server.listen(port);
+  // loopback only: never on every interface
+  server.listen(port, "127.0.0.1");
+  server.on("request", (req, res) => {
+    if (req.headers.host !== \`127.0.0.1:\${port}\`) {
+      res.writeHead(421).end();
+    }
+  });
   return server;
 }
`;

const DIFF_DOCS = `diff --git a/README.md b/README.md
index 6666666..7777777 100644
--- a/README.md
+++ b/README.md
@@ -4,7 +4,10 @@
 ## Installation

-Lancez \`npm install\`.
+1. Installez Node 24.
+2. Lancez \`pnpm install\`.
+3. Copiez \`.env.example\` vers \`.env\`.

 ## Démarrage
`;

const DIFF_COMPOSER = `diff --git a/src/composer/Composer.tsx b/src/composer/Composer.tsx
index 8888888..9999999 100644
--- a/src/composer/Composer.tsx
+++ b/src/composer/Composer.tsx
@@ -1,6 +1,8 @@
 import { useState } from "react";
+import { useDraft } from "./use-draft";

 export function Composer({ onSend }: { onSend: (text: string) => void }) {
-  const [text, setText] = useState("");
+  const [text, setText] = useDraft("composer");
+  const empty = text.trim().length === 0;
   return (
`;

interface Sample {
  diff: string;
  commits: { sha: string; title: string; author: string; at: string }[];
  files: { path: string; kind: "file" | "dir"; size?: number }[];
}

function sampleFiles(diff: string): Sample["files"] {
  const paths = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]!);
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return [
    ...[...dirs].sort().map((path) => ({ path, kind: "dir" as const })),
    ...paths.sort().map((path) => ({ path, kind: "file" as const, size: 1200 + path.length * 37 })),
    { path: "artifacts/rapport-tests.txt", kind: "file" as const, size: 812 },
  ];
}

// ---------------------------------------------------------------- the server

export async function startFakePerspicaxAgents(options: FakePerspicaxOptions = {}): Promise<FakePerspicaxAgents> {
  const now = options.now ?? Date.now;
  const token = options.token ?? FAKE_PERSPICAX_TOKEN;
  const envs: FakeEnv[] = [];
  const runs: FakeRun[] = [];
  const events = new Map<string, FakeEvent[]>();
  const samples = new Map<string, Sample>();
  const scripts = new Map<string, Script>();

  const push = (run: FakeRun, kind: string, payload: Record<string, unknown>, at = now()) => {
    const list = events.get(run.id) ?? [];
    list.push({ run_id: run.id, seq: list.length + 1, at: iso(at), kind, payload });
    events.set(run.id, list);
    run.updated_at = iso(Math.max(Date.parse(run.updated_at) || 0, at));
  };
  const setState = (run: FakeRun, state: string, error = "", at = now()) => {
    run.state = state;
    run.error = error;
    if (state === "running" && !run.started_at) run.started_at = iso(at);
    if (["idle", "finished", "failed", "stopped", "expired"].includes(state)) run.ended_at = iso(at);
    else if (state !== "archived") run.ended_at = null;
    push(run, "state", { state, error }, at);
  };

  const env = (id: string, name: string, scope: string, owner: string, repo: string, engine: string, model: string, health = "ok"): FakeEnv => {
    const row: FakeEnv = {
      id, name, owner_id: PERSON, scope,
      repos: [{ provider: "github", owner, name: repo, default_branch: "main" }],
      engine_default: engine, model_default: model, token_source: "org", client_data: false, health, archived: false,
    };
    envs.push(row);
    return row;
  };

  const newRun = (fields: Partial<FakeRun> & { env_id: string; title: string; prompt: string }, createdAt: number): FakeRun => {
    const environment = envs.find((e) => e.id === fields.env_id)!;
    const repo = `${environment.repos[0]!.owner}/${environment.repos[0]!.name}`;
    const id = fields.id ?? `run_${ulid()}`;
    const slug = fields.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    const run: FakeRun = {
      id,
      repo,
      base_branch: "main",
      branch: `px/${slug}-${id.slice(-4)}`,
      engine: environment.engine_default,
      model: environment.model_default,
      token_source: "org",
      origin: "console",
      origin_ref: "",
      requested_by: PERSON,
      runs_as: PERSON,
      state: "queued",
      pr: {},
      stats: {},
      usage: {},
      error: "",
      unread: false,
      created_at: iso(createdAt),
      updated_at: iso(createdAt),
      started_at: null,
      ended_at: null,
      ...fields,
      env_id: environment.id,
    };
    runs.push(run);
    push(run, "requested", { prompt: run.prompt, engine: run.engine, model: run.model }, createdAt);
    return run;
  };

  /** A finished run's whole history, written at once with past times. */
  const history = (run: FakeRun, sample: Sample, at: number, minutes: number, end: { state: string; pr?: { number: number; state: string }; error?: string; reply: string }) => {
    samples.set(run.id, sample);
    const step = (minutes * 60_000) / 8;
    let t = at + 2_000;
    for (const state of ["waking", "provisioning", "setup", "running"]) { setState(run, state, "", t); t += 1_500; }
    push(run, "message", { role: "assistant", text: "Je lis le dépôt et je repère les fichiers touchés." }, t += step);
    push(run, "tool_call", { id: "t1", name: "Bash", input: { command: "pnpm test" }, summary: "pnpm test" }, t += step);
    push(run, "tool_result", { id: "t1", ok: !end.error, output: end.error ? "3 tests en échec" : "Tests : 161 réussis, 0 échec" }, t += step);
    const added = sample.diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const removed = sample.diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    const files = (sample.diff.match(/^diff --git /gm) ?? []).length;
    if (!end.error) {
      run.stats = { files, added, removed, commits: sample.commits.length, last_sha: sample.commits.at(-1)?.sha ?? "" };
      push(run, "status", { text: `Commit ${sample.commits.at(-1)?.sha.slice(0, 7)} poussé sur ${run.branch}` }, t += step);
    }
    if (end.pr) {
      run.pr = { number: end.pr.number, url: `https://github.com/${run.repo}/pull/${end.pr.number}`, state: end.pr.state, head_sha: sample.commits.at(-1)?.sha ?? "" };
      push(run, "pr", { number: end.pr.number, url: run.pr.url, state: end.pr.state }, t += step);
    }
    push(run, "message", { role: "assistant", text: end.reply }, t += step);
    setState(run, end.state, end.error ?? "", t += step);
  };

  const commit = (title: string, at: number) => ({ sha: randomBytes(20).toString("hex"), title, author: "Agent cloud", at: iso(at) });

  /** The live script of a run: its next steps, one per tick. */
  const script = (run: FakeRun, sample: Sample, from: "queued" | "running" | "followup", reply: string) => {
    samples.set(run.id, sample);
    const steps: Script["steps"] = [];
    if (from === "queued") {
      for (const state of ["waking", "provisioning", "setup", "running"]) steps.push((r) => setState(r, state));
      steps.push((r) => push(r, "message", { role: "assistant", text: "Je clone le dépôt et j'installe les dépendances." }));
    }
    if (from !== "followup") {
      steps.push((r) => push(r, "tool_call", { id: "t1", name: "Read", input: { path: "src/" }, summary: "Lire src/" }));
      steps.push((r) => push(r, "tool_result", { id: "t1", ok: true, output: "12 fichiers lus" }));
      steps.push((r) => push(r, "message", { role: "assistant", text: "J'ai trouvé la cause. Je corrige et j'ajoute un test." }));
      steps.push((r) => push(r, "tool_call", { id: "t2", name: "Bash", input: { command: "pnpm test" }, summary: "pnpm test" }));
      steps.push((r) => push(r, "tool_result", { id: "t2", ok: true, output: "Tests : 42 réussis, 0 échec" }));
    } else {
      steps.push((r) => push(r, "message", { role: "assistant", text: "Je reprends avec votre suite." }));
      steps.push((r) => push(r, "tool_call", { id: "t3", name: "Edit", input: { path: "src/" }, summary: "Modifier 1 fichier" }));
      steps.push((r) => push(r, "tool_result", { id: "t3", ok: true, output: "1 fichier modifié" }));
    }
    steps.push((r) => {
      const c = commit(from === "followup" ? "Appliquer la suite demandée" : `fix: ${r.title.toLowerCase()}`, now());
      sample.commits.push(c);
      const added = sample.diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
      const removed = sample.diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
      r.stats = { files: (sample.diff.match(/^diff --git /gm) ?? []).length, added, removed, commits: sample.commits.length, last_sha: c.sha };
      push(r, "status", { text: `Commit ${c.sha.slice(0, 7)} poussé sur ${r.branch}` });
    });
    if (!runPrNumber(run)) {
      steps.push((r) => {
        const number = 100 + runs.indexOf(r);
        r.pr = { number, url: `https://github.com/${r.repo}/pull/${number}`, state: "draft", head_sha: sample.commits.at(-1)?.sha ?? "" };
        push(r, "pr", { number, url: r.pr.url, state: "draft" });
      });
    }
    steps.push((r) => {
      push(r, "message", { role: "assistant", text: reply });
      r.unread = true;
      setState(r, "idle");
    });
    scripts.set(run.id, { steps });
  };
  const runPrNumber = (run: FakeRun) => typeof run.pr.number === "number" ? run.pr.number : 0;

  if (options.seed !== false) {
    const t = now();
    const H = 3_600_000;
    const web = env("env_01demoweb", "demo/web-app", "personnelle", "demo", "web-app", "claude-code", "claude-sonnet-4-5");
    const api = env("env_02demoapi", "demo/api", "equipe", "demo", "api", "codex", "gpt-5-codex",
      "Aucune image prête : l'agent a démarré sur l'image par défaut, sans le setup.");

    const a = newRun({ id: "run_01merged0a3f", env_id: web.id, title: "Corriger la pagination de la liste des factures", prompt: "La liste des factures affiche un total faux et une page vide après la dernière. Corrige la pagination et ajoute des tests." }, t - 50 * H);
    history(a, { diff: DIFF_PAGINATION, commits: [commit("fix: total des factures par count()", t - 49.8 * H), commit("test: pageCount", t - 49.7 * H)], files: sampleFiles(DIFF_PAGINATION) }, t - 50 * H, 8,
      { state: "finished", pr: { number: 42, state: "merged" }, reply: "La pagination est corrigée : le total vient de `count()` et une page invalide revient à la première.\n\n**Tests** : 161 réussis, 0 échec.\n\nPR : https://github.com/demo/web-app/pull/42 (fusionnée)." });

    const b = newRun({ id: "run_02draft00b71", env_id: api.id, title: "Ajouter les tests du module d'export CSV", prompt: "Ajoute des tests au module d'export CSV et neutralise les formules de tableur." }, t - 26 * H);
    history(b, { diff: DIFF_TESTS, commits: [commit("test: export CSV", t - 25.8 * H)], files: sampleFiles(DIFF_TESTS) }, t - 26 * H, 12,
      { state: "idle", pr: { number: 17, state: "draft" }, reply: "Les tests sont écrits et une cellule qui commence par `=` reçoit une apostrophe. La PR est en brouillon." });
    b.unread = true;
    push(b, "warning", { text: api.health, details: "Le script d'installation de l'environnement n'a pas de build prêt. Corrigez-le dans la console Perspicax, fiche de l'environnement." }, t - 25.99 * H);

    const c = newRun({ id: "run_03open000c2d", env_id: web.id, title: "Durcir le serveur MCP local (127.0.0.1)", prompt: "Le serveur MCP local écoute sur toutes les interfaces. Limite-le à 127.0.0.1 et refuse un mauvais Host.", origin: "sagax" }, t - 5 * H);
    history(c, { diff: DIFF_MCP, commits: [commit("fix: écoute en loopback seulement", t - 4.9 * H)], files: sampleFiles(DIFF_MCP) }, t - 5 * H, 6,
      { state: "idle", pr: { number: 43, state: "open" }, reply: "Le serveur écoute seulement sur 127.0.0.1 et répond 421 à un autre Host. PR ouverte." });
    c.unread = true;

    const d = newRun({ id: "run_04branch0d9e", env_id: web.id, title: "Mettre à jour la doc d'installation", prompt: "Mets à jour la section Installation du README." }, t - 8 * 24 * H);
    history(d, { diff: DIFF_DOCS, commits: [commit("docs: installation", t - 8 * 24 * H + 600_000)], files: sampleFiles(DIFF_DOCS) }, t - 8 * 24 * H, 3,
      { state: "finished", reply: "La section Installation est à jour sur la branche. Aucune PR demandée." });

    const e = newRun({ id: "run_05failed0e11", env_id: api.id, title: "Migrer la base vers le schéma 12", prompt: "Écris la migration vers le schéma 12 et fais passer les tests." }, t - 3 * 24 * H);
    history(e, { diff: "", commits: [], files: [] }, t - 3 * 24 * H, 9,
      { state: "failed", error: "Les vérifications de l'environnement ont échoué : 3 tests en échec.", reply: "La migration casse trois tests d'intégration. Je m'arrête ici." });

    const g = newRun({ id: "run_06approv0f42", env_id: web.id, title: "Nettoyer les dépendances inutilisées", prompt: "Retire les dépendances inutilisées du package.json." }, t - 20 * 60_000);
    samples.set(g.id, { diff: "", commits: [], files: [] });
    for (const state of ["waking", "provisioning", "setup", "running"]) setState(g, state, "", t - 19 * 60_000);
    push(g, "message", { role: "assistant", text: "Trois dépendances ne sont importées nulle part. Je dois lancer `pnpm remove`, qui modifie le lockfile." }, t - 18 * 60_000);
    push(g, "approval", { approval_id: "ap_1", title: "Lancer pnpm remove left-pad is-odd chalk ?", options: ["Autoriser", "Refuser"] }, t - 17 * 60_000);
    setState(g, "waiting_for_approval", "", t - 17 * 60_000);

    const f = newRun({ id: "run_07live000a55", env_id: web.id, title: "Garder le brouillon du composeur", prompt: "Le texte du composeur se perd au changement de conversation. Garde un brouillon par conversation." }, t - 3 * 60_000);
    for (const state of ["waking", "provisioning", "setup", "running"]) setState(f, state, "", t - 170_000);
    push(f, "message", { role: "assistant", text: "Je clone le dépôt et j'installe les dépendances." }, t - 160_000);
    script(f, { diff: DIFF_COMPOSER, commits: [], files: sampleFiles(DIFF_COMPOSER) }, "running", "Le composeur garde un brouillon par conversation. PR en brouillon pour revue.");
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      return value && typeof value === "object" ? value as Record<string, unknown> : {};
    } catch {
      return {};
    }
  };
  const page = <T>(items: T[]) => ({ items, page: 1, page_size: items.length, total: items.length });
  const mutated = <T>(value: T) => ({ audit_id: `aud_${ulid()}`, value });

  const tick = () => {
    for (const [id, play] of scripts) {
      const run = runs.find((r) => r.id === id);
      if (!run || ["stopped", "archived", "failed"].includes(run.state)) { scripts.delete(id); continue; }
      const step = play.steps.shift();
      if (step) step(run);
      if (play.steps.length === 0) scripts.delete(id);
    }
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      if (!path.startsWith("/api/v1/agents/")) return json(res, 404, { error: "not found" });
      if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: "Unauthorized" });
      const method = req.method ?? "GET";
      const rest = path.slice("/api/v1/agents/".length).split("/");

      if (rest[0] === "environments" && rest.length === 1 && method === "GET") {
        return json(res, 200, page(envs.filter((e) => url.searchParams.get("archived") === "true" || !e.archived)));
      }
      if (rest[0] !== "runs") return json(res, 404, { error: "not found" });

      if (rest.length === 1) {
        if (method === "GET") {
          const state = url.searchParams.get("state");
          const envId = url.searchParams.get("env_id");
          const rows = runs.filter((r) => (!state || r.state === state) && (!envId || r.env_id === envId))
            .sort((x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at));
          return json(res, 200, page(rows));
        }
        if (method === "POST") {
          const body = await readJson(req);
          const environment = envs.find((e) => e.id === body.env_id);
          if (!environment) return json(res, 404, { error: "no such environment" });
          const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
          if (!prompt) return json(res, 400, { error: "prompt is required" });
          const active = runs.filter((r) => ["queued", "waking", "provisioning", "setup", "running", "waiting_for_approval"].includes(r.state)).length;
          if (active >= 4) return json(res, 409, { error: "4 runs at once at most per person (agents.max_runs_per_person)." });
          const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : prompt.split("\n")[0]!.slice(0, 80);
          const run = newRun({
            env_id: environment.id,
            title,
            prompt,
            ...(typeof body.engine === "string" && body.engine ? { engine: body.engine } : {}),
            ...(typeof body.model === "string" && body.model ? { model: body.model } : {}),
            origin: body.origin === "sagax" || body.origin === "mcp" ? body.origin : "console",
            ...(typeof body.origin_ref === "string" ? { origin_ref: body.origin_ref } : {}),
          }, now());
          script(run, { diff: DIFF_COMPOSER, commits: [], files: sampleFiles(DIFF_COMPOSER) }, "queued", "C'est fait. La branche est poussée et une PR en brouillon attend votre revue.");
          return json(res, 200, mutated(run));
        }
        return json(res, 405, { error: "method" });
      }

      const run = runs.find((r) => r.id === rest[1]);
      if (!run) return json(res, 404, { error: "no such run" });
      const action = rest[2];
      if (!action && method === "GET") return json(res, 200, run);
      if (action === "events" && method === "GET") {
        const after = Number(url.searchParams.get("after") ?? 0) || 0;
        return json(res, 200, (events.get(run.id) ?? []).filter((e) => e.seq > after));
      }
      if (action === "stream" && method === "GET") {
        let cursor = Number(url.searchParams.get("after") ?? 0) || 0;
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": ok\n\n");
        const flush = () => {
          for (const e of (events.get(run.id) ?? []).filter((row) => row.seq > cursor)) {
            cursor = e.seq;
            res.write(`event: ${e.kind}\nid: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
          }
        };
        flush();
        const timer = setInterval(flush, 300);
        const ping = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
        req.on("close", () => { clearInterval(timer); clearInterval(ping); });
        return;
      }
      if (action === "read" && method === "POST") { run.unread = false; return json(res, 200, run); }
      if (action === "followup" && method === "POST") {
        const body = await readJson(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return json(res, 400, { error: "text is required" });
        if (["failed", "stopped", "expired", "archived"].includes(run.state)) {
          return json(res, 409, { error: `run is ${run.state}` });
        }
        const mode = body.mode === "steer" || body.mode === "interrupt" ? body.mode : "queue";
        push(run, "followup", { text, mode, by: PERSON });
        if (!scripts.has(run.id)) {
          setState(run, "running");
          script(run, samples.get(run.id) ?? { diff: DIFF_COMPOSER, commits: [], files: [] }, "followup", "La suite est appliquée et poussée sur la même branche.");
        }
        return json(res, 200, mutated(run));
      }
      if (action === "approve" && method === "POST") {
        const body = await readJson(req);
        const option = typeof body.option === "string" ? body.option : "";
        push(run, "approval_answer", { approval_id: body.approval_id, option, by: PERSON });
        if (run.state === "waiting_for_approval") {
          setState(run, "running");
          if (option === "Refuser") {
            push(run, "message", { role: "assistant", text: "D'accord, je ne touche pas au lockfile." });
            setState(run, "idle");
          } else {
            script(run, { diff: DIFF_DOCS, commits: [], files: sampleFiles(DIFF_DOCS) }, "followup", "Les trois dépendances sont retirées.");
          }
        }
        return json(res, 200, mutated(run));
      }
      if (action === "stop" && method === "POST") {
        scripts.delete(run.id);
        if (!["finished", "failed", "stopped", "expired", "archived"].includes(run.state)) setState(run, "stopped");
        return json(res, 200, mutated(run));
      }
      if (action === "archive" && method === "POST") {
        scripts.delete(run.id);
        setState(run, "archived");
        return json(res, 200, mutated(run));
      }
      const sample = samples.get(run.id) ?? { diff: "", commits: [], files: [] };
      if (action === "diff" && method === "GET") {
        res.writeHead(200, { "content-type": "text/x-diff; charset=utf-8" });
        return res.end(sample.commits.length ? sample.diff : "");
      }
      if (action === "commits" && method === "GET") return json(res, 200, { items: sample.commits });
      if (action === "files" && method === "GET") return json(res, 200, { items: sample.commits.length ? sample.files : [] });
      return json(res, 404, { error: "not found" });
    })().catch(() => { if (!res.headersSent) json(res, 500, { error: "fake failed" }); });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const timer = options.tickMs === 0 ? null : setInterval(tick, options.tickMs ?? 1_500);
  timer?.unref?.();
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    tick,
    runs: () => runs,
    events: (runId) => events.get(runId) ?? [],
    close: () => new Promise<void>((resolve) => {
      if (timer) clearInterval(timer);
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
