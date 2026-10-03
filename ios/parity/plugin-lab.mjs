// The plugins lab (PARITY_PLUGINS=1 in fixture-server.mjs), for the WP9 UI
// tests (ios/UITests/PluginsUITests.swift). Off by default: nothing of the
// reference dataset changes without it. Not combined with PARITY_CARDS (both
// stand in for the managed connected-apps broker).
//
//   - a stub of the managed connected-apps broker (SAGAX_COMPOSIO_BROKER_URL):
//     a small catalog, Gmail with two accounts, Notion with none, and every
//     authorize, status read and account removal recorded;
//   - a local MCP server behind a fake OAuth server (server/testing), added
//     as "oauthdocs", so Sign in runs the real server's OAuth start, callback
//     and status end to end;
//   - one bot ("Aurora") with its own Connected apps switch off.
//
//   GET /__parity/plugins  -> { broker, botId, mcp: { tokens } }
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PLUGIN_LAB = process.env.PARITY_PLUGINS === "1";

const BROKER_TOKEN = "b".repeat(64);
const lab = {
  broker: {
    accounts: {
      gmail: [
        { id: "ca_work", alias: "Work", status: "ACTIVE" },
        { id: "ca_personal", alias: "Personal", status: "ACTIVE" },
      ],
    },
    authorizes: [],
    removed: [],
    statusReads: [],
  },
  botId: null,
  oauth: null,
};

const CATALOG = [
  { slug: "gmail", name: "Gmail", meta: { description: "Lire, rédiger et envoyer des courriels." } },
  { slug: "notion", name: "Notion", meta: { description: "Pages et bases de données de remplacement." } },
  { slug: "slack", name: "Slack", meta: { description: "Canaux et messages de remplacement." } },
  { slug: "hackernews", name: "Hacker News", no_auth: true, meta: { description: "Lecture publique, sans compte." } },
];

function serviceState(slug) {
  const accounts = lab.broker.accounts[slug] ?? [];
  const pending = lab.broker.authorizes.some((entry) => entry.slug === slug) && accounts.length === 0;
  return {
    connected: accounts.some((account) => account.status === "ACTIVE"),
    pending,
    status: accounts.length ? "ACTIVE" : pending ? "INITIATED" : "not_connected",
    accounts,
  };
}

export function startPluginLabBroker() {
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://broker");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${BROKER_TOKEN}`) return send(401, { error: "unauthorized" });
      if (req.method === "GET" && url.pathname === "/v1/catalog") {
        return send(200, { items: CATALOG, total_items: CATALOG.length, current_page: 1, total_pages: 1 });
      }
      if (req.method === "GET" && url.pathname === "/v1/connectors/connected") {
        const services = {};
        for (const slug of Object.keys(lab.broker.accounts)) {
          if (lab.broker.accounts[slug].length) services[slug] = serviceState(slug);
        }
        return send(200, { services });
      }
      if (req.method === "GET" && url.pathname === "/v1/connectors") {
        const services = {};
        for (const slug of (url.searchParams.get("services") ?? "").split(",").filter(Boolean)) {
          lab.broker.statusReads.push(slug);
          services[slug] = serviceState(slug);
        }
        return send(200, { services });
      }
      const authorize = url.pathname.match(/^\/v1\/connectors\/([\w-]+)\/authorize$/);
      if (req.method === "POST" && authorize) {
        let alias = null;
        try { alias = JSON.parse(raw || "{}").alias ?? null; } catch { /* no body */ }
        lab.broker.authorizes.push({ slug: authorize[1], alias });
        return send(200, { url: `https://connect.composio.dev/link/parity-${authorize[1]}` });
      }
      const account = url.pathname.match(/^\/v1\/connectors\/([\w-]+)\/accounts\/([\w-]+)$/);
      if (req.method === "DELETE" && account) {
        const [, slug, id] = account;
        const before = lab.broker.accounts[slug] ?? [];
        lab.broker.accounts[slug] = before.filter((entry) => entry.id !== id);
        const removed = before.length - lab.broker.accounts[slug].length;
        if (removed) lab.broker.removed.push({ slug, id });
        return send(200, { removed });
      }
      return send(404, { error: "not in the plugins lab broker" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    resolve(server.address().port);
  }));
}

export function pluginLabServerEnv(brokerPort) {
  return { SAGAX_COMPOSIO_BROKER_URL: `http://127.0.0.1:${brokerPort}`, SAGAX_COMPOSIO_BROKER_TOKEN: BROKER_TOKEN };
}

/** Pass one: the OAuth MCP server and Aurora's switch off. */
export async function seedPluginLab(base, api, root, ids) {
  const { startFakeOAuthMcp } = await import(pathToFileURL(join(root, "server", "testing", "fake-oauth-mcp-server.ts")).href);
  lab.oauth = await startFakeOAuthMcp();
  await api(base, "POST", "/api/mcp/servers", { name: "oauthdocs", url: lab.oauth.mcpUrl });
  lab.botId = ids.aurora.id;
  await api(base, "PATCH", `/api/bots/${lab.botId}`, { composio: false });
}

export async function closePluginLab() {
  await lab.oauth?.close().catch(() => {});
}

/** Handles /__parity/plugins; false for anything else. */
export async function pluginLabHook(req, res, url) {
  if (url.pathname !== "/__parity/plugins") return false;
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (!PLUGIN_LAB) return send(404, { error: "start the fixture with PARITY_PLUGINS=1" }), true;
  send(200, { broker: lab.broker, botId: lab.botId, mcp: { tokens: lab.oauth ? [...lab.oauth.validAccess].length : 0 } });
  return true;
}
