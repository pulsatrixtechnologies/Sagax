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
  normalizeServer,
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
  const fetch = async (url, init) => {
    calls.push({ url, authorization: init?.headers?.authorization });
    if (refuse) return { status: 401, ok: false, json: async () => ({}) };
    if (url.endsWith("/api/v1/memory/sync/tiers")) {
      return { status: 200, ok: true, json: async () => ({ enabled: true, tiers }) };
    }
    if (url.endsWith("/api/v1/memory/sync/pending")) {
      return { status: 200, ok: true, json: async () => ({ pending: 1, items: [{ id: "01k9", tier: "org", title: "Onboarding", state: "pending", path: "org/_pending/01k9.md" }] }) };
    }
    return { status: 404, ok: false, json: async () => ({}) };
  };
  return { fetch, calls, refuse: () => { refuse = true; } };
}

const encrypt = (text) => Buffer.from(`enc:${text}`);
const decrypt = (data) => String(data).replace(/^enc:/, "");

test("cloud folders are refused, Application Support is not", () => {
  assert.equal(cloudFolderReason("/Users/jc/Library/Mobile Documents/com~apple~CloudDocs/x"), "iCloud Drive");
  assert.equal(cloudFolderReason("/Users/jc/Library/CloudStorage/OneDrive-GOX/x"), "a cloud storage folder");
  assert.equal(cloudFolderReason("C:\\Users\\jc\\OneDrive - GOX\\x"), "OneDrive");
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
