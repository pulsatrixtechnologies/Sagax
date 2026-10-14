// The local cache of the organization memory (Settings > Memory): the clone
// lifecycle with a real git against bare repositories that stand for the
// Perspicax tiers, a fake Perspicax for the JSON routes.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  cloudFolderReason,
  createOrgMemoryCache,
  excludeFromBackup,
  isGenerated,
  mintOutcome,
  normalizeServer,
  RENEW_BEFORE_MS,
  obsidianUrl,
  writeObsidianConfig,
} from "./org-memory-cache.mjs";

const TOKEN = "pxat1.abcdefghijklmnopqrstuvwxyz012345";

function run(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...env },
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const gitIdentity = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.test" };

async function bareTier(base, name, files) {
  const bare = path.join(base, "server", `${name}.git`);
  const seed = path.join(base, "seed", name);
  fs.mkdirSync(seed, { recursive: true });
  assert.equal((await run("git", ["init", "--bare", "-q", "-b", "main", bare])).code, 0);
  assert.equal((await run("git", ["init", "-q", "-b", "main", seed])).code, 0);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
    fs.writeFileSync(path.join(seed, file), text);
  }
  await run("git", ["add", "-A"], { cwd: seed, env: gitIdentity });
  await run("git", ["commit", "-q", "-m", "server"], { cwd: seed, env: gitIdentity });
  assert.equal((await run("git", ["push", "-q", bare, "HEAD:main"], { cwd: seed })).code, 0);
  return bare;
}

function fakePerspicax(tiers) {
  const calls = [];
  let refuse = false;
  // Tokens Perspicax still honours (null: any); revoked ones answer 401.
  let live = null;
  const fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", authorization: init?.headers?.authorization });
    const token = String(init?.headers?.authorization ?? "").replace(/^Bearer /, "");
    if (init?.method === "DELETE" && url.endsWith("/api/v1/memory/sync/token")) {
      live?.delete(token);
      return { status: 200, ok: true, json: async () => ({ revoked: 1 }) };
    }
    if (refuse || (live && !live.has(token))) return { status: 401, ok: false, json: async () => ({}) };
    if (url.endsWith("/api/v1/memory/sync/tiers")) {
      return { status: 200, ok: true, json: async () => ({ enabled: true, tiers }) };
    }
    if (url.endsWith("/api/v1/memory/sync/pending")) {
      return { status: 200, ok: true, json: async () => ({ pending: 1, items: [{ id: "01k9", tier: "org", title: "Onboarding", state: "pending", path: "org/_pending/01k9.md" }] }) };
    }
    return { status: 404, ok: false, json: async () => ({}) };
  };
  return {
    fetch, calls,
    refuse: () => { refuse = true; },
    /** Only these tokens are live from now on (a rotation elsewhere). */
    only: (tokens) => { live = new Set(tokens); },
  };
}

/** The organization server's /api/me/memory-sync-token, as the person
 * signed in there. Each POST mints a new token (and revokes the last). */
function fakeOrgServer(perspicax, { person = "pr_alice", server = "https://px.example.test" } = {}) {
  let n = 0;
  const calls = [];
  let answer = null;
  let who = person;
  const orgServer = async (method) => {
    calls.push(method);
    if (answer) return answer(method);
    if (method === "GET") return { status: 200, body: { person: who } };
    n += 1;
    const token = `pxat1.minted${String(n).padStart(4, "0")}abcdefghijklmnop`;
    perspicax.only([token]);
    return { status: 200, body: { server, token, expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString() } };
  };
  return {
    orgServer, calls,
    minted: () => n,
    token: (i = n) => `pxat1.minted${String(i).padStart(4, "0")}abcdefghijklmnop`,
    answer: (fn) => { answer = fn; },
    signIn: (next) => { who = next; },
  };
}

const encrypt = (text) => Buffer.from(`enc:${text}`);
const decrypt = (data) => String(data).replace(/^enc:/, "");

test("cloud folders are refused, Application Support is not", () => {
  assert.equal(cloudFolderReason("/Users/jc/Library/Mobile Documents/com~apple~CloudDocs/x"), "iCloud Drive");
  assert.equal(cloudFolderReason("/Users/jc/Library/CloudStorage/OneDrive-Example/x"), "a cloud storage folder");
  assert.equal(cloudFolderReason("C:\\Users\\jc\\OneDrive - Example\\x"), "OneDrive");
  assert.equal(cloudFolderReason("/Users/jc/Library/Application Support/sagax/org-memory/vault"), null);
});

test("addresses, generated paths and the Obsidian link", () => {
  assert.equal(normalizeServer("https://px.example.com/console"), "https://px.example.com");
  assert.equal(normalizeServer("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.throws(() => normalizeServer("http://px.example.com"));
  assert.throws(() => normalizeServer("https://u:p@px.example.com"));
  assert.ok(isGenerated("MEMORY.md") && isGenerated("_pending/x.md") && isGenerated(".gitignore"));
  assert.ok(!isGenerated("vpn/x.md"));
  assert.equal(obsidianUrl("/a b/vault"), "obsidian://open?path=%2Fa%20b%2Fvault");
});

test("the recommended .obsidian turns off sync and publish", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-obsidian-"));
  try {
    assert.equal(writeObsidianConfig(dir), true);
    const core = JSON.parse(fs.readFileSync(path.join(dir, ".obsidian", "core-plugins.json"), "utf8"));
    assert.equal(core.sync, false);
    assert.equal(core.publish, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, ".obsidian", "community-plugins.json"), "utf8")), []);
    assert.equal(writeObsidianConfig(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Time Machine exclusion is the sticky attribute on macOS only", async () => {
  const seen = [];
  const fake = async (cmd, args) => { seen.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  assert.equal(await excludeFromBackup("/x", { platform: "darwin", run: fake }), true);
  assert.deepEqual(seen[0], ["xattr", "-w", "com.apple.metadata:com_apple_backup_excludeItem", "com.apple.backupd", "/x"]);
  assert.equal(await excludeFromBackup("/x", { platform: "win32", run: fake }), false);
  assert.equal(seen.length, 1);
});

test("connect, clone, push a change, show pending, erase", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-orgmem-"));
  try {
    const me = await bareTier(base, "me", { "vpn/01k7.md": "---\nschema: 1\n---\nLe VPN passe par le primaire.\n", "MEMORY.md": "# Me\n", ".gitignore": ".obsidian/\n" });
    const org = await bareTier(base, "org", { "glossaire/01k8.md": "PSA veut dire Manage.\n", "MEMORY.md": "# Org\n" });
    const perspicax = fakePerspicax([
      { name: "me", label: "Moi", push: "direct", url: `file://${me}` },
      { name: "org", label: "Organisation", push: "review", url: `file://${org}` },
    ]);
    const userData = path.join(base, "userData");
    const xattrs = [];
    const cache = createOrgMemoryCache({
      userData,
      platform: "darwin",
      run: async (cmd, args, opts) => (cmd === "xattr" ? (xattrs.push(args), { code: 0, stdout: "", stderr: "" }) : run(cmd, args, opts)),
      fetch: perspicax.fetch,
      encrypt,
      decrypt,
    });
    assert.equal(cache.state().connected, false);
    await assert.rejects(cache.connect({ server: "https://px.example.test", token: "nope" }), /pxat1/);
    const connected = await cache.connect({ server: "https://px.example.test/", token: TOKEN });
    assert.equal(connected.connected, true);
    assert.equal(connected.server, "https://px.example.test");
    // The token is kept encrypted and never in the state.
    assert.ok(!fs.readFileSync(path.join(cache.root, "state.json"), "utf8").includes(TOKEN));
    assert.ok(String(fs.readFileSync(path.join(cache.root, "token.bin"))).startsWith("enc:"));
    assert.equal(perspicax.calls[0].authorization, `Bearer ${TOKEN}`);

    let state = await cache.sync();
    assert.deepEqual(state.tiers.map((t) => [t.name, t.status]), [["me", "cloned"], ["org", "cloned"]]);
    assert.equal(state.pendingCount, 1);
    assert.equal(state.pending[0].path, "org/_pending/01k9.md");
    assert.ok(fs.existsSync(path.join(cache.vault, "me", "vpn", "01k7.md")));
    // Time Machine skips the cache, set once when the vault is created.
    assert.deepEqual(xattrs, [["-w", "com.apple.metadata:com_apple_backup_excludeItem", "com.apple.backupd", cache.root]]);
    // The token is not in the clone's configuration.
    assert.ok(!fs.readFileSync(path.join(cache.vault, "me", ".git", "config"), "utf8").includes(TOKEN));

    // A line changed in Obsidian goes up; an edit of MEMORY.md is restored.
    const file = path.join(cache.vault, "me", "vpn", "01k7.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("primaire", "secondaire"));
    fs.writeFileSync(path.join(cache.vault, "me", "MEMORY.md"), "# edited by hand\n");
    state = await cache.sync();
    const meTier = state.tiers.find((t) => t.name === "me");
    assert.equal(meTier.status, "pushed");
    assert.ok(meTier.messages.some((m) => m.includes("MEMORY.md")));
    const log = await run("git", ["--git-dir", me, "show", "main:vpn/01k7.md"]);
    assert.match(log.stdout, /secondaire/);
    assert.equal((await run("git", ["--git-dir", me, "show", "main:MEMORY.md"])).stdout, "# Me\n");
    assert.equal(state.tiers.find((t) => t.name === "org").status, "up-to-date");

    // Obsidian: the recommended folder and the link.
    assert.equal(cache.writeObsidianConfig(), true);
    assert.equal(cache.state().obsidianConfigured, true);
    assert.ok(cache.state().obsidianUrl.startsWith("obsidian://open?path="));

    // Erase: the vault, the token and the state go.
    state = await cache.erase();
    assert.equal(state.connected, false);
    assert.equal(fs.existsSync(cache.vault), false);
    assert.equal(fs.existsSync(path.join(cache.root, "token.bin")), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a token Perspicax refuses erases the cache (access ended)", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-orgmem-"));
  try {
    const me = await bareTier(base, "me", { "vpn/01k7.md": "Une note.\n" });
    const perspicax = fakePerspicax([{ name: "me", label: "Moi", push: "direct", url: `file://${me}` }]);
    const cache = createOrgMemoryCache({ userData: path.join(base, "userData"), platform: "linux", run, fetch: perspicax.fetch, encrypt, decrypt });
    await cache.connect({ server: "https://px.example.test", token: TOKEN });
    await cache.sync();
    assert.ok(fs.existsSync(path.join(cache.vault, "me", "vpn", "01k7.md")));
    perspicax.refuse();
    const state = await cache.sync();
    assert.equal(fs.existsSync(cache.vault), false);
    assert.equal(state.connected, false);
    assert.match(state.lastError, /refused/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a vault inside a cloud folder is refused before anything is written", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-orgmem-"));
  try {
    const userData = path.join(base, "Library", "Mobile Documents", "sagax");
    const cache = createOrgMemoryCache({ userData, run, fetch: fakePerspicax([]).fetch, encrypt, decrypt });
    await assert.rejects(cache.connect({ server: "https://px.example.test", token: TOKEN }), /iCloud Drive/);
    assert.equal(fs.existsSync(userData), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the answer of the organization server becomes an outcome, never echoed", () => {
  assert.deepEqual(mintOutcome(200, { server: "https://px.example.test", token: TOKEN, expiresAt: "2027-01-01T00:00:00Z" }), { ok: true, token: TOKEN, server: "https://px.example.test", expiresAt: Date.parse("2027-01-01T00:00:00Z") });
  assert.deepEqual(mintOutcome(200, { server: "https://px.example.test", token: "nope" }), { ok: false, code: "unreachable" });
  assert.deepEqual(mintOutcome(401, {}), { ok: false, code: "signed_out", ended: true });
  assert.deepEqual(mintOutcome(403, { code: "not_member" }), { ok: false, code: "not_member", ended: true });
  assert.deepEqual(mintOutcome(403, { code: "identity_perspicax" }), { ok: false, code: "no_org" });
  assert.deepEqual(mintOutcome(404, { code: "unsupported" }), { ok: false, code: "unsupported" });
  assert.deepEqual(mintOutcome(502, {}), { ok: false, code: "unreachable" });
});

test("auto: sets itself up from the organization server, renews, and leaves with the person", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-orgmem-"));
  try {
    const me = await bareTier(base, "me", { "vpn/01k7.md": "Une note.\n" });
    const perspicax = fakePerspicax([{ name: "me", label: "Moi", push: "direct", url: `file://${me}` }]);
    const org = fakeOrgServer(perspicax);
    let clock = Date.now();
    let source = "https://sagax.example.test";
    const cache = createOrgMemoryCache({ userData: path.join(base, "userData"), platform: "linux", run, fetch: perspicax.fetch, encrypt, decrypt, orgServer: org.orgServer, source: () => source, now: () => clock });

    // First run: no form, no token typed; the person's own token is minted.
    let state = await cache.auto();
    assert.equal(state.connected, true);
    assert.equal(state.mode, "auto");
    assert.equal(state.server, "https://px.example.test");
    assert.equal(state.person, "pr_alice");
    assert.equal(state.autoError, null);
    assert.ok(fs.existsSync(path.join(cache.vault, "me", "vpn", "01k7.md")));
    assert.equal(org.minted(), 1);
    // The token is in no state the page reads, nor in the state file.
    assert.ok(!JSON.stringify(state).includes("pxat1."));
    assert.ok(!fs.readFileSync(path.join(cache.root, "state.json"), "utf8").includes("pxat1."));

    // Again: the kept token serves, nothing is minted.
    await cache.auto();
    assert.equal(org.minted(), 1);

    // Close to its end: renewed.
    clock += 90 * 86400_000 - RENEW_BEFORE_MS + 1;
    await cache.auto();
    assert.equal(org.minted(), 2);

    // Rotated by another computer of the person: a new one, the copy stays.
    perspicax.only(["pxat1.elsewhere000000000000000000"]);
    state = await cache.auto();
    assert.equal(org.minted(), 3);
    assert.equal(state.connected, true);
    assert.ok(fs.existsSync(path.join(cache.vault, "me", "vpn", "01k7.md")));

    // Another person signs in on the same server: the old copy is revoked and erased first.
    org.signIn("pr_bob");
    const before = perspicax.calls.filter((c) => c.method === "DELETE").length;
    state = await cache.auto();
    assert.equal(state.person, "pr_bob");
    assert.equal(perspicax.calls.filter((c) => c.method === "DELETE").length, before + 1);

    // Out of the organization: the copy is revoked and erased, the reason kept.
    org.answer((method) => (method === "GET" ? { status: 403, body: { code: "not_member" } } : { status: 403, body: { code: "not_member" } }));
    state = await cache.auto();
    assert.equal(state.connected, false);
    assert.equal(fs.existsSync(cache.vault), false);
    assert.equal(state.autoError, "not_member");
    assert.equal(perspicax.calls.filter((c) => c.method === "DELETE").length, before + 2);

    // Signed in again, then the server is forgotten: revoked and erased.
    org.answer(null);
    org.signIn("pr_alice");
    state = await cache.auto();
    assert.equal(state.connected, true);
    state = await cache.forgetSource("https://other.example.test");
    assert.equal(state.connected, true);
    state = await cache.forgetSource(source);
    assert.equal(state.connected, false);
    assert.equal(fs.existsSync(cache.vault), false);
    source = null;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("auto: a failure keeps the copy and says why; an older Perspicax keeps a hand-made connection", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-orgmem-"));
  try {
    const me = await bareTier(base, "me", { "vpn/01k7.md": "Une note.\n" });
    const perspicax = fakePerspicax([{ name: "me", label: "Moi", push: "direct", url: `file://${me}` }]);
    const org = fakeOrgServer(perspicax);
    const cache = createOrgMemoryCache({ userData: path.join(base, "userData"), platform: "linux", run, fetch: perspicax.fetch, encrypt, decrypt, orgServer: org.orgServer, source: () => "https://sagax.example.test" });

    // Unreachable before anything is set up: a code, no copy, no throw.
    org.answer(() => { throw new Error("offline"); });
    let state = await cache.auto();
    assert.equal(state.connected, false);
    assert.equal(state.autoError, "unreachable");

    // Perspicax older than 1.8.27: unsupported, and nothing to fill in.
    org.answer((method) => (method === "GET" ? { status: 200, body: { person: "pr_alice" } } : { status: 404, body: { code: "unsupported" } }));
    state = await cache.auto();
    assert.equal(state.autoError, "unsupported");

    // A connection made by hand before (the old form) keeps syncing there.
    await cache.connect({ server: "https://px.example.test", token: TOKEN });
    state = await cache.auto();
    assert.equal(state.connected, true);
    assert.equal(state.autoError, null);
    assert.ok(fs.existsSync(path.join(cache.vault, "me", "vpn", "01k7.md")));

    // Then the server is upgraded: the hand-made token is replaced by the person's own.
    org.answer(null);
    state = await cache.auto();
    assert.equal(state.mode, "auto");
    assert.equal(org.minted(), 1);
    assert.ok(fs.existsSync(path.join(cache.vault, "me", "vpn", "01k7.md")));

    // The server is down while a copy is here: it says so and keeps the copy.
    org.answer(() => ({ status: 502, body: { code: "unreachable" } }));
    perspicax.only([]);
    state = await cache.auto();
    assert.equal(state.connected, true);
    assert.equal(state.autoError, "unreachable");
    assert.ok(fs.existsSync(path.join(cache.vault, "me", "vpn", "01k7.md")));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
