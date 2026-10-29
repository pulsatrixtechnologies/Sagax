/** Isolated gallery for headless screenshots of the Automations page header
 * (the calendar, the list and the logs, with problem runs, paused routines and
 * the organization scope). Neutral fictional bots and routines; a mocked fetch
 * answers the page's reads so nothing connects. Not shipped in the app.
 * ?view=calendar|list|logs&width=<px>&height=<px>&lang=<code>&skin=<id> (pulsatrix: dark, pulsatrix-light: light)
 * &deleted=1 adds a past run of a routine deleted since (#1506).
 * &goal=1 adds a one-time team goal that ran once this week (#1516). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RoutinesPage } from "../components/RoutineCalendarPage";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type AppState, type Bot } from "../state/store";
import type { Routine, RoutineRun } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");
const view = (params.get("view") ?? "calendar") as "calendar" | "list" | "logs";
const width = Number(params.get("width") ?? 1100);
const height = Number(params.get("height") ?? 560);

const NOW = Date.now();
const H = 3_600_000;
const bot = (id: string, name: string, color: string): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
} as unknown as Bot);
const bots = [bot("atlas", "Atlas", "blue"), bot("boreas", "Boreas", "green"), bot("cirrus", "Cirrus", "purple")];
const base = { prompt: "Summarize.", target: "bot", runOn: "maus", durationMinutes: 30, createdAt: 1, updatedAt: 1 };
const routines = [
  { ...base, id: "r1", botId: "atlas", name: "Morning inbox summary", enabled: true, schedule: { type: "daily", time: "08:30", weekdays: [1, 2, 3, 4, 5] }, nextRunAt: NOW + H },
  { ...base, id: "r2", botId: "boreas", name: "Weekly planning digest", enabled: true, schedule: { type: "daily", time: "10:00", weekdays: [1] }, nextRunAt: NOW + 30 * H },
  { ...base, id: "r3", botId: "cirrus", name: "Release checklist", enabled: false, schedule: { type: "daily", time: "17:00", weekdays: [5] } },
  { ...base, id: "r4", botId: "atlas", name: "Hourly status sweep", enabled: false, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } },
  ...(params.get("goal") === "1" ? [{ ...base, id: "g1", target: "room-goal", groupId: "room1", botId: "atlas", name: "Team hello", prompt: "Everyone say hello.", enabled: true, schedule: { type: "once", at: NOW + 2 * H }, nextRunAt: NOW + 2 * H, weekRuns: { ok: 1, total: 1 } }] : []),
] as unknown as Routine[];
const run = (id: string, routineId: string, status: RoutineRun["status"], at: number): RoutineRun => ({
  id, routineId, routineName: routines.find((routine) => routine.id === routineId)!.name, target: "bot",
  botId: routines.find((routine) => routine.id === routineId)!.botId!, runOn: "maus", scheduledFor: at, createdAt: at, status, manual: false,
  ...(status === "failed" ? { error: "The engine stopped" } : {}),
} as RoutineRun);
const deletedRun = {
  id: "x5", routineId: "gone", routineName: "Quarterly cleanup", target: "bot", botId: "cirrus", runOn: "maus",
  scheduledFor: NOW - 3 * H, createdAt: NOW - 3 * H, status: "completed", manual: false,
} as RoutineRun;
const runs = [
  ...(params.get("deleted") === "1" ? [deletedRun] : []),
  run("x1", "r1", "failed", NOW - 20 * H),
  run("x2", "r2", "missed", NOW - 44 * H),
  run("x3", "r1", "completed", NOW - 4 * H),
  run("x4", "r2", "running", NOW - 0.1 * H),
];

const state: AppState = {
  ...initialState,
  bots,
  routines,
  routineRuns: runs,
  routinesLoadState: "ready",
  routinesFocus: { section: view === "logs" ? "logs" : "schedule", view: view === "list" ? "list" : "calendar", nonce: 1 },
  config: {
    ...initialState.config,
    viewer: { principalId: "pr_viewer", profileManagedBy: "perspicax", role: "admin" },
  } as unknown as AppState["config"],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/calendar-calls")) return json({ calls: [] });
  if (url.includes("/api/routines")) {
    return json({
      routines, runs, scope: "mine", allowed: { mine: true, team: true, all: true },
      facets: { teams: [{ id: "t1", name: "Support" }], owners: [{ id: "pr_viewer", name: "Alex Doe" }], botChoices: bots.map((entry) => ({ id: entry.id, name: entry.name })) },
    });
  }
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={value}>
      <div data-gallery-sample={view} className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
        {/* the app's content frame, so a skin's card treatment shows as in the app */}
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
          <RoutinesPage fill onBack={() => {}} onOpenRoom={() => {}} />
        </div>
      </div>
    </BotEditorStore>
  </StrictMode>,
);
