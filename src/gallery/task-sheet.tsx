/** Isolated gallery for headless screenshots of a task's sheet (the window
 * that opens on a sub-agent, a parallel task or a run), with a realistic
 * fixture: a long run of the same routine action, a question the task
 * asks, four sub-agents of which one waits for an approval. Not shipped;
 * every request is answered here from fixtures, nothing reaches a server.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ActivityDetailModal } from "../components/bot-settings/ActivityDetailModal";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState } from "../state/store";
import type { BotActivityDetail, BotActivityItem, BotActivityStep } from "../../shared/bot-activity";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.17", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
setLocale(lang);
document.documentElement.lang = lang;
const fr = lang.startsWith("fr");

const NOW = Date.now();
const MIN = 60_000;

const task: BotActivityItem = {
  id: "thread:t1", kind: "session", botId: "wren", botName: "Wren", title: fr ? "Relancer les clients sans réponse" : "Follow up with silent clients",
  status: "waiting", startedAt: NOW - 14 * MIN, updatedAt: NOW, threadId: "t1", startedBy: { kind: "person", name: "Alex" }, parallel: true, childCount: 4,
  currentStep: fr ? "Exécute une action de routine" : "Run the routine action",
};

const children: BotActivityItem[] = [
  { id: "thread:c1", kind: "subagent", botId: "olive", botName: "Olive", title: fr ? "Lire les derniers courriels" : "Read the latest emails", status: "finished", startedAt: NOW - 12 * MIN, endedAt: NOW - 9 * MIN, updatedAt: NOW - 9 * MIN, threadId: "c1", startedBy: { kind: "bot", name: "Wren" } },
  { id: "thread:c2", kind: "subagent", botId: "sol", botName: "Sol", title: fr ? "Préparer les relances" : "Draft the follow-ups", status: "waiting", startedAt: NOW - 8 * MIN, updatedAt: NOW - MIN, threadId: "c2", startedBy: { kind: "bot", name: "Wren" }, currentStep: fr ? "Envoyer un courriel" : "Send an email", canStop: true },
  { id: "thread:c3", kind: "subagent", botId: "olive", botName: "Olive", title: fr ? "Vérifier les billets ouverts" : "Check the open tickets", status: "running", startedAt: NOW - 5 * MIN, updatedAt: NOW, threadId: "c3", startedBy: { kind: "bot", name: "Wren" }, currentStep: fr ? "Cherche des billets" : "Search tickets", canStop: true },
  { id: "thread:c4", kind: "subagent", botId: "sol", botName: "Sol", title: fr ? "Mettre à jour la feuille de suivi" : "Update the tracking sheet", status: "failed", startedAt: NOW - 4 * MIN, endedAt: NOW - 3 * MIN, updatedAt: NOW - 3 * MIN, threadId: "c4", startedBy: { kind: "bot", name: "Wren" } },
];

// A long run of the same routine action, a question in the middle, one
// failure, then the step still in flight.
const routine = (id: string, at: number, ok: boolean | undefined, where: "server" | "computer" = "server"): BotActivityStep => ({
  id, name: "mcp__agents__run_routine_action", at, where, ...(ok === undefined ? {} : { ok }),
  input: JSON.stringify({ routine: "follow-up", action: "next", cursor: id }),
  summary: fr ? "Action de routine suivante" : "Next routine action",
});
const steps: BotActivityStep[] = [
  { id: "s0", name: "Read", at: NOW - 13 * MIN, ok: true, where: "server", summary: "clients.csv", input: JSON.stringify({ file_path: "clients.csv" }) },
  ...Array.from({ length: 9 }, (_, index) => routine(`r${index}`, NOW - 12 * MIN + index * 20_000, true)),
  { id: "q1", name: "ask_user", at: NOW - 9 * MIN, ok: true, where: "server", summary: fr ? "Relancer aussi les comptes en pause ?" : "Follow up the paused accounts too?", input: JSON.stringify({ question: "paused accounts?" }) },
  ...Array.from({ length: 7 }, (_, index) => routine(`r${9 + index}`, NOW - 8 * MIN + index * 20_000, true)),
  { id: "a1", name: "Agent", at: NOW - 8 * MIN, ok: true, where: "server", subagent: { description: fr ? "préparer les relances" : "draft the follow-ups", prompt: fr ? "Rédige une relance par client silencieux depuis 10 jours." : "Draft one follow-up per client silent for 10 days.", result: fr ? "3 relances prêtes." : "3 follow-ups ready." } },
  { id: "a1s1", name: "Read", at: NOW - 8 * MIN + 5_000, ok: true, parentId: "a1", summary: "templates/relance.md" },
  { id: "a1s2", name: "Write", at: NOW - 8 * MIN + 15_000, ok: true, parentId: "a1", summary: "relances.md" },
  ...Array.from({ length: 3 }, (_, index) => routine(`r${16 + index}`, NOW - 5 * MIN + index * 20_000, true, "computer")),
  routine("rf", NOW - 3 * MIN, false, "computer"),
  { id: "s1", name: "Bash", at: NOW - 2 * MIN, ok: true, where: "server", summary: "git status", input: JSON.stringify({ command: "git status" }) },
  routine("rx", NOW - 40_000, undefined),
];

const detail: BotActivityDetail = {
  ...task,
  engine: { instanceId: "claude", model: "claude-opus-5-5" },
  via: "subscription",
  payer: "speaker",
  steps,
  stepsTruncated: true,
  files: ["clients.csv", "relances.md"],
  children,
  canStop: true,
};
const childDetail = (child: BotActivityItem): BotActivityDetail => ({
  ...child, engine: { instanceId: "claude", model: "claude-sonnet-5" }, via: "subscription", payer: "speaker",
  steps: steps.slice(0, 4), stepsTruncated: false, files: [], children: [], canStop: Boolean(child.canStop),
});

const question = {
  id: "m-q", role: "bot", kind: "options", at: NOW - 70_000, threadId: "t1",
  card: {
    requestId: "ask-1", title: fr ? "Relancer aussi les comptes en pause ?" : "Follow up the paused accounts too?",
    subtitle: fr ? "Deux comptes sont en pause depuis le mois dernier." : "Two accounts have been paused since last month.",
    options: [fr ? "Oui, relance-les" : "Yes, follow up", fr ? "Non, laisse-les" : "No, leave them"],
    questionRequest: { id: "ask-1" },
  },
};
const approval = {
  id: "m-a", role: "bot", kind: "options", at: NOW - MIN, threadId: "c2",
  card: {
    requestId: "req-2", tool: "mcp__mail__send_mail", mcpTool: "mcp__mail__send_mail", title: "", subtitle: fr ? "À : direction@exemple.test · Objet : Suivi de votre demande" : "To: management@example.test · Subject: Following up on your request",
    toolInput: JSON.stringify({ to: "management@example.test", subject: fr ? "Suivi de votre demande" : "Following up on your request" }),
    options: ["Allow", "Deny"], held: "The provider requires your approval for this action.", heldCode: "approval.held.native",
  },
};
const messages: Record<string, unknown[]> = {
  t1: [
    { id: "m1", role: "user", kind: "text", at: NOW - 14 * MIN, text: fr ? "Relance les clients qui n'ont pas répondu depuis dix jours." : "Follow up with the clients silent for ten days." },
    { id: "m2", role: "bot", kind: "text", at: NOW - 13 * MIN, parentId: "m1", text: fr ? "Je lis la liste et je prépare les relances." : "Reading the list and drafting the follow-ups." },
    { ...question, parentId: "m2" },
  ],
  c2: [
    { id: "c2m1", role: "user", kind: "text", at: NOW - 8 * MIN, text: fr ? "Rédige une relance par client silencieux." : "Draft one follow-up per silent client." },
    { ...approval, parentId: "c2m1" },
  ],
};

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
window.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/auth/session")) return json({ kind: "loopback", trust: "owner" });
  const match = /threadId=([^&]+)/.exec(url);
  if (url.includes("/activity/item")) {
    const id = match ? decodeURIComponent(match[1]!) : "";
    const child = children.find((entry) => entry.threadId === id);
    return json({ item: child ? childDetail(child) : detail });
  }
  const thread = /\/api\/threads\/([^/]+)\/messages/.exec(url);
  if (thread) return json({ messages: messages[decodeURIComponent(thread[1]!)] ?? [], hasMore: false, activeLeafId: null });
  if (url.includes("/activity")) return json({ items: [task], subagents: children, launchedAgents: [] });
  return new Promise<Response>(() => {});
}) as typeof fetch;
// No live stream in a gallery.
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

const bots = [
  { id: "wren", name: "Wren", color: "green", threadId: "main", tasks: [{ threadId: "t1", title: task.title, createdAt: NOW - 14 * MIN, parallelOf: { threadId: "main", messageId: "m0", at: NOW - 14 * MIN } }, { threadId: "main", title: "Accueil", createdAt: NOW - 9e6 }], messages: [], hasMore: false, activeLeafId: null, busy: true, modelSelection: { instanceId: "claude", model: "claude-opus-5-5" }, approvalMode: "ask" },
  { id: "olive", name: "Olive", color: "orange", threadId: "o-main", tasks: [], messages: [], hasMore: false, activeLeafId: null, busy: true, approvalMode: "ask" },
  { id: "sol", name: "Sol", color: "violet", threadId: "s-main", tasks: [], messages: [], hasMore: false, activeLeafId: null, busy: true, approvalMode: "ask" },
];
const store = {
  state: { ...initialState, bots, selectedId: "wren", instances: [{ instanceId: "claude", displayName: "Claude (API key)", engineId: "claude", models: { options: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }] }, snapshot: { authenticated: true, installed: true } }], config: null },
  dispatch: () => {},
  flushBotPatches: async () => null,
} as never;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <div className="min-h-screen bg-app" data-gallery="task-sheet">
        <ActivityDetailModal item={task} onClose={() => {}} onChanged={() => {}} />
      </div>
    </BotEditorStore>
  </StrictMode>,
);
