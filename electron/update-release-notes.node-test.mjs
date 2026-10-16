// Release notes before an update, from what GitHub really served for
// pulsa-v0.5.4 (fixtures/update-feed: releases.atom cut to three entries,
// the published latest-mac.yml, the API's release JSON). On 0.5.3 the
// vendored electron-updater read "pulsa-v0.5.4" as the version of every
// atom entry, which is not semver, and returned no notes at all.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { embedReleaseNotes } from "../scripts/embed-feed-release-notes.mjs";
import { configureUpdateFeed, fetchReleaseNotes, releaseApiUrl } from "./update-feed.mjs";

const require = createRequire(import.meta.url);
const fixture = (name) => readFileSync(new URL(`./fixtures/update-feed/${name}`, import.meta.url), "utf8");
const ATOM = fixture("releases.atom");
const FEED = fixture("latest-mac-0.5.4.yml");
const RELEASE = JSON.parse(fixture("release-pulsa-v0.5.4.json"));
// A Windows checkout may hand the notes over with CRLF; the YAML feed carries LF.
const NOTES = readFileSync(new URL("../docs/releases/0.5.4.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const RELEASES = "https://github.com/pulsatrixtechnologies/sagax/releases";

function loadUpdater() {
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === "electron") return {};
    return original.call(this, request, ...rest);
  };
  try {
    return require("./vendor/electron-updater.cjs");
  } finally {
    Module._load = original;
  }
}

async function check(feed) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-update-notes-"));
  try {
    const { AppUpdater } = loadUpdater();
    const updater = new AppUpdater(null, {
      version: "0.5.3",
      name: "Sagax",
      isPackaged: true,
      appUpdateConfigPath: join(dir, "app-update.yml"),
      userDataPath: dir,
      baseCachePath: dir,
      whenReady: () => Promise.resolve(),
      onQuit() {},
      quit() {},
      relaunch() {},
    });
    updater.logger = null;
    updater.autoDownload = false;
    updater.httpExecutor = {
      async request(options) {
        const url = `${options.protocol}//${options.hostname}${options.path}`;
        if (url === `${RELEASES}.atom`) return ATOM;
        if (url === `${RELEASES}/latest`) return JSON.stringify({ tag_name: "pulsa-v0.5.4" });
        // electron-updater names the channel file after the runner's platform
        // (latest-mac.yml, latest-linux.yml, latest.yml): CI runs this on Linux.
        const download = `${RELEASES}/download/pulsa-v0.5.4/`;
        if (url.startsWith(download) && /^latest(-[a-z0-9-]+)?\.yml$/.test(url.slice(download.length))) return feed;
        throw new Error(`unexpected request ${url}`);
      },
    };
    configureUpdateFeed(updater);
    // As electron/updater.mjs sets it.
    updater.fullChangelog = true;
    const result = await updater.checkForUpdates();
    assert.equal(result.updateInfo.version, "0.5.4");
    return result.updateInfo.releaseNotes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("0.5.3 to 0.5.4 as published: the atom feed's notes reach the app (pulsa-v tags)", async () => {
  const notes = await check(FEED);
  assert.ok(Array.isArray(notes), `no notes from the feed: ${JSON.stringify(notes)}`);
  assert.deepEqual(notes.map((entry) => entry.version), ["0.5.4"]);
  assert.match(notes[0].note, /Sagax 0\.5\.4 poursuit la simplification/);
  assert.match(notes[0].note, /<h2>English<\/h2>/);
});

test("notes written into latest-mac.yml arrive with the update as the release markdown", async () => {
  const notes = await check(embedReleaseNotes(FEED, NOTES));
  assert.equal(notes, NOTES.trim());
});

test("the fallback reads our release body from GitHub's public API", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => RELEASE };
  };
  assert.equal(await fetchReleaseNotes("0.5.4", { fetch }), RELEASE.body.trim());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/pulsatrixtechnologies/sagax/releases/tags/pulsa-v0.5.4");
  assert.equal(calls[0].url, releaseApiUrl("0.5.4"));
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("the fallback never asks for anything but a version and never fails the update", async () => {
  let asked = 0;
  const answer = (value) => async () => {
    asked += 1;
    return value;
  };
  for (const version of ["", "latest", "../../x", "0.5", null, "0.5.4/../../evil"]) {
    assert.equal(await fetchReleaseNotes(version, { fetch: answer({ ok: true, json: async () => RELEASE }) }), null);
  }
  assert.equal(asked, 0);
  assert.equal(await fetchReleaseNotes("0.5.4", { fetch: answer({ ok: false, json: async () => RELEASE }) }), null);
  assert.equal(await fetchReleaseNotes("0.5.4", { fetch: answer({ ok: true, json: async () => ({ ...RELEASE, tag_name: "pulsa-v0.5.3" }) }) }), null);
  assert.equal(await fetchReleaseNotes("0.5.4", { fetch: answer({ ok: true, json: async () => ({ ...RELEASE, draft: true }) }) }), null);
  assert.equal(await fetchReleaseNotes("0.5.4", { fetch: answer({ ok: true, json: async () => ({ ...RELEASE, body: "  " }) }) }), null);
  assert.equal(await fetchReleaseNotes("0.5.4", { fetch: async () => { throw new Error("offline"); } }), null);
});
