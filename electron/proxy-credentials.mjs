// The SOCKS5 user name and password the desktop bridge's tunnel uses for the
// system proxy (electron/desktop-tunnel.mjs). An app started from Finder, the
// Dock or the Start menu does not get the shell's ALL_PROXY, and the
// operating system's own proxy passwords are not read. So, in order:
//
//   1. the app's environment (ALL_PROXY/SOCKS_PROXY socks5://user:pass@h:p)
//   2. what the person typed once in the app for that proxy (host:port),
//      kept encrypted with the OS (safeStorage) in the app's data
//   3. ask the person, in the desktop app's own window, the first time the
//      proxy asks; a "Cancel" is not asked again until the app restarts
//
// A saved password the proxy refuses is forgotten, so the next connection
// asks again. Nothing here ever leaves this computer.
import { proxyCredentialsFromEnv } from "./desktop-tunnel.mjs";

const keyOf = ({ host, port }) => `${String(host).toLowerCase()}:${port}`;

/** A small encrypted file of { "host:port": { username, password } }.
 * Without OS encryption, the answers are kept in memory for this launch. */
export function createProxyCredentialStore({ file, encryption, fs, log = () => {} }) {
  let entries = null;
  const load = async () => {
    if (entries) return entries;
    entries = {};
    try {
      if (!fs.existsSync(file) || !(await encryption.available())) return entries;
      // safeStorage.decryptStringAsync answers { result } in recent Electron.
      const decrypted = await encryption.decrypt(fs.readFileSync(file));
      const parsed = JSON.parse(typeof decrypted === "string" ? decrypted : decrypted?.result);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) entries = parsed;
    } catch (error) { log(`proxy passwords unreadable: ${error?.message ?? error}`); }
    return entries;
  };
  const save = async () => {
    try {
      if (!(await encryption.available())) return;
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, await encryption.encrypt(JSON.stringify(entries)), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch (error) { log(`proxy passwords not saved: ${error?.message ?? error}`); }
  };
  return {
    async get(proxy) {
      const found = (await load())[keyOf(proxy)];
      return found && typeof found.username === "string" && typeof found.password === "string" ? { username: found.username, password: found.password } : null;
    },
    async set(proxy, { username, password }) { (await load())[keyOf(proxy)] = { username, password }; await save(); },
    async forget(proxy) { const all = await load(); if (keyOf(proxy) in all) { delete all[keyOf(proxy)]; await save(); } },
  };
}

/** The `proxyCredentials` the tunnel takes: a function for what is known,
 * with `ask` and `refused` beside it. `prompt({ host, port })` shows the
 * person the question and resolves { username, password } or null. */
export function createProxyCredentials({ env = process.env, store, prompt }) {
  const fromEnv = proxyCredentialsFromEnv(env);
  const asking = new Map();
  const declined = new Set();
  const known = async proxy => {
    const found = fromEnv(proxy);
    if (found) return found;
    const saved = await store.get(proxy);
    return saved ? { ...saved, source: "saved" } : null;
  };
  known.ask = proxy => {
    const key = keyOf(proxy);
    if (declined.has(key)) return Promise.resolve(null);
    if (asking.has(key)) return asking.get(key);
    const answer = (async () => {
      let given = null;
      try { given = await prompt({ host: proxy.host, port: proxy.port }); } catch { given = null; }
      if (!given || typeof given.username !== "string" || !given.username || typeof given.password !== "string") { declined.add(key); return null; }
      const credentials = { username: given.username.slice(0, 255), password: given.password.slice(0, 255) };
      await store.set(proxy, credentials);
      return { ...credentials, source: "saved" };
    })().finally(() => asking.delete(key));
    asking.set(key, answer);
    return answer;
  };
  known.refused = async (proxy, given) => {
    if (given?.source === "saved") await store.forget(proxy).catch(() => {});
  };
  return known;
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/** The question's page (FR/EN), for a sandboxed window with no preload: the
 * main process reads the answer with `proxyPasswordAnswerScript`. */
export function proxyPasswordPage({ host, port, french = false }) {
  const t = french
    ? { title: "Mot de passe du proxy", lead: `Le proxy SOCKS de cet ordinateur (${escapeHtml(host)}:${port}) demande un nom d'utilisateur et un mot de passe pour le trafic des robots qui travaillent pour vous.`, note: "Sagax les garde chiffrés sur cet ordinateur seulement.", user: "Nom d'utilisateur", pass: "Mot de passe", ok: "Se connecter", cancel: "Annuler" }
    : { title: "Proxy password", lead: `This computer's SOCKS proxy (${escapeHtml(host)}:${port}) asks for a user name and password for the traffic of the bots working for you.`, note: "Sagax keeps them encrypted on this computer only.", user: "User name", pass: "Password", ok: "Sign in", cancel: "Cancel" };
  return `<!doctype html><html lang="${french ? "fr" : "en"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${t.title}</title>
<style>:root{color-scheme:light dark}body{font:13px system-ui,sans-serif;margin:20px}p{margin:0 0 10px}label{display:block;margin:10px 0 4px}input{width:100%;box-sizing:border-box;padding:6px}.row{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.note{opacity:.7}</style></head>
<body><form id="f"><p>${t.lead}</p><p class="note">${t.note}</p>
<label for="u">${t.user}</label><input id="u" autocomplete="off" autofocus required maxlength="255">
<label for="p">${t.pass}</label><input id="p" type="password" autocomplete="off" maxlength="255">
<div class="row"><button type="button" id="c">${t.cancel}</button><button type="submit">${t.ok}</button></div></form></body></html>`;
}

/** Run in the question's page: resolves { username, password } or null. */
export const proxyPasswordAnswerScript = `new Promise(resolve => {
  const form = document.getElementById("f");
  form.addEventListener("submit", event => { event.preventDefault(); resolve({ username: document.getElementById("u").value, password: document.getElementById("p").value }); });
  document.getElementById("c").addEventListener("click", () => resolve(null));
  document.addEventListener("keydown", event => { if (event.key === "Escape") resolve(null); });
})`;
