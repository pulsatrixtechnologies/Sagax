/** Isolated gallery for headless screenshots of the Approvals screen's
 * Journal tab (2026-10-26): the real ApprovalsPage with a fake store, its
 * routes answered here (pending, history, journal, rule test), so the
 * Journal sits beside the History it joins. Not shipped in the app.
 * ?lang=<code>&skin=<id>&tab=journal|history&test=1 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalsPage } from "../components/approvals/ApprovalsPage";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type useStore } from "../state/store";
import type { JournalEntry, JournalPayload, RuleTestResult } from "../../shared/action-journal";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const tab = params.get("tab") === "history" ? "history" : "journal";
history.replaceState(null, "", `${location.pathname}${location.search}#approvals?tab=${tab}`);

const bots = [
  { id: "bot-nova", name: "Nova", color: "violet", tasks: [] },
  { id: "bot-atlas", name: "Atlas", color: "teal", tasks: [] },
] as unknown as Bot[];

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const entries: JournalEntry[] = [
  { key: "e1", at: minutesAgo(3), botId: "bot-nova", botName: "Nova", threadId: "t1", requestId: "r1", tool: "Bash", summary: "rm -rf ~/Projets/demo/build", outcome: "denied", decider: "custom-rule", source: "custom-rule-deny", ruleText: "supprimer des fichiers dans ~/Projets", ruleBehavior: "deny" },
  { key: "e2", at: minutesAgo(9), botId: "bot-nova", botName: "Nova", threadId: "t1", requestId: "r2", tool: "Read", summary: "~/Projets/demo/README.md", outcome: "allowed", decider: "custom-rule", source: "custom-rule", ruleText: "lire des fichiers dans ~/Projets", ruleBehavior: "allow", ran: "ran" },
  { key: "e3", at: minutesAgo(14), botId: "bot-atlas", botName: "Atlas", threadId: "t2", requestId: "r3", tool: "mcp__mail__send_email", summary: "À : equipe@example.com, Objet : Résumé de la semaine", outcome: "allowed", decider: "person", source: "user", askedBy: "level", askedSource: "no-grant", answeredBy: "@self" },
  { key: "e4", at: minutesAgo(22), botId: "bot-atlas", botName: "Atlas", threadId: "t2", requestId: "r4", tool: "Write", summary: "~/Documents/rapport.md", outcome: "asked", decider: "level", source: "no-grant" },
  { key: "e5", at: minutesAgo(40), botId: "bot-nova", botName: "Nova", threadId: "t3", requestId: "r5", tool: "Bash", summary: "npm test", outcome: "failed", decider: "full-access", source: "owner-bypass", ran: "failed" },
  { key: "e6", at: minutesAgo(65), botId: "bot-nova", botName: "Nova", threadId: "t3", requestId: "r6", tool: "mcp__agents__create_agent", outcome: "asked", decider: "level", source: "no-grant", guard: { allow: false, reason: "not_granted", mode: "shadow", scope: "agents:admin" } },
  { key: "e7", at: minutesAgo(130), botId: "bot-atlas", botName: "Atlas", threadId: "t4", requestId: "r7", tool: "mcp__files__delete_file", summary: "/srv/partage/ancien.csv", outcome: "denied", decider: "org-rule", source: "custom-rule-deny", ruleText: "supprimer des fichiers partagés", ruleBehavior: "deny" },
  { key: "e8", at: minutesAgo(200), botId: "bot-atlas", botName: "Atlas", threadId: "t4", requestId: "r8", tool: "WebFetch", outcome: "expired", decider: "expired", source: "timeout", askedBy: "level", askedSource: "no-grant" },
  { key: "e9", at: minutesAgo(260), botId: "bot-nova", botName: "Nova", threadId: "t1", tool: "Grep", outcome: "allowed", decider: "no-card", ran: "ran" },
  { key: "e10", at: minutesAgo(320), botId: "bot-nova", botName: "Nova", threadId: "t1", requestId: "r10", tool: "Edit", summary: "~/Projets/demo/src/app.ts", outcome: "allowed", decider: "always-allow", source: "owner-rule", ruleText: "Modifier ~/Projets/demo/src/app.ts", ran: "ran" },
];
const journal: JournalPayload = { entries, days: 7 };
const testResult: RuleTestResult = {
  days: 7, scanned: 10, matched: 2, counts: { allowed: 0, asked: 0, denied: 2, cardStays: 0, changed: 1 },
  hits: [
    { key: "e10", at: minutesAgo(320), botName: "Nova", tool: "Edit", summary: "~/Projets/demo/src/app.ts", actual: "allowed", would: "denied", changed: true },
    { key: "e1", at: minutesAgo(3), botName: "Nova", tool: "Bash", summary: "rm -rf ~/Projets/demo/build", actual: "denied", would: "denied", changed: false },
  ],
};
const historyRows = [
  { at: minutesAgo(14), decision: "user-approved", who: "Vous", botName: "Atlas", tool: "mcp__mail__send_email", summary: "À : equipe@example.com", threadId: "t2" },
  { at: minutesAgo(90), decision: "user-denied", who: "Vous", botName: "Nova", tool: "Bash", summary: "git push --force", threadId: "t1" },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/auth/session")) return json({});
  if (url.includes("/api/approvals/journal/test")) return json(testResult);
  if (url.includes("/api/approvals/journal")) return json(journal);
  if (url.includes("/api/approvals")) return json({ pending: [], history: historyRows, scopes: { org: false, team: false } });
  return realFetch(input, init);
};

const store = { state: { bots, groups: [] }, dispatch: () => {}, flushBotPatches: async () => null } as unknown as ReturnType<typeof useStore>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <div data-gallery-panel="page" className="h-screen bg-app">
        <ApprovalsPage />
      </div>
    </BotEditorStore>
  </StrictMode>,
);
