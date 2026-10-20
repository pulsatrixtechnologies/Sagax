// Port of OpenMausBot #2930: only the app window's session reaches the local server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import test from "node:test";

import { blockServerOutsideDefaultSession, reportOwnListeners, targetsServer } from "./server-session.mjs";

const SERVER_PORT = 48799;

function fakeSession() {
  const hooks = {};
  return { hooks, webRequest: { onBeforeRequest: (handler) => { hooks.request = handler; } } };
}

const request = (session, url) => new Promise((resolve) => session.hooks.request({ url }, (result) => resolve(result.cancel)));

test("no session but the app window's may reach the server, in any spelling of this machine", async () => {
  const listeners = [];
  const app = { on: (event, handler) => { if (event === "session-created") listeners.push(handler); } };
  const defaultSession = fakeSession();
  blockServerOutsideDefaultSession({ app, defaultSession, serverPort: () => SERVER_PORT });
  const created = (session) => { for (const listener of listeners) listener(session); return session; };
  const viewer = created(fakeSession());
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "app.localhost", "[::1]", "[::ffff:127.0.0.1]", "0.0.0.0"]) {
    for (const scheme of ["http", "ws", "https", "wss"]) {
      assert.equal(await request(viewer, `${scheme}://${host}:${SERVER_PORT}/api/bots`), true, `${scheme} ${host}`);
    }
  }
  for (const url of ["http://127.0.0.1:6080/vnc.html", "https://desktop.example/vnc.html", `http://10.0.0.5:${SERVER_PORT}/`, "data:text/html,x"]) {
    assert.equal(await request(viewer, url), false, url);
  }
  created(defaultSession);
  assert.equal(defaultSession.hooks.request, undefined, "the app window's own session is never cancelled");
  assert.equal(targetsServer(`http://2130706433:${SERVER_PORT}/`, SERVER_PORT), true);
});

test("main.mjs installs the guard once, before the first window, and sends the owner header on ws: too", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const install = main.indexOf("blockServerOutsideDefaultSession({");
  assert.ok(install > 0);
  assert.equal(main.indexOf("blockServerOutsideDefaultSession({", install + 1), -1);
  assert.ok(main.indexOf("createWindow();", install) > install, "installed before the first window");
  assert.match(main, /target\.protocol === "http:" \|\| target\.protocol === "ws:"/);
  assert.match(main, /reportOwnListeners\(proc\);/);
});

test("the server hears about every port this app listens on, and about new ones as they open", async () => {
  const messages = [];
  reportOwnListeners({ postMessage: (message) => messages.push(message) }, [8810]);
  assert.equal(messages.at(-1).type, "openmausbot:own-listeners");
  assert.ok(messages.at(-1).ports.includes(8810));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    assert.ok(messages.at(-1).ports.includes(server.address().port));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
