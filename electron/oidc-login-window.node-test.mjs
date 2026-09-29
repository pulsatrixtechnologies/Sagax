import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { oidcLoginReturnUrl, oidcLoginStartUrl, openOidcLoginWindow } = require("./oidc-login-window.cjs");

const ORG = "https://bot.example.test";
const state = { environments: [{ id: "e1", name: "Org", origin: ORG }], activeId: "e1" };

test("only the selected saved server's /auth/oidc/start opens the sign-in window", () => {
  assert.equal(oidcLoginStartUrl(`${ORG}/auth/oidc/start`, state), `${ORG}/auth/oidc/start`);
  assert.equal(oidcLoginStartUrl(`${ORG}/auth/oidc/callback?code=x`, state), null);
  assert.equal(oidcLoginStartUrl(`${ORG}/pair`, state), null);
  assert.equal(oidcLoginStartUrl("https://evil.example/auth/oidc/start", state), null);
  assert.equal(oidcLoginStartUrl(`${ORG}/auth/oidc/start`, { environments: state.environments, activeId: "local" }), null);
  assert.equal(oidcLoginStartUrl("not a url", state), null);
});

test("the sign-in window is done once it is back on the workspace outside /auth/oidc/", () => {
  assert.equal(oidcLoginReturnUrl(`${ORG}/`, ORG), `${ORG}/`);
  assert.equal(oidcLoginReturnUrl(`${ORG}/pair#signin_error=role`, ORG), `${ORG}/pair#signin_error=role`);
  assert.equal(oidcLoginReturnUrl(`${ORG}/auth/oidc/callback?code=x&state=y`, ORG), null);
  assert.equal(oidcLoginReturnUrl("https://px.example.test/oauth/authorize?x", ORG), null);
});

test("the sign-in window has no preload, is sandboxed, shares the session, denies popups and hands back once", async () => {
  const created = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      this.closed = false;
      this.loaded = [];
      this.webContents = {
        on: (name, handler) => this.handlers.set(name, handler),
        setWindowOpenHandler: (handler) => { this.windowOpenHandler = handler; },
      };
      created.push(this);
    }
    loadURL(url) { this.loaded.push(url); return Promise.resolve(); }
    isDestroyed() { return this.closed; }
    close() { this.closed = true; }
  }
  const session = { id: "main-session" };
  const parent = { webContents: { session } };
  const done = [];
  openOidcLoginWindow({ BrowserWindow: FakeWindow, parent, url: `${ORG}/auth/oidc/start`, onDone: (url) => done.push(url) });
  const [login] = created;
  const prefs = login.options.webPreferences;
  assert.equal(prefs.preload, undefined);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.session, session);
  assert.equal(login.options.parent, parent);
  assert.deepEqual(login.loaded, [`${ORG}/auth/oidc/start`]);
  assert.equal(login.windowOpenHandler().action, "deny");
  const navigate = login.handlers.get("did-navigate");
  navigate({}, "https://px.example.test/oauth/authorize?client_id=pulsa-bot");
  navigate({}, `${ORG}/auth/oidc/callback?code=c&state=s`);
  assert.deepEqual(done, []);
  navigate({}, `${ORG}/`);
  navigate({}, `${ORG}/`);
  assert.deepEqual(done, [`${ORG}/`]);
  assert.equal(login.closed, true);
});
