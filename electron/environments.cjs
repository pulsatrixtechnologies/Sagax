// Saved servers ("environments") for the desktop app, pure and testable.
//
// Local is the server this app spawns; a remote environment is a server the
// user paired with. The app switches by loading that server's UI, so an
// environment is just {id, name, origin}, plus `org: true` for an
// organization server (one that signs people in with Pulsatrix, probed by
// org-join.mjs): the desktop draws ITS OWN bundled UI on that origin
// (electron/bundled-ui.cjs) instead of whatever the server image serves.
// The session credential is the HttpOnly cookie the /pair page set for that
// origin, held by Chromium's cookie jar, never by this file.
//
// Server mode (the launch screen's "Server") is exclusive: `serverModeId`
// names the one organization server this app shows. While it is set,
// nothing switches to Local or another saved server; only leaving server
// mode (Settings > General > Server > Change, or the Server menu) clears it.
const LOCAL_ID = "local";
const MAX_NAME = 60;

/** `https://host[:port]` — a bare origin, no path, no credentials. */
function normalizeOrigin(input) {
  if (typeof input !== "string") return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** Turn what the server printed — `https://host/pair#code=XXXX-XXXX-XXXX`,
 * or just an origin — into where to go. The code stays in the hash, so the
 * page consumes it and it never reaches a server log. */
function parsePairingLink(input) {
  const origin = normalizeOrigin(input);
  if (!origin) return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  // A code travels in the hash only: a query string reaches server logs.
  if (url.searchParams.has("code")) return null;
  const code = /(?:^|[#&])code=([^&]+)/.exec(url.hash)?.[1] ?? null;
  const isPairPage = url.pathname === "/pair" || url.pathname === "/pair/";
  if (code && !isPairPage) return null; // a code belongs on /pair; anything else is not a pairing link
  try {
    return { origin, code: code ? decodeURIComponent(code) : null, url: code ? `${origin}/pair#code=${code}` : origin };
  } catch {
    return null;
  }
}

/** The desktop connection form accepts a hostname, HTTPS address or pairing
 * link. Keep codes out of queries/history and refuse unrelated URL paths. */
function parseHostedWorkspaceLink(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || /[\s\\]/.test(text)) return null;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    if (url.username || url.password || url.search || !["/", "/pair", "/pair/"].includes(url.pathname)) return null;
    if (!loopback && !url.hostname.includes(".")) return null;
    const parsed = parsePairingLink(url.href);
    if (!parsed || (url.hash && (!parsed.code || !/^[A-Z0-9-]{12,16}$/i.test(parsed.code)))) return null;
    return parsed;
  } catch {
    return null;
  }
}

const SIGN_IN_CREDENTIAL = /^omb_pair_[A-Za-z0-9_-]{43}$/;
const SIGN_IN_ERROR = /^[a-z_]{1,40}$/;

/** "Sign in with Pulsatrix" in the system browser comes back as
 * `openmausbot://auth?origin=<saved server>#code=<omb_pair_ credential>` or
 * `#error=<code>`. Returns {origin, code} or {origin, error} for a SAVED
 * server only, else null. The credential travels in the hash only, never
 * the query. */
function parseAuthReturnLink(input, state) {
  if (typeof input !== "string" || input.length > 2048) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "openmausbot:" || url.host !== "auth" || (url.pathname !== "" && url.pathname !== "/")) return null;
  if (url.username || url.password) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "origin") return null;
  const origin = normalizeOrigin(url.searchParams.get("origin"));
  if (!origin || origin !== url.searchParams.get("origin")) return null;
  if (!state?.environments?.some((entry) => entry.origin === origin)) return null;
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const parts = [...fragment.keys()];
  if (parts.length !== 1) return null;
  if (parts[0] === "code") {
    const code = fragment.get("code");
    return code && SIGN_IN_CREDENTIAL.test(code) ? { origin, code } : null;
  }
  if (parts[0] === "error") {
    const error = fragment.get("error");
    return error && SIGN_IN_ERROR.test(error) ? { origin, error } : null;
  }
  return null;
}

/** Remote renderers learn only their current workspace, not the local list. */
function workspaceSummary(state) {
  const active = activeEnvironment(state);
  if (!active) return { local: true, name: "This computer" };
  return { local: false, name: active.name, origin: active.origin, ...(serverModeEnvironment(state) ? { serverMode: true } : {}) };
}

/** The server server mode is locked to, or null when the app is not in
 * server mode. */
function serverModeEnvironment(state) {
  if (!state?.serverModeId) return null;
  return state.environments.find((e) => e.id === state.serverModeId) ?? null;
}

/** The origin whose pages the desktop draws from its own bundle: the active
 * environment when it is an organization server, else null. */
function bundledOrigin(state) {
  const active = activeEnvironment(state);
  return active?.org === true ? active.origin : null;
}

/** Native identity must not depend on a hosted renderer's version/title. */
function workspaceWindowTitle(state, companion) {
  if (companion) return `Sagax — Connected to: ${companion.serverName} (${new URL(companion.endpoint).host})`;
  const active = activeEnvironment(state);
  return active ? `Sagax — Hosted: ${active.name} (${new URL(active.origin).host})` : "Sagax";
}

/** Renderer navigation stays in the selected workspace. Switching is a main
 * process action; a cloud page must not navigate itself onto the local bridge. */
function workspaceNavigationAllowed(url, state, localOrigin) {
  try {
    return new URL(url).origin === (activeEnvironment(state)?.origin ?? localOrigin);
  } catch {
    return false;
  }
}

/** Only the main window's main frame may request this deliberately small
 * shell surface. Being embedded in a saved server grants no host authority. */
function workspaceSenderAllowed(event, contents, state, localOrigin) {
  if (!contents || event?.sender !== contents || event?.senderFrame !== contents.mainFrame) return false;
  try {
    return workspaceNavigationAllowed(event.senderFrame.url, state, localOrigin);
  } catch {
    return false;
  }
}

/** Native menu choices, never renderer-supplied destinations or callbacks.
 * In server mode the only server is the organization's: no Local, no other
 * saved server, no Connect; "Change server…" leaves server mode. */
function workspaceMenuTemplate(state, { onSwitch, onConnect, onForget, onLeaveServerMode }) {
  const active = activeEnvironment(state);
  const locked = serverModeEnvironment(state);
  if (locked) {
    return [
      { id: `workspace-${locked.id}`, label: locked.name, sublabel: new URL(locked.origin).host, type: "radio", checked: true, click: () => {} },
      { type: "separator" },
      { id: "workspace-leave-server-mode", label: "Change server…", click: () => onLeaveServerMode?.() },
    ];
  }
  return [
    { id: "workspace-local", label: "This computer", type: "radio", checked: !active, click: () => onSwitch(LOCAL_ID) },
    ...state.environments.map((entry) => ({
      id: `workspace-${entry.id}`, label: entry.name, sublabel: new URL(entry.origin).host,
      type: "radio", checked: entry.id === state.activeId, click: () => onSwitch(entry.id),
    })),
    { type: "separator" },
    { id: "workspace-connect", label: "Connect to a server…", click: onConnect },
    ...(active ? [{ id: "workspace-forget", label: `Forget “${active.name}”…`, click: () => onForget(active.id) }] : []),
  ];
}

function cleanName(value, fallback) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME) : "";
  return name || fallback;
}

function nameFromOrigin(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Parse the persisted file. Unknown or damaged content yields the empty
 * state rather than an error: losing a saved list costs a re-pair, not the app. */
function parseEnvironments(raw) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { environments: [], activeId: LOCAL_ID };
  }
  const list = Array.isArray(value?.environments) ? value.environments : [];
  const seen = new Set();
  const environments = [];
  for (const entry of list) {
    const origin = normalizeOrigin(entry?.origin);
    const id = typeof entry?.id === "string" && /^[\w-]{1,64}$/.test(entry.id) ? entry.id : null;
    if (!origin || !id || id === LOCAL_ID || seen.has(id) || seen.has(origin)) continue;
    seen.add(id);
    seen.add(origin);
    environments.push({ id, name: cleanName(entry?.name, nameFromOrigin(origin)), origin, ...(entry?.org === true ? { org: true } : {}) });
  }
  // Server mode survives a restart only on an organization server it saved.
  const serverModeId = typeof value?.serverModeId === "string" && environments.some((e) => e.id === value.serverModeId && e.org === true)
    ? value.serverModeId : null;
  if (serverModeId) return { environments, activeId: serverModeId, serverModeId };
  const activeId = typeof value?.activeId === "string" && environments.some((e) => e.id === value.activeId) ? value.activeId : LOCAL_ID;
  return { environments, activeId };
}

function serializeEnvironments(state) {
  return JSON.stringify({
    version: 1, environments: state.environments, activeId: state.activeId,
    ...(state.serverModeId ? { serverModeId: state.serverModeId } : {}),
  }, null, 2) + "\n";
}

/** Add or update by origin (re-pairing the same server keeps one entry).
 * `org: true` marks an organization server and is never taken back. */
function withEnvironment(state, input, makeId) {
  const origin = normalizeOrigin(input?.origin);
  if (!origin) return state;
  const org = input?.org === true ? { org: true } : {};
  const existing = state.environments.find((e) => e.origin === origin);
  if (existing) {
    const name = cleanName(input?.name, existing.name);
    const environments = state.environments.map((e) => (e === existing ? { ...e, name, ...org } : e));
    return { ...state, environments };
  }
  const id = makeId();
  const environments = [...state.environments, { id, name: cleanName(input?.name, nameFromOrigin(origin)), origin, ...org }];
  return { ...state, environments };
}

function withoutEnvironment(state, id) {
  const environments = state.environments.filter((e) => e.id !== id);
  const next = { environments, activeId: state.activeId === id ? LOCAL_ID : state.activeId };
  return state.serverModeId && state.serverModeId !== id ? { ...next, serverModeId: state.serverModeId } : next;
}

/** In server mode only the locked server can be active. */
function withActive(state, id) {
  if (id !== LOCAL_ID && !state.environments.some((e) => e.id === id)) return state;
  if (state.serverModeId && id !== state.serverModeId) return state;
  return { ...state, activeId: id };
}

/** Enter server mode on a saved organization server: it becomes the only
 * active one. Anything else is refused (state unchanged). */
function withServerMode(state, id) {
  const entry = state.environments.find((e) => e.id === id);
  if (!entry || entry.org !== true) return state;
  return { ...state, activeId: id, serverModeId: id };
}

/** A save from before organization servers were marked (`org: true`) and
 * server mode existed: mark the saved servers whose descriptor says they
 * sign people in with Pulsatrix, and when this computer chose Server at
 * launch, lock the app to the active one if it is such a server. Anything
 * else is left as it was (same object when nothing changes). */
function withOrganizationUpgrade(state, { orgOrigins, serverModeChosen }) {
  let changed = false;
  const environments = state.environments.map((entry) => {
    if (entry.org === true || !orgOrigins?.has(entry.origin)) return entry;
    changed = true;
    return { ...entry, org: true };
  });
  let next = changed ? { ...state, environments } : state;
  const active = activeEnvironment(next);
  if (serverModeChosen === true && !next.serverModeId && active?.org === true) next = withServerMode(next, active.id);
  return next;
}

/** Leave server mode: the server is forgotten and Local is active again. */
function withoutServerMode(state) {
  const locked = serverModeEnvironment(state);
  const { serverModeId: _left, ...rest } = state;
  return locked ? withoutEnvironment(rest, locked.id) : { ...rest, activeId: LOCAL_ID };
}

function activeEnvironment(state) {
  return state.environments.find((e) => e.id === state.activeId) ?? null;
}

/** Origins the main window may navigate to: Local plus every saved server. */
function allowedOrigins(state, localOrigin) {
  return new Set([localOrigin, ...state.environments.map((e) => e.origin)]);
}

module.exports = {
  LOCAL_ID,
  activeEnvironment,
  allowedOrigins,
  bundledOrigin,
  serverModeEnvironment,
  withOrganizationUpgrade,
  withServerMode,
  withoutServerMode,
  normalizeOrigin,
  parseEnvironments,
  parseAuthReturnLink,
  parsePairingLink,
  parseHostedWorkspaceLink,
  serializeEnvironments,
  withActive,
  withEnvironment,
  withoutEnvironment,
  workspaceMenuTemplate,
  workspaceNavigationAllowed,
  workspaceSenderAllowed,
  workspaceSummary,
  workspaceWindowTitle,
};
