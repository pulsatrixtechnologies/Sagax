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

const { parseAuthReturnLink } = require("./environments.cjs");
const { SYSTEM_SIGN_IN_TTL_MS, authReturnTarget, createPendingSystemSignIn, systemBrowserStartUrl } = require("./oidc-login-window.cjs");
const CREDENTIAL = `omb_pair_${"A1b2_C3d4-".repeat(4)}xyz`;
const returnLink = (hash, origin = ORG) => `openmausbot://auth?origin=${encodeURIComponent(origin)}#${hash}`;

test("the system browser starts the desktop flow on the selected saved server only", () => {
  assert.equal(systemBrowserStartUrl(`${ORG}/auth/oidc/start`, state), `${ORG}/auth/oidc/start?client=desktop`);
  assert.equal(systemBrowserStartUrl("https://evil.example/auth/oidc/start", state), null);
  assert.equal(systemBrowserStartUrl(`${ORG}/pair`, state), null);
});

test("a return link is honoured only for a saved server, with the credential in the hash", () => {
  assert.deepEqual(parseAuthReturnLink(returnLink(`code=${CREDENTIAL}`), state), { origin: ORG, code: CREDENTIAL });
  assert.deepEqual(parseAuthReturnLink(returnLink("error=role"), state), { origin: ORG, error: "role" });
  // a server this app never saved
  assert.equal(parseAuthReturnLink(returnLink(`code=${CREDENTIAL}`, "https://evil.example"), state), null);
  // the credential in the query
  assert.equal(parseAuthReturnLink(`openmausbot://auth?origin=${encodeURIComponent(ORG)}&code=${CREDENTIAL}`, state), null);
  // bad shapes
  assert.equal(parseAuthReturnLink(returnLink("code=omb_pair_short"), state), null);
  assert.equal(parseAuthReturnLink(returnLink(`code=${CREDENTIAL}&error=role`), state), null);
  assert.equal(parseAuthReturnLink(returnLink("error=<script>"), state), null);
  assert.equal(parseAuthReturnLink(returnLink(`code=${CREDENTIAL}`, `${ORG}/path`), state), null);
  assert.equal(parseAuthReturnLink(`openmausbot://auth?origin=${encodeURIComponent(ORG)}&origin=${encodeURIComponent(ORG)}#code=${CREDENTIAL}`, state), null);
  assert.equal(parseAuthReturnLink(`openmausbot://pair?origin=${encodeURIComponent(ORG)}#code=${CREDENTIAL}`, state), null);
  assert.equal(parseAuthReturnLink(`https://bot.example.test/?origin=${encodeURIComponent(ORG)}#code=${CREDENTIAL}`, state), null);
  assert.equal(parseAuthReturnLink(42, state), null);
});

test("the return lands on /pair to be redeemed once, or shows the error", () => {
  assert.equal(authReturnTarget({ origin: ORG, code: CREDENTIAL }), `${ORG}/pair#code=${CREDENTIAL}&auto=1`);
  assert.equal(authReturnTarget({ origin: ORG, error: "role" }), `${ORG}/pair#signin_error=role`);
});

test("only the sign-in this app started, for ten minutes, once", () => {
  let clock = 1_000;
  const pending = createPendingSystemSignIn({ now: () => clock });
  assert.equal(pending.take(ORG), false); // nobody started one
  pending.begin(ORG);
  assert.equal(pending.take("https://other.example.test"), false);
  assert.equal(pending.take(ORG), true);
  assert.equal(pending.take(ORG), false); // once
  pending.begin(ORG);
  clock += SYSTEM_SIGN_IN_TTL_MS;
  assert.equal(pending.take(ORG), false); // expired
});

test("the /pair page may redeem a returned credential without asking only when this app handed it over, once, briefly", () => {
  const { createSignInHandoff, SIGN_IN_HANDOFF_TTL_MS } = require("./oidc-login-window.cjs");
  let clock = 1_000;
  const handoff = createSignInHandoff({ now: () => clock });
  // a plain link somebody posted: nothing was handed over
  assert.equal(handoff.redeem(ORG, CREDENTIAL), false);
  handoff.accept({ origin: ORG, code: CREDENTIAL });
  assert.equal(handoff.redeem("https://other.example.test", CREDENTIAL), false);
  assert.equal(handoff.redeem(ORG, `omb_pair_${"Z".repeat(43)}`), false);
  assert.equal(handoff.redeem(ORG, 42), false);
  assert.equal(handoff.redeem(ORG, CREDENTIAL), true);
  assert.equal(handoff.redeem(ORG, CREDENTIAL), false); // once
  handoff.accept({ origin: ORG, code: CREDENTIAL });
  clock += SIGN_IN_HANDOFF_TTL_MS;
  assert.equal(handoff.redeem(ORG, CREDENTIAL), false); // expired
  // an error return hands nothing over
  handoff.accept({ origin: ORG, error: "role" });
  assert.equal(handoff.redeem(ORG, CREDENTIAL), false);
});
