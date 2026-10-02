#!/usr/bin/env node
// The parity fixture: this repository's real server, on a throwaway data
// directory and a free port, seeded with a dataset shaped like the reference
// screenshots (ios/parity-refs/). Names, titles, sections and message
// lengths match; every word of content is placeholder text.
//
//   node ios/parity/fixture-server.mjs            # seed, pair, keep serving
//   node ios/parity/fixture-server.mjs --once     # seed, pair, print, stop
//
// Nothing touches ~/.openmausbot: HOME and OMB_DATA_DIR point into a temp
// directory removed on exit. The engine is the repository's fake Claude CLI,
// so no provider is called.
//
// Seeding runs in two passes. Pass one boots the server and creates bots,
// sections, a room and routines through the HTTP API, exactly as a client
// would. The server is then stopped and the transcripts are written straight
// into its SQLite store with timestamps relative to today (no engine turn can
// produce a fixed time). Pass two boots it again on the same data and opens a
// pairing window through the server's own API; the session file the harness
// reads (ios/parity/out/session.json) carries the endpoint, the bearer and
// the environment id the app is launched with.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { deflateSync, crc32 } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out");
const once = process.argv.includes("--once");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ports ────────────────────────────────────────────────────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function freePair() {
  // The server also binds PORT + 1 for webhooks unless told otherwise.
  for (let i = 0; i < 20; i++) {
    const port = await freePort();
    const webhook = await freePort();
    if (port !== webhook) return { port, webhook };
  }
  throw new Error("no free ports");
}

// ── the server ──────────────────────────────────────────────────────────
let home = "";
let child = null;
let enterpriseStub = "";

function startServer(port, webhook) {
  const log = join(OUT, "server.log");
  const proc = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
    cwd: ROOT,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: home,
      USERPROFILE: home,
      OMB_DATA_DIR: join(home, ".openmausbot"),
      OMB_PORT: String(port),
      OMB_WEBHOOK_PORT: String(webhook),
      FAKE_CLAUDE_MODE: "happy",
      // Settings > Usage reads the monthly budget, an enterprise feature: a
      // stub layer (written by main()) grants "budgets" and nothing else.
      ...(enterpriseStub ? { OMB_ENTERPRISE_DIR: enterpriseStub, OMB_LICENSE_KEY: "parity-fixture" } : {}),
      TZ: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.err = "";
  const sink = (chunk) => {
    proc.err += chunk;
    try { writeFileSync(log, chunk, { flag: "a" }); } catch { /* best effort */ }
  };
  proc.stdout.on("data", sink);
  proc.stderr.on("data", sink);
  return proc;
}

async function waitHealthy(base, proc) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`server exited ${proc.exitCode}:\n${proc.err.slice(-4000)}`);
    if (Date.now() > deadline) throw new Error(`server never came up:\n${proc.err.slice(-4000)}`);
    await sleep(200);
  }
}

async function stopServer(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  for (let i = 0; i < 100 && proc.exitCode === null; i++) await sleep(100);
  if (proc.exitCode === null) proc.kill("SIGKILL");
  await sleep(200);
}

async function api(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return parsed;
}

// ── the dataset ─────────────────────────────────────────────────────────
// Sagax looks: owls (with skins), shapes and Trombi, in MAUS_COLORS.
const owl = (skin) => ({ look: { character: "owl" }, skin });
const shape = (s, skin = "plain") => ({ look: { character: "shape", shape: s, skins: { shape: skin } } });
const trombi = (skin = "classic") => ({ look: { character: "trombi", skins: { trombi: skin } } });

// Created in this order because the server lists bots newest first, which
// is the order of New Group Chat's list (17): Orion, Liora, Aurora, Sirius,
// Vera, Celeste, Ciel. Sections keep their first-created order
// (Administration, then Transformation Numérique, then Sécurité).
const BOTS = [
  { key: "ara", name: "Ara", title: "Admin", color: "purple", pinned: true, ...owl() },
  { key: "helios", name: "Helios", title: "Operations", color: "orange", pinned: true, ...shape("hexagon") },
  { key: "helix", name: "Helix", title: "Bot Designer", color: "blue", section: "Administration", ...owl("frost") },
  { key: "keepler", name: "Keepler", title: "Project Manager", color: "blue", section: "Transformation Numérique", ...shape("pill") },
  { key: "lux", name: "Lux", title: "Documentation", color: "yellow", section: "Transformation Numérique", ...trombi() },
  { key: "altair", name: "Altair", title: "Sales", color: "teal", section: "Transformation Numérique", ...shape("cloud") },
  { key: "rigel", name: "Rigel", title: "Security", color: "black", section: "Sécurité", ...trombi("retro98") },
  { key: "ciel", name: "Ciel", title: "Researcher", color: "white", section: "Transformation Numérique", ...owl("carbon") },
  { key: "celeste", name: "Celeste", title: "Ticket Worker", color: "blue", section: "Transformation Numérique", ...shape("drop") },
  { key: "vera", name: "Vera", title: "Recruiter", color: "pink", section: "Transformation Numérique", ...shape("blob", "glossy") },
  { key: "sirius", name: "Sirius", title: "Support", color: "cyan", section: "Transformation Numérique", ...shape("triangle") },
  { key: "aurora", name: "Aurora", title: "Finance Manager", color: "red", section: "Administration", ...shape("circle") },
  { key: "liora", name: "Liora", title: "Department Manager", color: "green", section: "Transformation Numérique", ...shape("squircle") },
  { key: "orion", name: "Orion", title: "Analyst", color: "coral", section: "Transformation Numérique", ...owl("gold") },
];

const GROUP = { name: "Peer Managers", members: ["ara", "helios", "liora"] };

const SOUL_ARA = [
  "# Ara",
  "",
  "Tu coordonnes l'équipe et tu tiens le fil des priorités de la semaine.",
  "",
  "Texte de remplacement : chaque matin, lis les fils ouverts, résume ce qui bloque",
  "et propose une prochaine étape courte pour chacun. Réponds en français, en",
  "phrases simples, et cite les identifiants exacts quand tu en donnes.",
  "",
  "Quand une décision dépasse ton rôle, demande avant d'agir.",
].join("\n");

// Shaped like the reference reply: the same blocks and line counts at the
// 305 pt text column (4, 1, then list items of 1, 5, 2 and 1 lines, then 5,
// 6 and 3), with placeholder words.
const ARA_REPLY = [
  "C'est fait et vérifié. Le commit `7c1e9a2` est sur `main` dans `fixture-workspace`, poussé à 16 h 41 HE, avec 212 fichiers dans un nouveau dossier `notes/`.",
  "",
  "Voici ce qu'il y a dedans :",
  "",
  "- Les 14 gabarits au complet.",
  "- Les 22 bots, chacun avec son profil, ses réglages, son identifiant et ses images. Pour les bots qui en ont, il y a aussi leur mémoire propre (10 bots) et leurs routines (7 bots).",
  "- La mémoire partagée de l'équipe, classée par bot.",
  "- Un `README` qui explique la structure.",
  "",
  "Avant de pousser, j'ai scanné les fichiers pour trouver des secrets. Aucun jeton ni mot de passe réel n'est sorti ; les seules alertes étaient de faux exemples de clés dans les tests d'un skill Calendrier. Le dépôt est privé.",
  "",
  "Il y a trois choses que j'ai volontairement laissées de côté : les fichiers de secrets et les cookies, les bases de conversations et transcriptions (environ 140 Mo, qui peuvent contenir des infos sensibles), et les pièces jointes. Pour le dépôt `doc-placeholder-mcp`, il était déjà à jour sur le NAS.",
  "",
  "Veux-tu que je refasse cette sauvegarde automatiquement chaque semaine, par exemple le dimanche soir?",
].join("\n");

// The bot's earlier answer, scrolled under the top bar in the reference.
const ARA_EARLIER = "Je m'en occupe. Je vérifie d'abord qu'il n'y a aucun secret dans les fichiers, ensuite je pousse tout dans `fixture-workspace`.";

const PREVIEWS = {
  helios: "Le rapport hebdomadaire est prêt, je l'envoie à l'équipe ce soir.",
  aurora: "Budget du trimestre, version de remplacement",
  helix: "J'ai envoyé le gabarit à Liora pour relecture.",
  liora: "Les priorités du département sont à jour pour octobre.",
  keepler: "Le jalon deux est décalé d'une semaine, voir le plan.",
  lux: "La page d'accueil de la documentation est publiée.",
  altair: "Trois propositions envoyées, deux réponses attendues.",
  celeste: "Le billet est fermé, la cause était une mise à jour manquée.",
  orion: "Les chiffres de septembre sont dans le tableau partagé.",
  sirius: "Aucune nouvelle demande depuis ce matin.",
  vera: "Deux entrevues prévues jeudi après-midi.",
  ciel: "Résumé des trois articles lus aujourd'hui.",
  rigel: "Analyse terminée, aucun accès inhabituel détecté.",
};

// ── settings (12, 14, 15, 21) ──────────────────────────────────────────
// Sixteen saved command rules ("Auto-review Rules 16"), spread over bots.
const RULES = [
  ["ara", "git status"], ["ara", "git log --oneline -20"], ["ara", "ls -la"], ["ara", "pnpm test"],
  ["helios", "make ci"], ["helios", "df -h"], ["helix", "pnpm typecheck"], ["helix", "git diff --stat"],
  ["keepler", "npm run build"], ["lux", "mkdocs build"], ["altair", "python3 scripts/report.py"],
  ["rigel", "last -n 20"], ["rigel", "journalctl -u ssh --since today"], ["celeste", "curl -sI https://example.com"],
  ["orion", "sqlite3 data.db .tables"], ["liora", "cat notes/priorites.md"],
];

function seedCommandRules(dataDir, seeded) {
  const rules = RULES.map(([key, command]) => ({
    id: randomUUID(), botId: seeded.ids[key].id, command, cwd: "/workspace/fixture", providerInstanceId: "claude",
  }));
  writeFileSync(join(dataDir, "command-allowlist.json"), JSON.stringify({ version: 1, rules }));
}

// Seventeen installed plugins ("17 installed"): servers the team added on
// the computer. Addresses under .test never resolve, so nothing is called.
const TEAM_SERVERS = [
  "backup-monitor", "docs-wiki", "setup-helper", "ticket-desk", "time-sheets", "crm-notes", "endpoint-guard",
  "password-vault", "network-map", "billing-desk", "asset-registry", "status-page", "file-share", "calendar-sync",
  "mail-archive", "knowledge-base", "remote-tools",
];

function teamMcpServers() {
  return Object.fromEntries(TEAM_SERVERS.map((name) => [name, { type: "http", url: `https://${name}.example.test/mcp`, enabled: true }]));
}

function writeEnterpriseStub(dir) {
  mkdirSync(join(dir, "server"), { recursive: true });
  writeFileSync(join(dir, "server", "index.ts"),
    'export function register() { return { customer: "Parity fixture", features: ["budgets"], expiresAt: null }; }\n');
}

// ── tiny PNG writer (solid colour with a diagonal band) ─────────────────
function png(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const band = Math.abs(x - y) < width / 6 ? 40 : 0;
      raw[row + 1 + x * 3] = Math.min(255, r + band);
      raw[row + 2 + x * 3] = Math.min(255, g + band);
      raw[row + 3 + x * 3] = Math.min(255, b + band);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── times, relative to today in the local zone ──────────────────────────
function today(hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}
const DAY = 86_400_000;

// ── pass one: the API ───────────────────────────────────────────────────
async function seedThroughAPI(base) {
  const before = (await api(base, "GET", "/api/bots")).bots ?? [];
  const ids = {};
  for (const spec of BOTS) {
    const created = await api(base, "POST", "/api/bots", {
      name: spec.name,
      title: spec.title,
      ...(spec.section ? { section: spec.section } : {}),
      ...(spec.key === "ara" ? { soul: SOUL_ARA } : {}),
    });
    const bot = created.bot;
    ids[spec.key] = { id: bot.id, threadId: bot.threadId };
    const patch = { color: spec.color, mascotLook: spec.look };
    if (spec.skin) patch.mascotSkin = spec.skin;
    if (spec.pinned) patch.pinned = true;
    await api(base, "PATCH", `/api/bots/${bot.id}`, patch);
  }
  // The server seeds a starter bot on an empty store; it is not part of the set.
  for (const extra of before) await api(base, "DELETE", `/api/bots/${extra.id}`).catch(() => {});

  const room = await api(base, "POST", "/api/groups", {
    name: GROUP.name,
    memberIds: GROUP.members.map((key) => ids[key].id),
  });
  const group = room.group ?? room.room ?? room;
  // Pinned on the home row, as in the reference, where the server has group
  // pins; an older server ignores or refuses it and the group stays listed.
  await api(base, "PATCH", `/api/groups/${group.id}`, { pinned: true }).catch(() => {});
  // Ara carries the unread dot in the reference.
  await api(base, "PATCH", `/api/bots/${ids.ara.id}`, { unread: true }).catch(() => {});

  const ara = ids.ara.id;
  const cron = await api(base, "POST", "/api/routines", {
    name: "Scan skills populaires mensuel",
    prompt: "Texte de remplacement : liste les compétences les plus utilisées ce mois-ci et propose deux ajouts.",
    botId: ara,
    runOn: "maus",
    schedule: { type: "cron", expression: "2 7 1-7 * 1", timeZone: "America/Toronto" },
    durationMinutes: 30,
  });
  const weekly = await api(base, "POST", "/api/routines", {
    name: "Planif CW approbation temps lundi",
    prompt: "Texte de remplacement : prépare la liste des feuilles de temps à approuver lundi matin.",
    botId: ara,
    runOn: "maus",
    schedule: { type: "daily", time: "07:00", weekdays: [1] },
    durationMinutes: 30,
  });
  const weeklyId = (weekly.routine ?? weekly).id;
  await api(base, "PATCH", `/api/routines/${weeklyId}`, { enabled: false });

  return { ids, groupId: group.id, groupThreadId: group.threadId, routines: [(cron.routine ?? cron).id, weeklyId] };
}

// ── between passes: the transcripts ─────────────────────────────────────
function seedTranscripts(dataDir, seeded) {
  const attachments = join(dataDir, "attachments");
  mkdirSync(attachments, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "messages.db"));
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const leaf = db.prepare("INSERT OR REPLACE INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?)");
  // Creation left a greeting stamped "now" in each thread; it would become
  // every row's preview. The fixture replaces each transcript whole.
  const clear = db.prepare("DELETE FROM messages WHERE thread_id = ?");
  let counter = 0;
  const write = (threadId, messages) => {
    clear.run(threadId);
    let parent;
    for (const m of messages) {
      const id = m.id ?? `parity-${++counter}`;
      const record = { id, at: m.at, ...(parent ? { parentId: parent } : {}), role: m.role, kind: "text", text: m.text };
      if (m.attachments) record.attachments = m.attachments;
      if (m.role === "bot") Object.assign(record, { turnId: `turn-${id}`, turnTerminal: true, turnSucceeded: true });
      insert.run(threadId, id, m.at, m.role, "text", m.text, JSON.stringify(record));
      parent = id;
    }
    leaf.run(threadId, parent);
  };

  const image = (name, rgb) => {
    const path = join(attachments, `${name}.png`);
    writeFileSync(path, png(240, 240, rgb));
    return { kind: "image", path, mime: "image/png" };
  };
  const file = (name, mime, body) => {
    const path = join(attachments, name);
    writeFileSync(path, body);
    return { kind: "file", path, name, mime };
  };

  const { ids } = seeded;
  const now = Date.now();
  // Ara: links, media and files earlier, then today's exchange (4:53 PM).
  write(ids.ara.threadId, [
    { role: "user", at: now - 6 * DAY, text: "Peux-tu me donner les liens utiles pour la migration ?" },
    { role: "bot", at: now - 6 * DAY + 60_000, text: "Voici les références, en texte de remplacement :\n\n- [Guide de migration](https://docs.example.com/guides/migration/etapes-detaillees-pour-la-version-deux)\n- [Notes de version](https://example.org/releases/2026/notes-de-version-completes-octobre)\n- [Tableau de bord](https://status.example.net/dashboards/equipe/vue-d-ensemble-hebdomadaire)" },
    { role: "user", at: now - 4 * DAY, text: "Et les captures de l'écran d'accueil ?" },
    { role: "bot", at: now - 4 * DAY + 60_000, text: "Les deux captures de remplacement sont jointes.", attachments: [image("parity-media-1", [70, 90, 160]), image("parity-media-2", [150, 80, 60])] },
    { role: "bot", at: now - 3 * DAY, text: "Le plan et le tableau sont joints.", attachments: [
      file("plan-de-projet.pdf", "application/pdf", "%PDF-1.4\n% placeholder\n"),
      file("budget-trimestre.csv", "text/csv", "poste,montant\nexemple,0\n"),
      file("notes-reunion.txt", "text/plain", "Notes de remplacement.\n"),
    ] },
    { role: "user", at: today(16, 4), text: "Fais une sauvegarde du dossier de travail." },
    { role: "bot", at: today(16, 5), text: ARA_EARLIER },
    { role: "bot", at: today(16, 53), text: ARA_REPLY },
  ]);

  // Aurora: last message carries an attachment, 3:41 PM.
  write(ids.aurora.threadId, [
    { role: "user", at: today(15, 40), text: "Envoie-moi le budget." },
    { role: "bot", at: today(15, 41), text: PREVIEWS.aurora, attachments: [file("budget-q4.csv", "text/csv", "poste,montant\nexemple,0\n")] },
  ]);
  // Helix: yesterday.
  write(ids.helix.threadId, [
    { role: "user", at: now - DAY - 3_600_000, text: "Où en est le gabarit ?" },
    { role: "bot", at: now - DAY, text: PREVIEWS.helix },
  ]);
  write(ids.helios.threadId, [{ role: "bot", at: today(9, 12), text: PREVIEWS.helios }]);
  // Rigel spoke this afternoon: search lists it right after the group (19).
  write(ids.rigel.threadId, [{ role: "bot", at: today(16, 20), text: PREVIEWS.rigel }]);
  const older = ["liora", "keepler", "lux", "altair", "celeste", "orion", "sirius", "vera", "ciel"];
  older.forEach((key, index) => {
    write(ids[key].threadId, [
      { role: "user", at: now - (2 + index) * DAY - 600_000, text: "Un résumé, s'il te plaît." },
      { role: "bot", at: now - (2 + index) * DAY, text: PREVIEWS[key] },
    ]);
  });
  if (seeded.groupThreadId) {
    write(seeded.groupThreadId, [{ role: "bot", at: today(16, 30), text: "Réunion des gestionnaires déplacée à jeudi." }]);
  }
  db.close();
}

// ── pass two: pairing ───────────────────────────────────────────────────
async function pair(base) {
  const opened = await api(base, "POST", "/api/auth/pairing", { label: "parity-harness", scopes: ["admin", "client"] });
  const paired = await api(base, "POST", "/api/auth/pair", { code: opened.code, label: "Parity iPhone" });
  return { token: paired.token, environmentId: paired.environment?.environmentId ?? null, scopes: paired.session?.scopes ?? [] };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  try { rmSync(join(OUT, "session.json")); } catch { /* none yet */ }
  try { rmSync(join(OUT, "server.log")); } catch { /* none yet */ }
  home = mkdtempSync(join(tmpdir(), "omb-parity-"));
  const dataDir = join(home, ".openmausbot");
  mkdirSync(dataDir, { recursive: true });
  enterpriseStub = join(home, "enterprise-stub");
  writeEnterpriseStub(enterpriseStub);
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    profile: { name: "Parity Person", email: "parity@example.com" },
    budgets: { monthlyUsd: 100 },
    mcpServers: teamMcpServers(),
    instances: {
      claude: {
        driver: "claudeAgent",
        displayName: "Fixture engine",
        config: { cli: join(ROOT, "server", "testing", "fake-claude-cli.ts") },
      },
    },
  }));

  const { port, webhook } = await freePair();
  const base = `http://127.0.0.1:${port}`;
  console.error(`[parity] data ${home}`);
  console.error(`[parity] server ${base}`);

  child = startServer(port, webhook);
  await waitHealthy(base, child);
  const seeded = await seedThroughAPI(base);
  await stopServer(child);

  seedTranscripts(dataDir, seeded);
  seedCommandRules(dataDir, seeded);

  child = startServer(port, webhook);
  await waitHealthy(base, child);
  // Settings > Bot as in the reference: auto-review on, the zone automatic.
  await api(base, "PUT", "/api/settings/bot", {
    autoReviewDefault: true, timeZoneAuto: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).catch((error) => console.error(`[parity] bot settings: ${error.message}`));
  const session = await pair(base);
  const fleet = await fetch(`${base}/api/bots`, { headers: { authorization: `Bearer ${session.token}` } }).then((r) => r.json());
  const record = {
    endpoint: base,
    token: session.token,
    environmentId: session.environmentId,
    scopes: session.scopes,
    bots: (fleet.bots ?? []).length,
    pid: process.pid,
    dataDir,
  };
  writeFileSync(join(OUT, "session.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.error(`[parity] ready: ${record.bots} bots, session written to ios/parity/out/session.json`);
  console.log(JSON.stringify({ endpoint: base, environmentId: record.environmentId, bots: record.bots }));
  if (once) await shutdown(0);
}

async function shutdown(code) {
  await stopServer(child);
  if (home) rmSync(home, { recursive: true, force: true });
  try { rmSync(join(OUT, "session.json")); } catch { /* already gone */ }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
main().catch(async (error) => {
  console.error(`[parity] ${error.stack ?? error}`);
  await shutdown(1);
});
