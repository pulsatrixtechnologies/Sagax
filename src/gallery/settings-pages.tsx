/** Isolated gallery for headless screenshots of the Settings pages split on
 * 2026-10-28: Account, Security, Vault, Models and Voice, as the real
 * SettingsModal draws them on a stand-in /api (a solo person with saved
 * approval rules, a security key, tool access, vault items, voice and model
 * settings). Fictional data only, neutral names. Not shipped in the app.
 * ?section=account|security|credentials|engines|voice &skin=<id> &lang=<code>
 * scripts/capture-settings-pages.mjs shoots each page in light and dark. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal } from "../components/SettingsModal";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type AppSettingsSection } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 28, 14);
const BOTS = ["Scout", "Atlas", "Juniper"];
const RULE_TEXT = [
  "Run git status in its own folder", "Read files under ~/projects/site", "Open pages on docs.example.com",
  "Send a message to the Support team", "Run npm test", "Delete files in its scratch folder",
  "Change its own routine schedule", "Write to the shared notes", "Run the weekly report",
];
const rules = Array.from({ length: 23 }, (_, index) => ({
  id: `rule-${index + 1}`,
  botId: `bot-${index % 3}`,
  botName: BOTS[index % 3],
  tool: "Bash",
  scope: { command: `step ${index + 1}` },
  behavior: index % 5 === 0 ? "deny" : index % 7 === 0 ? "ask" : "allow",
  description: `${RULE_TEXT[index % RULE_TEXT.length]}${index >= RULE_TEXT.length ? ` (${Math.floor(index / RULE_TEXT.length) + 1})` : ""}`,
}));

const grant = (botId: string) => ({ botId, mode: "always", grantedAt: NOW - 3 * DAY });
const API: Record<string, unknown> = {
  "/api/config": {
    profile: { name: "Alex Example", email: "alex@example.com" },
    box: { configured: false },
    vps: { configured: false, sshAlias: "" },
    rooms: { turnTimeoutMinutes: 5 },
    localVm: { mode: "shared", maxInstances: 2 },
    tts: { configured: true, ready: true, voice: "", provider: "elevenlabs", keys: { elevenlabs: true, fish: false } },
    live: { enabled: true, configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 },
    imageGen: { configured: false },
    anthropic: { configured: true },
    features: {},
    onboarding: { completedAt: NOW - 30 * DAY, launchMode: "solo" },
  },
  "/api/instances": { instances: [
    { instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", cliDefault: "claude", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { default: "sonnet", options: [] } },
  ] },
  "/api/bots": { bots: BOTS.map((name, index) => ({ id: `bot-${index}`, name, instanceId: "claude", model: "default", threads: [], messages: [] })), groups: [], sections: [] },
  "/api/approval-rules": { rules },
  "/api/security-keys": { keys: [{ id: "key-1", name: "Desk key", createdAt: NOW - 40 * DAY, lastUsedAt: NOW - 2 * DAY, rpId: "localhost", deviceType: "singleDevice" }], classes: ["money"], rpId: "localhost" },
  "/api/me/tool-grants": { grants: [
    { id: "tg-1", subject: { kind: "bot", id: "bot-0" }, scope: "agents:write", grantedBy: "p-1", grantedAt: NOW - 5 * DAY, state: "active" },
    { id: "tg-2", subject: { kind: "bot", id: "bot-1" }, scope: "files:read", grantedBy: "p-1", grantedAt: NOW - 9 * DAY, expiresAt: NOW + 20 * DAY, state: "active" },
  ], adminOnlyAreas: [] },
  "/api/me/credentials/list": {
    items: [
      { id: "v-1", kind: "login", name: "Docs portal", username: "alex", domains: ["docs.example.com"], hasPassword: true, hasTotp: true, hasApiKey: false, hasNotes: false, source: "local", grants: [grant("bot-0")], createdAt: NOW - 20 * DAY, updatedAt: NOW - 20 * DAY, lastUsedAt: NOW - DAY, lastUsedBy: "bot-0" },
      { id: "v-2", kind: "apiKey", name: "Weather API", domains: ["api.example.com"], hasPassword: false, hasTotp: false, hasApiKey: true, hasNotes: false, source: "local", grants: [grant("bot-1")], createdAt: NOW - 12 * DAY, updatedAt: NOW - 12 * DAY },
      { id: "v-4", kind: "login", name: "Example signup", username: "alex@example.com", domains: ["accounts.example.com"], hasPassword: true, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local", grants: [grant("bot-1")], createdAt: NOW - DAY, updatedAt: NOW - DAY },
      { id: "v-3", kind: "note", name: "Office wifi", domains: [], hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: true, source: "local", grants: [], createdAt: NOW - 6 * DAY, updatedAt: NOW - 6 * DAY },
    ],
    wallets: { shop_pay: { chosen: true, ready: true, missing: "" }, link: { chosen: false, ready: false, missing: "the Link CLI" } },
    onePassword: { available: false, reason: "absent" },
  },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const body = API[url.pathname];
  if (body !== undefined) return json(body);
  return json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;

const section = (params.get("section") ?? "account") as AppSettingsSection;

function OpenSettings() {
  const { dispatch } = useStore();
  useEffect(() => { dispatch({ type: "toggleAppSettings", open: true, section }); }, [dispatch]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex h-screen bg-app text-ink" data-gallery-settings-pages="">
        <OpenSettings />
        <SettingsModal />
      </div>
    </StoreProvider>
  </StrictMode>,
);
