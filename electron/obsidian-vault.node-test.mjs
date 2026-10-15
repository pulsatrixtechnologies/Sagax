// Settings > Memory > Open in Obsidian: the first click opens the folder as
// a vault. Every case runs on a temporary folder standing for Obsidian's
// settings, never the obsidian.json of the computer running the tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { isRegisteredVault, obsidianOpenUrl, obsidianRunning, openFolderInObsidian, registerVault } from "./obsidian-vault.mjs";

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-obsidian-"));
  const appData = path.join(base, "Application Support");
  const configDir = path.join(appData, "obsidian");
  const folder = path.join(appData, "sagax", "org-memory", "vault");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(folder, { recursive: true });
  const opened = [];
  const openUrl = async (url) => {
    opened.push(url);
  };
  return { base, appData, configDir, folder, opened, openUrl };
}

const config = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "obsidian.json"), "utf8"));

test("an unknown folder is not a vault: obsidian://open alone would answer Vault not found", () => {
  const { base, folder } = setup();
  try {
    assert.equal(isRegisteredVault({ vaults: { a: { path: "/Users/jc/Notes" } } }, folder), false);
    assert.equal(isRegisteredVault({ vaults: { a: { path: path.dirname(folder) } } }, folder), true);
    assert.equal(isRegisteredVault({ vaults: { a: { path: `${folder}-other` } } }, folder), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Obsidian closed: the folder is added to its vaults, every other setting kept, then opened", async () => {
  const { base, appData, configDir, folder, opened, openUrl } = setup();
  try {
    fs.writeFileSync(path.join(configDir, "obsidian.json"), JSON.stringify({ vaults: { abc: { path: "/Users/jc/Notes", ts: 1, open: true } }, frame: "hidden", cli: true }));
    const result = await openFolderInObsidian({ folder, appData, installed: () => true, openUrl, platform: "darwin", now: () => 42, id: () => "0123456789abcdef" });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(opened, [obsidianOpenUrl(folder)]);
    assert.deepEqual(config(configDir), {
      vaults: { abc: { path: "/Users/jc/Notes", ts: 1, open: true }, "0123456789abcdef": { path: folder, ts: 42, open: true } },
      frame: "hidden",
      cli: true,
    });
    // A second click finds it registered and writes nothing.
    const before = fs.readFileSync(path.join(configDir, "obsidian.json"), "utf8");
    assert.deepEqual(await openFolderInObsidian({ folder, appData, installed: () => true, openUrl, platform: "darwin" }), { ok: true });
    assert.equal(fs.readFileSync(path.join(configDir, "obsidian.json"), "utf8"), before);
    assert.equal(fs.readdirSync(configDir).filter((f) => f.endsWith(".tmp")).length, 0);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Obsidian never started: its settings file is created with the vault", async () => {
  const { base, appData, folder, configDir, opened, openUrl } = setup();
  try {
    assert.equal(registerVault(configDir, folder, { id: () => "ffffffffffffffff", now: () => 7 }), true);
    assert.deepEqual(config(configDir), { vaults: { ffffffffffffffff: { path: folder, ts: 7, open: true } } });
    assert.deepEqual(await openFolderInObsidian({ folder, appData, installed: () => true, openUrl, platform: "darwin" }), { ok: true });
    assert.deepEqual(opened, [obsidianOpenUrl(folder)]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Obsidian running: its settings are left alone and its vault chooser opens", async () => {
  const { base, appData, configDir, folder, opened, openUrl } = setup();
  try {
    const original = JSON.stringify({ vaults: { abc: { path: "/Users/jc/Notes", ts: 1 } } });
    fs.writeFileSync(path.join(configDir, "obsidian.json"), original);
    fs.symlinkSync("host.local-4242", path.join(configDir, "SingletonLock"));
    const alive = (pid) => pid === 4242;
    assert.equal(obsidianRunning(configDir, { platform: "darwin", alive }), true);
    const result = await openFolderInObsidian({ folder, appData, installed: () => true, openUrl, platform: "darwin", alive });
    assert.deepEqual(result, { ok: false, reason: "add_vault" });
    assert.deepEqual(opened, ["obsidian://choose-vault"]);
    assert.equal(fs.readFileSync(path.join(configDir, "obsidian.json"), "utf8"), original);
    // A lock left by a crash (dead process) does not count.
    assert.equal(obsidianRunning(configDir, { platform: "darwin", alive: () => false }), false);
    // Windows: never written (no lock to read).
    assert.equal(obsidianRunning(configDir, { platform: "win32" }), true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("an unreadable obsidian.json is never overwritten", async () => {
  const { base, appData, configDir, folder, opened, openUrl } = setup();
  try {
    fs.writeFileSync(path.join(configDir, "obsidian.json"), "{not json");
    const result = await openFolderInObsidian({ folder, appData, installed: () => true, openUrl, platform: "darwin" });
    assert.deepEqual(result, { ok: false, reason: "add_vault" });
    assert.equal(fs.readFileSync(path.join(configDir, "obsidian.json"), "utf8"), "{not json");
    assert.deepEqual(opened, ["obsidian://choose-vault"]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Obsidian not installed, or the link fails: a reason the page says in its own words", async () => {
  const { base, appData, folder, openUrl } = setup();
  try {
    assert.deepEqual(await openFolderInObsidian({ folder, appData, installed: () => false, openUrl, platform: "darwin" }), { ok: false, reason: "not_installed" });
    const failing = async () => {
      throw new Error("no handler");
    };
    assert.deepEqual(await openFolderInObsidian({ folder, appData, installed: () => true, openUrl: failing, platform: "darwin" }), { ok: false, reason: "failed" });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
