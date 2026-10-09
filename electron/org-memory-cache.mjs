// Settings > Memory: the local cache of the organization memory, for
// Obsidian (Perspicax lot A.4; Perspicax docs/memory.md, "Obsidian and git
// sync").
//
// Perspicax serves every memory tier a person reads as a git repository
// (`<origin>/memory/git/me`, `org`, `team-<id>`). This module keeps one clone
// per tier in a vault folder on this computer and syncs it:
//
//   - the vault lives under Application Support (userData/org-memory/vault),
//     never in iCloud Drive, OneDrive or another cloud-synchronized folder
//     (refused), and macOS Time Machine skips it (the sticky
//     com.apple.metadata:com_apple_backup_excludeItem attribute);
//   - a sync commits local changes, rebases on the server, pushes, then
//     reads the person's review items (`pending` state): the person's own
//     tier is written directly, a shared tier gets inbox items the server
//     shows under `_pending/` in the clone;
//   - generated files (MEMORY.md, .gitignore, _pending/, directory/) are
//     restored before a commit, so an edit there never blocks a push;
//   - the token (a Perspicax memory sync token) is kept encrypted by the
//     operating system (safeStorage), passed to git only as an
//     `Authorization` header through environment variables of the child
//     process: never on a command line, never in .git/config, never logged;
//   - erase() removes the vault, the token and the state: on sign-out (the
//     organization is disconnected), when Perspicax refuses the token (access
//     ended), or from the button;
//   - a recommended `.obsidian` folder turns off the Sync and Publish core
//     plugins and lists no community plugin.
//
// Everything that touches the system (files, git, HTTP, encryption) is
// injected so the tests drive it with a real git and a temporary folder.
import nodeFs from "node:fs";
import path from "node:path";

export const CACHE_FOLDER = "org-memory";
export const VAULT_FOLDER = "vault";
export const STATE_FILE = "state.json";
export const TOKEN_FILE = "token.bin";
export const TIER_NAME = /^(me|org|team-[A-Za-z0-9_-]{1,64})$/;
const GENERATED = [/^MEMORY\.md$/, /^\.gitignore$/, /^_pending\//, /^directory\//];

/** Why a folder may not hold the cache, or null. */
export function cloudFolderReason(folder) {
  const parts = String(folder).split(/[\\/]+/);
  for (const name of parts) {
    if (name === "Mobile Documents" || name === "iCloud Drive" || name.startsWith("iCloud~")) return "iCloud Drive";
    if (name.startsWith("OneDrive")) return "OneDrive";
    if (name === "CloudStorage") return "a cloud storage folder";
    if (name === "Dropbox" || name === "Google Drive" || name === "Box") return "a cloud folder";
  }
  return null;
}

export function cacheRoot(userData) {
  return path.join(userData, CACHE_FOLDER);
}

export function vaultPath(userData) {
  return path.join(cacheRoot(userData), VAULT_FOLDER);
}

/** The obsidian:// link that opens (or adds) the vault. */
export function obsidianUrl(vault) {
  return `obsidian://open?path=${encodeURIComponent(vault)}`;
}

/** An https origin, or an http one on this computer (a test server). */
export function normalizeServer(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("Enter the Perspicax address, like https://pulsatrix.example.com");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("The Perspicax address must start with https://");
  }
  if (url.username || url.password) throw new Error("The address must not hold a user name or a password");
  return url.origin;
}

/** A generated path of a clone: restored, never pushed. */
export function isGenerated(file) {
  return GENERATED.some((re) => re.test(file));
}

/** The recommended .obsidian folder; false when the vault already has one. */
export function writeObsidianConfig(vault, fs = nodeFs) {
  const dir = path.join(vault, ".obsidian");
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.json"), `${JSON.stringify({
    attachmentFolderPath: "_local-attachments",
    newFileLocation: "current",
    promptDelete: true,
    alwaysUpdateLinks: false,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "core-plugins.json"), `${JSON.stringify({
    "file-explorer": true,
    "global-search": true,
    switcher: true,
    graph: true,
    backlink: true,
    "outgoing-link": true,
    "tag-pane": true,
    properties: true,
    "page-preview": true,
    outline: true,
    sync: false,
    publish: false,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "community-plugins.json"), "[]\n");
  return true;
}

/** Keep a folder out of Time Machine (macOS): the attribute tmutil sets. */
export async function excludeFromBackup(dir, { platform = process.platform, run }) {
  if (platform !== "darwin") return false;
  const out = await run("xattr", ["-w", "com.apple.metadata:com_apple_backup_excludeItem", "com.apple.backupd", dir], {});
  return out.code === 0;
}

function remoteLines(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("remote:") || line.startsWith("! ["))
    .map((line) => line.replace(/^remote:\s*/, ""))
    .filter((line) => line && !/bearer|authorization/i.test(line));
}

const emptyState = () => ({ server: null, tiers: [], pending: [], pendingCount: 0, lastSyncAt: null, lastError: null });

/**
 * The cache of one desktop.
 *
 * @param {object} deps
 * @param {string} deps.userData   Electron's userData folder
 * @param {(cmd: string, args: string[], opts: { cwd?: string, env?: Record<string, string> }) => Promise<{ code: number, stdout: string, stderr: string }>} deps.run
 * @param {typeof fetch} deps.fetch
 * @param {(text: string) => Buffer} deps.encrypt  safeStorage.encryptString
 * @param {(data: Buffer) => string} deps.decrypt  safeStorage.decryptString
 */
export function createOrgMemoryCache({ userData, run, fetch, encrypt, decrypt, fs = nodeFs, platform = process.platform, now = () => Date.now() }) {
  const root = cacheRoot(userData);
  const vault = vaultPath(userData);
  const stateFile = path.join(root, STATE_FILE);
  const tokenFile = path.join(root, TOKEN_FILE);
  let busy = null;

  const readState = () => {
    try {
      return { ...emptyState(), ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
    } catch {
      return emptyState();
    }
  };
  const writeState = (state) => {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  };
  const readToken = () => {
    try {
      return decrypt(fs.readFileSync(tokenFile));
    } catch {
      return null;
    }
  };

  const gitEnv = (token) => ({
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
    GIT_AUTHOR_NAME: "Sagax memory sync",
    GIT_AUTHOR_EMAIL: "sync@perspicax.invalid",
    GIT_COMMITTER_NAME: "Sagax memory sync",
    GIT_COMMITTER_EMAIL: "sync@perspicax.invalid",
  });

  async function getJson(server, token, route) {
    const response = await fetch(`${server}${route}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (response.status === 401) {
      const error = new Error("Perspicax refused the memory sync token (expired, revoked, or your access ended)");
      error.accessEnded = true;
      throw error;
    }
    if (!response.ok) throw new Error(`Perspicax answered ${response.status} on ${route}`);
    return response.json();
  }

  async function syncTier(token, tier) {
    const dir = path.join(vault, tier.name);
    const env = gitEnv(token);
    const git = (args, cwd = dir) => run("git", args, { cwd, env });
    if (!fs.existsSync(path.join(dir, ".git"))) {
      const cloned = await git(["clone", "-q", tier.url, dir], vault);
      return cloned.code === 0
        ? { status: "cloned", messages: [] }
        : { status: "error", messages: ["clone failed", ...remoteLines(cloned.stderr)] };
    }
    const messages = [];
    const status = await git(["status", "--porcelain", "-z"]);
    for (const record of status.stdout.split("\0").filter((r) => r.length > 3)) {
      const file = record.slice(3);
      if (!isGenerated(file)) continue;
      const tracked = (await git(["ls-files", "--error-unmatch", file])).code === 0;
      if (tracked) await git(["checkout", "HEAD", "--", file]);
      else fs.rmSync(path.join(dir, file), { force: true, recursive: true });
      messages.push(`${file} is written by the server: restored`);
    }
    if ((await git(["status", "--porcelain"])).stdout.trim()) {
      await git(["add", "-A"]);
      await git(["commit", "-q", "-m", `Sagax memory sync ${new Date(now()).toISOString()}`]);
    }
    const fetched = await git(["fetch", "-q", "origin"]);
    if (fetched.code !== 0) return { status: "error", messages: [...messages, "fetch failed", ...remoteLines(fetched.stderr)] };
    if ((await git(["merge-base", "HEAD", "origin/main"])).code !== 0) {
      // The server rebuilt its mirror: keep the old clone aside, clone again.
      const aside = `${dir}.unrelated-${now()}`;
      fs.renameSync(dir, aside);
      const again = await syncTier(token, tier);
      return { ...again, messages: [...messages, `the server history changed: the old copy is kept in ${path.basename(aside)}`, ...again.messages] };
    }
    if ((await git(["rebase", "-q", "origin/main"])).code !== 0) {
      await git(["rebase", "--abort"]);
      return { status: "conflict", messages: [...messages, "a conflict with the server: nothing was pushed"] };
    }
    const ahead = Number((await git(["rev-list", "--count", "origin/main..HEAD"])).stdout.trim()) || 0;
    if (ahead === 0) return { status: "up-to-date", messages };
    const pushed = await git(["push", "origin", "HEAD:refs/heads/main"]);
    if (pushed.code !== 0) return { status: "refused", messages: [...messages, ...remoteLines(pushed.stderr)] };
    await git(["fetch", "-q", "origin"]);
    await git(["merge", "-q", "--ff-only", "origin/main"]);
    return { status: "pushed", messages: [...messages, ...remoteLines(pushed.stderr)] };
  }

  async function eraseNow(reason = null) {
    fs.rmSync(root, { recursive: true, force: true });
    if (reason) writeState({ ...emptyState(), lastError: reason });
  }

  async function syncNow() {
    const state = readState();
    const token = readToken();
    if (!state.server || !token) throw new Error("Connect to Perspicax first");
    const reason = cloudFolderReason(vault);
    if (reason) throw new Error(`The memory folder is in ${reason}; it must stay out of cloud folders`);
    let tiers;
    try {
      tiers = await getJson(state.server, token, "/api/v1/memory/sync/tiers");
    } catch (error) {
      if (error.accessEnded) {
        await eraseNow(error.message);
        return api.state();
      }
      throw error;
    }
    const fresh = !fs.existsSync(vault);
    fs.mkdirSync(vault, { recursive: true, mode: 0o700 });
    if (fresh) await excludeFromBackup(cacheRoot(userData), { platform, run }).catch(() => false);
    const results = [];
    for (const tier of (tiers.tiers ?? []).filter((t) => TIER_NAME.test(t.name))) {
      const outcome = await syncTier(token, tier);
      results.push({ name: tier.name, label: tier.label, push: tier.push, status: outcome.status, messages: outcome.messages });
    }
    // A tier no longer readable leaves this computer.
    const names = new Set(results.map((r) => r.name));
    for (const entry of fs.readdirSync(vault, { withFileTypes: true })) {
      if (entry.isDirectory() && TIER_NAME.test(entry.name) && !names.has(entry.name)) {
        fs.rmSync(path.join(vault, entry.name), { recursive: true, force: true });
      }
    }
    let pending = { pending: 0, items: [] };
    try {
      pending = await getJson(state.server, token, "/api/v1/memory/sync/pending");
    } catch (error) {
      if (error.accessEnded) {
        await eraseNow(error.message);
        return api.state();
      }
    }
    writeState({
      ...state,
      tiers: results,
      pending: (pending.items ?? []).slice(0, 200),
      pendingCount: Number(pending.pending) || 0,
      lastSyncAt: now(),
      lastError: null,
    });
    return api.state();
  }

  const api = {
    root,
    vault,
    /** What Settings > Memory shows; never the token. */
    state() {
      const state = readState();
      return {
        ...state,
        connected: Boolean(state.server && fs.existsSync(tokenFile)),
        vault,
        cloned: fs.existsSync(vault),
        obsidianConfigured: fs.existsSync(path.join(vault, ".obsidian")),
        obsidianUrl: obsidianUrl(vault),
        cloudFolder: cloudFolderReason(vault),
        busy: busy !== null,
      };
    },
    /** Check the address and the token against Perspicax, then keep both. */
    async connect({ server, token }) {
      const origin = normalizeServer(server);
      const value = String(token ?? "").trim();
      if (!/^pxat1\.[A-Za-z0-9_-]{16,200}$/.test(value)) throw new Error("Paste the memory sync token from the Perspicax console (it starts with pxat1.)");
      const reason = cloudFolderReason(vault);
      if (reason) throw new Error(`The memory folder is in ${reason}; it must stay out of cloud folders`);
      const tiers = await getJson(origin, value, "/api/v1/memory/sync/tiers");
      if (tiers.enabled === false) throw new Error("The memory is off on this Perspicax");
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      fs.writeFileSync(tokenFile, encrypt(value), { mode: 0o600 });
      writeState({ ...emptyState(), server: origin });
      return api.state();
    },
    /** One sync at a time; a second call joins the running one. */
    async sync() {
      busy ??= syncNow().finally(() => {
        busy = null;
      });
      return busy;
    },
    /** Remove the vault, the token and the state. */
    async erase() {
      if (busy) await busy.catch(() => {});
      await eraseNow();
      return api.state();
    },
    /** The recommended .obsidian folder; false when there is one. */
    writeObsidianConfig() {
      fs.mkdirSync(vault, { recursive: true, mode: 0o700 });
      return writeObsidianConfig(vault, fs);
    },
  };
  return api;
}
