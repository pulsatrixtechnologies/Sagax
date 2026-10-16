/** Isolated gallery for Playwright screenshots of the task windows
 * (2026-10-16): a task's detail at Settings' size, in two columns, with its
 * live conversation, and History as master and detail. Not shipped; every
 * request is answered here from fixtures, nothing reaches a server.
 * ?skin=<id>&lang=<code>&view=detail|conversation|history|settings */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ActivityDetailModal } from "../components/bot-settings/ActivityDetailModal";
import { ActivityListModal } from "../components/bot-settings/ActivityListModal";
import { SETTINGS_WINDOW } from "../components/SettingsPrimitives";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState } from "../state/store";
import type { BotActivityDetail, BotActivityItem } from "../../shared/bot-activity";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.5.7", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "detail";

const NOW = Date.now();
const task: BotActivityItem = {
  id: "thread:t1", kind: "session", botId: "pepper", botName: "Pepper", title: "test",
  status: "running", startedAt: NOW - 95_000, updatedAt: NOW, threadId: "t1", startedBy: { kind: "person", name: "JC" }, coding: true, childCount: 1,
};
const done: BotActivityItem = { ...task, id: "thread:t2", threadId: "t2", title: "Corriger le lien de la facture", status: "finished", startedAt: NOW - 3_600_000, endedAt: NOW - 3_300_000, updatedAt: NOW - 3_300_000, childCount: undefined };
const broke: BotActivityItem = { ...task, id: "thread:t3", threadId: "t3", title: "Mettre à jour les dépendances", status: "failed", startedAt: NOW - 7_200_000, endedAt: NOW - 7_000_000, updatedAt: NOW - 7_000_000, childCount: undefined };
const steps = [
  { id: "s1", name: "Read", summary: "src/components/bot-settings/ActivityDetailModal.tsx", ok: true, at: NOW - 80_000, where: "server" as const },
  { id: "s2", name: "mcp__sagax-desktop__shell", summary: "pnpm typecheck", ok: true, at: NOW - 70_000, where: "computer" as const },
  { id: "s3", name: "Grep", summary: "Envoyer un message à cette tâche", ok: true, at: NOW - 60_000, where: "server" as const },
  { id: "s4", name: "Edit", summary: "src/components/bot-settings/ActivityListModal.tsx", ok: true, at: NOW - 50_000, where: "server" as const, files: ["src/components/bot-settings/ActivityListModal.tsx"] },
  { id: "s5", name: "mcp__sagax-desktop__shell", summary: "pnpm vitest run src/components/bot-settings", ok: false, at: NOW - 40_000, where: "computer" as const },
  { id: "s6", name: "Edit", summary: "src/components/bot-settings/ActivitySection.test.ts", ok: true, at: NOW - 30_000, where: "server" as const },
  { id: "s7", name: "mcp__sagax-desktop__shell", summary: "pnpm vitest run src/components/bot-settings", ok: true, at: NOW - 20_000, where: "computer" as const },
  { id: "s8", name: "Bash", summary: "git status", at: NOW - 5_000, where: "server" as const },
];
const detailOf = (item: BotActivityItem): BotActivityDetail => ({
  ...item,
  engine: { instanceId: "claude", model: "claude-opus-5-5" },
  via: "subscription",
  payer: "speaker",
  steps: item.status === "running" ? steps : steps.slice(0, 4).map((step) => ({ ...step, ok: true })),
  stepsTruncated: false,
  files: ["src/components/bot-settings/ActivityListModal.tsx"],
  children: item.id === "thread:t1" ? [{ id: "thread:c1", kind: "subagent", botId: "pepper", botName: "Pepper", title: "Écrire les tests du dialogue", status: "running", startedAt: NOW - 30_000, updatedAt: NOW, threadId: "c1" }] : [],
  canStop: item.status === "running",
});
const messages = [
  { id: "m1", role: "user", kind: "text", at: NOW - 95_000, text: "Mets le détail d'une tâche à la taille des Réglages, en deux colonnes." },
  { id: "m2", role: "bot", kind: "activity", at: NOW - 80_000, parentId: "m1", tool: { name: "Read", ok: true, summary: "ActivityDetailModal.tsx" } },
  { id: "m3", role: "bot", kind: "activity", at: NOW - 70_000, parentId: "m2", tool: { name: "mcp__sagax-desktop__shell", ok: true, summary: "pnpm typecheck" } },
  { id: "m4", role: "bot", kind: "text", at: NOW - 60_000, parentId: "m3", text: "Je reprends le gabarit de SettingsModal : 900 x 700, le résumé à gauche et les étapes à droite. Je lance les tests ciblés." },
  { id: "m5", role: "bot", kind: "activity", at: NOW - 20_000, parentId: "m4", tool: { name: "mcp__sagax-desktop__shell", ok: true, summary: "pnpm vitest run src/components/bot-settings" } },
];
const items = [task, done, broke];

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
window.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/activity?") || url.endsWith("/activity")) return json({ items, subagents: [], launchedAgents: [] });
  const match = /threadId=([^&]+)/.exec(url);
  if (url.includes("/activity/") || match) {
    const id = match ? decodeURIComponent(match[1]) : "";
    const item = items.find((entry) => entry.threadId === id) ?? (id === "c1" ? { ...task, id: "thread:c1", threadId: "c1", title: "Écrire les tests du dialogue", kind: "subagent" as const } : task);
    return json({ item: detailOf(item) });
  }
  if (url.includes("/api/threads/")) return json({ messages, hasMore: false, activeLeafId: "m5" });
  return new Promise<Response>(() => {});
}) as typeof fetch;
// No live stream in a gallery.
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

const bot = {
  id: "pepper", name: "Pepper", threadId: "main", tasks: [{ threadId: "t1", title: "test", createdAt: NOW - 95_000 }, { threadId: "main", title: "Accueil", createdAt: NOW - 9e6 }],
  messages: [], hasMore: false, activeLeafId: null, busy: true, modelSelection: { instanceId: "claude", model: "claude-opus-5-5" }, approvalMode: "ask",
};
const store = {
  state: { ...initialState, bots: [bot], selectedId: "pepper", instances: [{ instanceId: "claude", displayName: "Claude Code", engineId: "claude", models: { options: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }] }, snapshot: { authenticated: true, installed: true } }], config: null },
  dispatch: () => {},
} as never;

function Gallery() {
  return (
    <BotEditorStore value={store}>
      <div className="min-h-screen bg-app" data-gallery={view}>
        {view === "settings" && <div className={SETTINGS_WINDOW.backdrop}><div className={SETTINGS_WINDOW.frame} data-settings-size="" /></div>}
        {(view === "detail" || view === "conversation") && <ActivityDetailModal item={task} onClose={() => {}} onChanged={() => {}} />}
        {view === "history" && <ActivityListModal botId="pepper" filter="coding" onFilter={() => {}} onClose={() => {}} onStop={() => {}} stopping={new Set()} />}
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
