import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appLink,
  bridgeLegacyEnv,
  defaultDataDir,
  ENV_BRIDGED_MARKER,
  fetchEnvironmentDescriptor,
  hasTokenPrefix,
  HEALTH_IDENTITY,
  isAppLink,
  isAppProtocol,
  isOwnHealth,
  legacyEnvName,
  migrateLegacyDir,
  MIGRATION_BREADCRUMB,
  readEnv,
  settingOfLegacyEnv,
} from "./legacy-names.mjs";

const roots = [];
function tempHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-legacy-names-"));
  roots.push(root);
  return root;
}
test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

// ── environment ──

test("legacyEnvName maps each setting to the old variable that carried it", () => {
  assert.equal(legacyEnvName("DATA_DIR"), "OMB_DATA_DIR");
  assert.equal(legacyEnvName("URL"), "OPENMAUSBOT_URL");
  assert.equal(legacyEnvName("LOCAL_UNSLOTH_API_KEY"), "OPENMAUSBOT_LOCAL_UNSLOTH_API_KEY");
  assert.equal(legacyEnvName("ACP_INIT_TIMEOUT_MS"), "OPENMAUS_ACP_INIT_TIMEOUT_MS");
  assert.equal(settingOfLegacyEnv("OMB_PORT"), "PORT");
  assert.equal(settingOfLegacyEnv("OPENMAUSBOT_TOKEN"), "TOKEN");
  assert.equal(settingOfLegacyEnv("OMB_URL"), null, "URL's old name is OPENMAUSBOT_URL");
  assert.equal(settingOfLegacyEnv("PATH"), null);
});

test("readEnv prefers SAGAX_ and falls back to the old name", () => {
  assert.equal(readEnv("PORT", { SAGAX_PORT: "1", OMB_PORT: "2" }), "1");
  assert.equal(readEnv("PORT", { OMB_PORT: "2" }), "2");
  assert.equal(readEnv("PORT", { SAGAX_PORT: "" , OMB_PORT: "2" }), "", "an empty new value still wins");
  assert.equal(readEnv("URL", { OPENMAUSBOT_URL: "http://x" }), "http://x");
  assert.equal(readEnv("PORT", {}), undefined);
});

test("bridgeLegacyEnv moves the old names onto SAGAX_ and warns once about them", () => {
  const env = { SAGAX_DATA_DIR: "/new", OMB_DATA_DIR: "/old", OMB_PORT: "9", OPENMAUSBOT_TOKEN: "t", OPENMAUS_ACP_INIT_TIMEOUT_MS: "5", PATH: "/bin" };
  const lines = [];
  const used = bridgeLegacyEnv(env, { warn: (line) => lines.push(line) });
  assert.deepEqual(used, ["OMB_PORT", "OPENMAUSBOT_TOKEN", "OPENMAUS_ACP_INIT_TIMEOUT_MS"], "OMB_DATA_DIR had a SAGAX_ value, so it was not the one used");
  assert.equal(env.SAGAX_DATA_DIR, "/new", "the new name wins");
  assert.equal(env.SAGAX_PORT, "9");
  assert.equal(env.SAGAX_TOKEN, "t");
  assert.equal(env.SAGAX_ACP_INIT_TIMEOUT_MS, "5");
  for (const old of ["OMB_DATA_DIR", "OMB_PORT", "OPENMAUSBOT_TOKEN", "OPENMAUS_ACP_INIT_TIMEOUT_MS"]) {
    assert.equal(env[old], undefined, `${old}: one authoritative name for children`);
  }
  assert.equal(env.PATH, "/bin");
  assert.equal(env[ENV_BRIDGED_MARKER], "1");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /OMB_PORT, OPENMAUSBOT_TOKEN, OPENMAUS_ACP_INIT_TIMEOUT_MS/);
});

test("bridgeLegacyEnv leaves SAGAX_ names alone and a bridged child silent", () => {
  const env = { SAGAX_SANDBOX_IMAGE: "img", SAGAX_DEFAULT_SERVER: "https://s", OMB_PORT: "9", [ENV_BRIDGED_MARKER]: "1" };
  const lines = [];
  bridgeLegacyEnv(env, { warn: (line) => lines.push(line) });
  assert.equal(env.SAGAX_SANDBOX_IMAGE, "img");
  assert.equal(env.SAGAX_DEFAULT_SERVER, "https://s");
  assert.equal(env.SAGAX_PORT, "9");
  assert.equal(env.OMB_PORT, undefined);
  assert.deepEqual(lines, [], "the parent already warned");
});

test("bridgeLegacyEnv leaves internal capabilities where they are", () => {
  const lines = [];
  const env = { OPENMAUSBOT_INTERNAL_DATA_DIR_LEASE: "v1:1:x" };
  bridgeLegacyEnv(env, { warn: (line) => lines.push(line) });
  assert.equal(env.OPENMAUSBOT_INTERNAL_DATA_DIR_LEASE, "v1:1:x", "the lease keeps its name (data-dir-lease.mjs)");
  assert.deepEqual(lines, []);
});

// ── data folders ──

function fakeOldFolder(home) {
  const legacy = path.join(home, ".openmausbot");
  fs.mkdirSync(path.join(legacy, "events"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "config.json"), '{"bots":["kept"]}\n');
  fs.writeFileSync(path.join(legacy, "events", "a.jsonl"), "x\n");
  return legacy;
}

test("defaultDataDir moves ~/.openmausbot to ~/.sagax once, with a breadcrumb and a link back", () => {
  const home = tempHome();
  const legacy = fakeOldFolder(home);
  const lines = [];
  const dir = defaultDataDir({ home, log: (line) => lines.push(line), isBusy: () => false });
  assert.equal(dir, path.join(home, ".sagax"));
  assert.equal(fs.readFileSync(path.join(dir, "config.json"), "utf8"), '{"bots":["kept"]}\n');
  assert.equal(fs.readFileSync(path.join(dir, "events", "a.jsonl"), "utf8"), "x\n");
  const crumb = JSON.parse(fs.readFileSync(path.join(dir, MIGRATION_BREADCRUMB), "utf8"));
  assert.equal(crumb.from, legacy);
  assert.equal(crumb.to, dir);
  assert.ok(fs.lstatSync(legacy).isSymbolicLink(), "the old path links to the new folder");
  assert.equal(fs.readFileSync(path.join(legacy, "config.json"), "utf8"), '{"bots":["kept"]}\n');
  assert.equal(fs.existsSync(`${dir}.migrating.lock`), false);
  // a second start finds ~/.sagax and does nothing
  assert.equal(defaultDataDir({ home, log: (line) => lines.push(line), isBusy: () => assert.fail("not asked") }), dir);
  assert.equal(lines.filter((line) => line.includes("moved")).length, 1);
});

test("defaultDataDir keeps using ~/.openmausbot while a running copy holds its lease", () => {
  const home = tempHome();
  const legacy = fakeOldFolder(home);
  const dir = defaultDataDir({ home, log: () => {}, isBusy: (folder) => folder === legacy });
  assert.equal(dir, legacy);
  assert.equal(fs.existsSync(path.join(home, ".sagax")), false, "no empty folder that would hide the data");
  assert.ok(fs.lstatSync(legacy).isDirectory());
});

test("defaultDataDir with a real lease from this live process skips the move", async () => {
  const home = tempHome();
  const legacy = fakeOldFolder(home);
  const { acquireDataDirLease } = await import("./data-dir-lease.mjs");
  const lease = acquireDataDirLease(legacy);
  try {
    assert.equal(defaultDataDir({ home, log: () => {} }), legacy);
  } finally {
    lease.release();
  }
  assert.equal(defaultDataDir({ home, log: () => {} }), path.join(home, ".sagax"), "moved once the lease is released");
});

test("defaultDataDir without migrate reports the folder in use and moves nothing", () => {
  const home = tempHome();
  assert.equal(defaultDataDir({ home, migrate: false }), path.join(home, ".sagax"));
  const legacy = fakeOldFolder(home);
  assert.equal(defaultDataDir({ home, migrate: false }), legacy);
  assert.ok(fs.lstatSync(legacy).isDirectory());
});

test("a failed rename leaves the old folder untouched and in use", () => {
  const home = tempHome();
  const legacy = fakeOldFolder(home);
  const failing = { ...fs, renameSync: () => { throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); } };
  const dir = defaultDataDir({ home, fs: failing, log: () => {}, isBusy: () => false });
  assert.equal(dir, legacy);
  assert.equal(fs.readFileSync(path.join(legacy, "config.json"), "utf8"), '{"bots":["kept"]}\n');
  assert.equal(fs.existsSync(path.join(home, ".sagax")), false);
});

test("migrateLegacyDir waits for a live lock, then finds the move done", () => {
  const home = tempHome();
  const target = path.join(home, ".sagax");
  const legacy = fakeOldFolder(home);
  fs.writeFileSync(`${target}.migrating.lock`, String(process.pid));
  let clock = 0;
  const now = () => clock;
  const slowFs = {
    ...fs,
    openSync: (...args) => {
      clock += 1;
      // the other process finishes on our third try
      if (clock === 3) {
        fs.renameSync(legacy, target);
        fs.unlinkSync(`${target}.migrating.lock`);
      }
      return fs.openSync(...args);
    },
  };
  assert.equal(migrateLegacyDir({ target, legacy, fs: slowFs, now, timeoutMs: 100 }), "exists");
  assert.ok(fs.existsSync(path.join(target, "config.json")));
});

test("migrateLegacyDir ignores a link left by an earlier move", () => {
  const home = tempHome();
  const elsewhere = path.join(home, "elsewhere");
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(home, ".openmausbot"));
  assert.equal(migrateLegacyDir({ target: path.join(home, ".sagax"), legacy: path.join(home, ".openmausbot") }), "none");
});

// ── well-known, scheme, tokens, health ──

test("fetchEnvironmentDescriptor tries the new path, then the old one on a 404 only", async () => {
  const asked = [];
  const reply = (status) => async (url) => { asked.push(url); return { status }; };
  await fetchEnvironmentDescriptor("https://s.example/", {}, reply(200));
  assert.deepEqual(asked, ["https://s.example/.well-known/sagax/environment"]);
  asked.length = 0;
  let first = true;
  await fetchEnvironmentDescriptor("https://s.example", {}, async (url) => { asked.push(url); const status = first ? 404 : 200; first = false; return { status }; });
  assert.deepEqual(asked, ["https://s.example/.well-known/sagax/environment", "https://s.example/.well-known/openmausbot/environment"]);
  asked.length = 0;
  const response = await fetchEnvironmentDescriptor("https://s.example", {}, reply(500));
  assert.equal(response.status, 500, "a server error is not a reason to try the old path");
  assert.equal(asked.length, 1);
});

test("both schemes are this app's; new links use sagax://", () => {
  assert.equal(isAppProtocol("sagax:"), true);
  assert.equal(isAppProtocol("openmausbot:"), true);
  assert.equal(isAppProtocol("https:"), false);
  assert.equal(isAppLink("sagax://cloud", "cloud"), true);
  assert.equal(isAppLink("OpenMausBot://cloud/", "cloud"), true);
  assert.equal(isAppLink("sagax://cloudy", "cloud"), false);
  assert.equal(appLink("organization"), "sagax://organization");
});

test("token prefixes: sgx_ and omb_ are both accepted", () => {
  assert.equal(hasTokenPrefix("sgx_sess_abc", "sess"), true);
  assert.equal(hasTokenPrefix("omb_sess_abc", "sess"), true);
  assert.equal(hasTokenPrefix("xyz_sess_abc", "sess"), false);
  assert.equal(hasTokenPrefix(undefined, "sess"), false);
});

test("health keeps the word deployed checks grep for, beside the new name", () => {
  const body = JSON.stringify({ ...HEALTH_IDENTITY, pid: 1 });
  assert.match(body, /openmausbot/);
  assert.match(body, /sagax/);
  assert.equal(isOwnHealth({ app: "openmausbot" }), true, "an older server");
  assert.equal(isOwnHealth({ app: "sagax" }), true, "a server after the flip");
  assert.equal(isOwnHealth({ app: "other" }), false);
});
