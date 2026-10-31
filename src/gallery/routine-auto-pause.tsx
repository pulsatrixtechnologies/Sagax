/** Isolated gallery for a routine that paused itself after failures in a
 * row (2026-10-26): the passing notice with Resume, the list row, the
 * history and the editor's setting. Neutral fictional routines. Not shipped.
 * ?skin=<id>&lang=<code>&view=notice|list|logs|editor */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { X } from "lucide-react";
import { RoutineRunCard } from "../components/RoutineRunCard";
import { RoutineList } from "../components/routines/RoutineList";
import { RoutineLogs } from "../components/routines/RoutineLogs";
import { RoutineEditor } from "../components/RoutineCalendarPage";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot, type Message } from "../state/store";
import type { Routine, RoutineRun } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = params.get("view") ?? "notice";

const NOW = Date.now();
const H = 3_600_000;
const schedule = { type: "cron", expression: "30 8 * * 1-5", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
const base = { prompt: "Summarize the shared inbox", target: "bot", botId: "pepper", runOn: "maus", durationMinutes: 30, createdAt: 1, updatedAt: 1 };
const routines = [
  { ...base, id: "r1", name: "Morning summary of the shared inbox", enabled: false, schedule, nextRunAt: null, failureStreak: 5, autoPaused: { at: NOW - 5 * 60_000, failures: 5, runId: "run5" } },
  { ...base, id: "r2", name: "Weekly planning digest", enabled: true, schedule: { ...schedule, expression: "6 8 * * 1" }, nextRunAt: NOW + 30 * H },
  { ...base, id: "r3", name: "Check the release checklist", enabled: false, schedule: { ...schedule, expression: "0 17 * * 5" }, nextRunAt: null },
] as unknown as Routine[];
const runs = [1, 2, 3, 4, 5].map((n) => ({
  id: `run${n}`, routineId: "r1", routineName: "Morning summary of the shared inbox", target: "bot", botId: "pepper", runOn: "maus",
  scheduledFor: NOW - (6 - n) * 24 * H, createdAt: NOW - (6 - n) * 24 * H, finishedAt: NOW - (6 - n) * 24 * H + 60_000, status: "failed", manual: false,
  triggerSource: "schedule", error: "The engine is not signed in on this computer",
  ...(n === 5 ? { autoPaused: { failures: 5 } } : {}),
})) as unknown as RoutineRun[];
const bots = [{ id: "pepper", name: "Pepper", color: "teal", tasks: [] }] as unknown as Bot[];
const message = {
  id: "m1", role: "bot", kind: "routine.run", at: NOW, text: "Routine failed",
  routineRun: { runId: "run5", routineId: "r1", routineName: "Morning summary of the shared inbox", status: "failed", scheduledFor: NOW - 60_000, error: "The engine is not signed in on this computer", autoPausedAfter: 5 },
} as unknown as Message;

function Notice() {
  // the banner of TransientNotice.tsx, as drawn over the chat
  return (
    <div className="w-[720px] px-5 pt-5">
      <div role="status" className="mb-2 flex items-start gap-2 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
        <div className="min-w-0 flex-1"><RoutineRunCard message={message} onOpen={() => {}} {...{ onResume: () => {} }} /></div>
        <button type="button" className="shrink-0 rounded p-0.5"><X size={14} /></button>
      </div>
    </div>
  );
}

function Gallery() {
  if (view === "list") return <aside className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel px-4 pt-4 text-ink"><RoutineList routines={routines} runs={runs} onOpen={() => {}} onToggle={() => {}} grouped /></aside>;
  if (view === "logs") return <RoutineLogs runs={runs} bots={bots} status="all" onStatusChange={() => {}} onClearRoutine={() => {}} onOpen={() => {}} />;
  if (view === "editor") return <RoutineEditor routine={routines[0]} bots={bots} lockedBotId="pepper" onClose={() => {}} />;
  return <Notice />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-canvas text-ink"><Gallery /></div>
    </StoreProvider>
  </StrictMode>,
);
