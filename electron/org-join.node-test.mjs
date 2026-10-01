import assert from "node:assert/strict";
import { test } from "node:test";

import { checkReport, checkStagedDocument, createOrgJoin, forgetDetail, STAGE_TTL_MS } from "./org-join.mjs";

const ORG = "https://org.example.test";
const SELF = "pr_11111111-1111-4111-8111-111111111111";

function copy() {
  return {
    format: "sagax.org-import", version: 1, exportedAt: 1, self: SELF,
    choices: { atlas: { threads: true, memory: true }, bolt: { threads: false, memory: false } },
    people: { bots: {}, groups: {}, routines: [] },
    backup: { format: "openmaus.backup", version: 1, bots: [{ key: "atlas", name: "Atlas" }, { key: "bolt", name: "Bolt" }], groups: [], routines: [] },
  };
}
const report = (keys = ["atlas", "bolt"]) => ({ bots: keys.map((sourceKey) => ({ sourceKey, id: `org-${sourceKey}` })), subject: { iss: "https://px.example.test", sub: "B1" } });

function harness(overrides = {}) {
  const calls = { saved: [], navigated: [], deleted: [], linked: [], confirmed: [], fetched: [], signedIn: [], modes: [] };
  let clock = 1_000;
  const descriptor = overrides.descriptor ?? { identity: { kind: "perspicax", issuer: "https://px.example.test" } };
  const join = createOrgJoin({
    now: () => clock,
    fetch: overrides.fetch ?? (async (url, init) => {
      calls.fetched.push({ url, init });
      return { ok: true, status: 200, json: async () => descriptor };
    }),
    parseLink: (address) => {
      try {
        const url = new URL(address);
        const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
        return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? { origin: url.origin } : null;
      } catch {
        return null;
      }
    },
    saveEnvironment: (origin, options) => { calls.saved.push(origin); calls.modes.push(options?.serverMode === true); },
    navigate: (url) => calls.navigated.push(url),
    confirm: async (names) => { calls.confirmed.push(names); return overrides.confirm ?? true; },
    deleteLocalBot: async (key) => { calls.deleted.push(key); return true; },
    postLinkedSubject: async (input) => { calls.linked.push(input); },
    signIn: async (origin) => {
      if (overrides.signIn) await overrides.signIn(origin);
      calls.signedIn.push(origin);
    },
  });
  return { join, calls, tick: (ms) => { clock += ms; } };
}

test("probe accepts a Perspicax server, with a 5 s timeout and redirects refused", async () => {
  const h = harness();
  assert.deepEqual(await h.join.probe(`${ORG}/pair`), { origin: ORG, issuer: "https://px.example.test" });
  assert.equal(h.calls.fetched[0].url, `${ORG}/.well-known/openmausbot/environment`);
  assert.equal(h.calls.fetched[0].init.redirect, "error");
  assert.ok(h.calls.fetched[0].init.signal instanceof AbortSignal);
});

test("probe refuses a server that is not Perspicax", async () => {
  const h = harness({ descriptor: { label: "solo" } });
  await assert.rejects(h.join.probe(ORG), /does not sign people in with Pulsatrix/);
});

test("probe refuses http on a non-loopback host", async () => {
  const h = harness();
  await assert.rejects(h.join.probe("http://org.example.test"), /https/);
  assert.equal(h.calls.fetched.length, 0);
});

test("probe refuses a redirect and a timeout", async () => {
  const redirect = harness({ fetch: async () => { throw new TypeError("fetch failed: redirect mode is set to error"); } });
  await assert.rejects(redirect.join.probe(ORG), /could not be reached/);
  const timeout = harness({ fetch: async () => { throw new DOMException("The operation timed out.", "TimeoutError"); } });
  await assert.rejects(timeout.join.probe(ORG), /could not be reached/);
});

test("stage refuses an origin that was not probed and an invalid document", async () => {
  const h = harness();
  await assert.rejects(h.join.stage({ origin: ORG, document: copy() }), /Check the server address first/);
  await h.join.probe(ORG);
  await assert.rejects(h.join.stage({ origin: "https://other.example.test", document: copy() }), /Check the server address first/);
  await assert.rejects(h.join.stage({ origin: ORG, document: { format: "openmaus.backup" } }), /not an organization copy/);
  const mismatch = copy();
  delete mismatch.choices.bolt;
  await assert.rejects(h.join.stage({ origin: ORG, document: mismatch }), /not an organization copy/);
  assert.deepEqual(h.calls.saved, []);
});

test("stage saves and opens the server; take returns the copy once", async () => {
  const h = harness();
  await h.join.probe(ORG);
  assert.deepEqual(await h.join.stage({ origin: ORG, document: copy() }), { ok: true });
  assert.deepEqual(h.calls.saved, [ORG]);
  assert.deepEqual(h.calls.navigated, [`${ORG}/`]);
  assert.deepEqual(h.join.staged(ORG), { origin: ORG, bots: 2, name: "Atlas, Bolt" });
  assert.deepEqual(h.join.take(ORG), copy());
  assert.equal(h.join.take(ORG), null);
  assert.deepEqual(h.join.staged(ORG), { origin: ORG, bots: 2, name: "Atlas, Bolt" });
});

test("join refuses an origin that was not probed", async () => {
  const h = harness();
  await assert.rejects(h.join.join({ origin: ORG }), /Check the server address first/);
  await h.join.probe(ORG);
  await assert.rejects(h.join.join({ origin: "https://other.example.test" }), /Check the server address first/);
  await assert.rejects(h.join.join(null), /Check the server address first/);
  assert.deepEqual(h.calls.saved, []);
  assert.deepEqual(h.calls.signedIn, []);
});

test("join saves the server, opens its sign-in page and starts Sign in with Pulsatrix, with no copy", async () => {
  const h = harness();
  await h.join.probe(`${ORG}/`);
  assert.deepEqual(await h.join.join({ origin: ORG }), { ok: true });
  assert.deepEqual(h.calls.saved, [ORG]);
  assert.deepEqual(h.calls.navigated, [`${ORG}/pair`]);
  assert.deepEqual(h.calls.signedIn, [ORG]);
  // nothing is held for the server to take
  assert.equal(h.join.staged(ORG), null);
  assert.equal(h.join.take(ORG), null);
});

test("the launch screen's join locks the app to that server (server mode); a plain join does not", async () => {
  const h = harness();
  await h.join.probe(ORG);
  await h.join.join({ origin: ORG, serverMode: true });
  await h.join.join({ origin: ORG });
  await h.join.join({ origin: ORG, serverMode: "yes" });
  assert.deepEqual(h.calls.modes, [true, false, false]);
});

test("server mode hands this computer's preferences to that server's page once, nothing else", async () => {
  const h = harness();
  await h.join.probe(ORG);
  await h.join.join({ origin: ORG, serverMode: true, preferences: { "omb-skin": "midnight", "bad key!": "x", "omb-font": 3, "omb-language": "x".repeat(9000) } });
  assert.equal(h.join.takePreferences("https://other.example.test"), null);
  assert.deepEqual(h.join.takePreferences(ORG), { "omb-skin": "midnight" });
  assert.equal(h.join.takePreferences(ORG), null, "once");
  // a plain join (not server mode) hands nothing
  await h.join.join({ origin: ORG, preferences: { "omb-skin": "paper" } });
  assert.equal(h.join.takePreferences(ORG), null);
});

test("join still saves the server when the sign-in cannot start, and says so", async () => {
  const h = harness({ signIn: async () => { throw new Error("no window"); } });
  await h.join.probe(ORG);
  await assert.rejects(h.join.join({ origin: ORG }), /sign-in could not start/);
  assert.deepEqual(h.calls.saved, [ORG]);
});

test("another origin's page gets nothing", async () => {
  const h = harness();
  await h.join.probe(ORG);
  await h.join.stage({ origin: ORG, document: copy() });
  assert.equal(h.join.staged("https://evil.example.test"), null);
  assert.equal(h.join.take("https://evil.example.test"), null);
  await assert.rejects(h.join.finished("https://evil.example.test", { report: report() }), /No copy/);
  await assert.rejects(h.join.removeLocal("https://evil.example.test", ["atlas"]), /No copy/);
  assert.deepEqual(h.join.take(ORG), copy());
});

test("the staged copy expires after 30 minutes", async () => {
  const h = harness();
  await h.join.probe(ORG);
  await h.join.stage({ origin: ORG, document: copy() });
  h.tick(STAGE_TTL_MS);
  assert.equal(h.join.staged(ORG), null);
  assert.equal(h.join.take(ORG), null);
});

test("finished refuses keys that were not staged and posts the subject to the local server", async () => {
  const h = harness();
  await h.join.probe(ORG);
  await h.join.stage({ origin: ORG, document: copy() });
  await assert.rejects(h.join.finished(ORG, { report: report(["atlas", "cleo"]) }), /not staged/);
  await assert.rejects(h.join.finished(ORG, { report: { bots: [] } }), /not an import report/);
  assert.deepEqual(h.calls.linked, []);
  assert.deepEqual(await h.join.finished(ORG, { report: report(["atlas"]) }), { ok: true });
  assert.deepEqual(h.calls.linked, [{ iss: "https://px.example.test", sub: "B1", serverOrigin: ORG }]);
});

test("removeLocal refuses keys not imported, asks first, and deletes only those", async () => {
  const h = harness();
  await h.join.probe(ORG);
  await h.join.stage({ origin: ORG, document: copy() });
  await assert.rejects(h.join.removeLocal(ORG, ["atlas"]), /Only bots copied/);
  await h.join.finished(ORG, { report: report(["atlas"]) });
  await assert.rejects(h.join.removeLocal(ORG, ["bolt"]), /Only bots copied/);
  await assert.rejects(h.join.removeLocal(ORG, ["atlas", "../config"]), /Only bots copied/);
  assert.deepEqual(await h.join.removeLocal(ORG, ["atlas"]), { removed: ["atlas"] });
  assert.deepEqual(h.calls.confirmed, [["Atlas"]]);
  assert.deepEqual(h.calls.deleted, ["atlas"]);
  // Once removed, never again.
  await assert.rejects(h.join.removeLocal(ORG, ["atlas"]), /Only bots copied/);
});

test("removeLocal deletes nothing when the person declines", async () => {
  const h = harness({ confirm: false });
  await h.join.probe(ORG);
  await h.join.stage({ origin: ORG, document: copy() });
  await h.join.finished(ORG, { report: report() });
  assert.deepEqual(await h.join.removeLocal(ORG, ["atlas", "bolt"]), { removed: [] });
  assert.deepEqual(h.calls.deleted, []);
});

test("document and report checks", () => {
  assert.deepEqual(checkStagedDocument(copy()), [{ key: "atlas", name: "Atlas" }, { key: "bolt", name: "Bolt" }]);
  assert.throws(() => checkStagedDocument({ ...copy(), self: "dana@example.test" }), /not an organization copy/);
  assert.deepEqual(checkReport(report(["bolt", "bolt"]), ["atlas", "bolt"]), { keys: ["bolt"], iss: "https://px.example.test", sub: "B1" });
});

test("the Forget dialog says what leaving an organization server means", () => {
  assert.match(forgetDetail(true), /Your bots copied there stay in the organization; your bots on this computer are unchanged\./);
  assert.doesNotMatch(forgetDetail(false), /organization/);
});
