import assert from "node:assert/strict";
import { test } from "node:test";

import { createOwnerIdentitySync, OWNER_IDENTITY_MESSAGE, organizationOrigins, readOwnerIdentity } from "./owner-identity.mjs";

const ORG = "https://sagax.example.test";
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("avatar one")]);
const PNG2 = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("avatar two")]);
const PERSON = "pr_11111111-1111-4111-8111-111111111111";
const environments = (extra = {}) => ({ environments: [{ id: "org1", name: "GOX", origin: ORG, org: true }, { id: "home", name: "Home", origin: "https://home.example.test" }], activeId: "local", ...extra });

const answer = (status, body, type = "application/json") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ "content-type": type }),
  json: async () => body,
  arrayBuffer: async () => (Buffer.isBuffer(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.length) : new ArrayBuffer(0)),
});

/** A fake organization server: what /api/auth/session says and the image. */
function orgServer() {
  const server = {
    session: { kind: "session", identity: "perspicax", principalId: PERSON, name: "Jean-Christophe Proulx", email: "jc@example.test", avatarUrl: `/api/people/${PERSON}/avatar?v=v1` },
    images: new Map([["v1", PNG]]),
    status: 200,
    down: false,
    calls: [],
    fetch: async (url, init) => {
      server.calls.push({ url, credentials: init?.credentials });
      if (server.down) throw new Error("ECONNREFUSED");
      const parsed = new URL(url);
      if (parsed.pathname === "/api/auth/session") return server.status === 200 ? answer(200, server.session) : answer(server.status, { error: "sign in" });
      const image = server.images.get(parsed.searchParams.get("v"));
      return image ? answer(200, image, "image/png") : answer(404, { error: "no avatar" });
    },
  };
  return server;
}

test("asks the organization servers only, the one in use first", () => {
  assert.deepEqual(organizationOrigins(environments()), [ORG]);
  const two = { environments: [{ id: "a", origin: "https://a.test", org: true }, { id: "b", origin: "https://b.test", org: true }], activeId: "b" };
  assert.deepEqual(organizationOrigins(two), ["https://b.test", "https://a.test"]);
  assert.deepEqual(organizationOrigins({ environments: [], activeId: "local" }), []);
});

test("reads who is signed in and their avatar, with the app's cookie, from the organization server only", async () => {
  const server = orgServer();
  const { identity } = await readOwnerIdentity(ORG, { fetch: server.fetch });
  assert.deepEqual(identity, { origin: ORG, principalId: PERSON, name: "Jean-Christophe Proulx", email: "jc@example.test", avatar: { version: "v1", data: PNG.toString("base64") } });
  assert.deepEqual(server.calls.map((call) => call.url), [`${ORG}/api/auth/session`, `${ORG}/api/people/${PERSON}/avatar?v=v1`]);
  assert.ok(server.calls.every((call) => call.credentials === "include"));
  // the same version is not downloaded again
  server.calls.length = 0;
  const again = await readOwnerIdentity(ORG, { fetch: server.fetch, previous: identity });
  assert.equal(again.identity.avatar.data, PNG.toString("base64"));
  assert.deepEqual(server.calls.map((call) => call.url), [`${ORG}/api/auth/session`]);
});

test("refuses an avatar URL off the person route and an image that is not one", async () => {
  const server = orgServer();
  server.session.avatarUrl = "https://perspicax.example.test/api/v1/pulsabot/people/x/avatar?v=v1";
  assert.equal((await readOwnerIdentity(ORG, { fetch: server.fetch })).identity.avatar, undefined);
  server.session.avatarUrl = `/api/people/${PERSON}/avatar?v=v1`;
  server.images.set("v1", Buffer.from("<svg/>"));
  assert.equal((await readOwnerIdentity(ORG, { fetch: server.fetch })).identity.avatar, undefined);
});

test("signed out is no one; unreachable is unknown", async () => {
  const server = orgServer();
  server.status = 401;
  assert.deepEqual(await readOwnerIdentity(ORG, { fetch: server.fetch }), { identity: null });
  server.status = 200;
  server.session = { kind: "loopback", scopes: ["admin"] };
  assert.deepEqual(await readOwnerIdentity(ORG, { fetch: server.fetch }), { identity: null });
  server.down = true;
  assert.deepEqual(await readOwnerIdentity(ORG, { fetch: server.fetch }), { unreachable: true });
});

test("hands the identity to the local server, follows a new photo, and clears it at sign-out", async () => {
  const server = orgServer();
  const posted = [];
  let state = environments();
  let serverRunning = true;
  const sync = createOwnerIdentitySync({ environments: () => state, fetch: server.fetch, post: (message) => (serverRunning ? (posted.push(message), true) : false) });

  await sync.refresh();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, OWNER_IDENTITY_MESSAGE);
  assert.equal(posted[0].identity.avatar.version, "v1");
  // nothing changed: nothing sent
  await sync.refresh();
  assert.equal(posted.length, 1);

  // a new photo in Perspicax is a new version at the next refresh
  server.images.set("v2", PNG2);
  server.session = { ...server.session, avatarUrl: `/api/people/${PERSON}/avatar?v=v2` };
  await sync.refresh();
  assert.equal(posted.at(-1).identity.avatar.data, PNG2.toString("base64"));

  // the organization is unreachable: the last identity stays
  server.down = true;
  await sync.refresh();
  assert.equal(posted.length, 2);
  server.down = false;

  // the local server restarted: it gets the identity again at once
  serverRunning = false;
  await sync.refresh();
  serverRunning = true;
  await sync.serverReady();
  assert.equal(posted.at(-1).identity.avatar.version, "v2");

  // signed out there
  server.status = 401;
  await sync.refresh();
  assert.deepEqual(posted.at(-1), { type: OWNER_IDENTITY_MESSAGE, identity: null });

  // signed in again, then the server forgotten
  server.status = 200;
  await sync.refresh();
  assert.equal(posted.at(-1).identity.principalId, PERSON);
  state = { environments: [], activeId: "local" };
  await sync.refresh();
  assert.deepEqual(posted.at(-1), { type: OWNER_IDENTITY_MESSAGE, identity: null });
});

test("a computer never signed in to an organization tells the local server so, once", async () => {
  const posted = [];
  const sync = createOwnerIdentitySync({ environments: () => ({ environments: [], activeId: "local" }), fetch: async () => { throw new Error("no call expected"); }, post: (message) => (posted.push(message), true) });
  await sync.refresh();
  await sync.refresh();
  assert.deepEqual(posted, [{ type: OWNER_IDENTITY_MESSAGE, identity: null }]);
});

test("refreshes on a timer, and stops", () => {
  const timers = [];
  const sync = createOwnerIdentitySync({
    environments: () => ({ environments: [] }), fetch: async () => answer(401, {}), post: () => true,
    intervalMs: 1234, setInterval: (fn, ms) => (timers.push({ fn, ms }), { unref() {} }), clearInterval: () => timers.pop(),
  });
  sync.start();
  sync.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1234);
  sync.stop();
  assert.equal(timers.length, 0);
});
