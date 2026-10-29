/** Isolated gallery for headless screenshots of View run (2026-10-29): a
 * routine's report in the chat with its "Routine: <name> · View run" line,
 * and what the click opens, through the chat's own row and the real store.
 * Neutral fictional bot, routine and run; a mocked fetch answers the reads
 * so nothing connects. Not shipped in the app.
 * ?width=<px>&height=<px>&skin=<id> (pulsatrix: dark, pulsatrix-light: light) */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { RoutineRunRow } from "../components/ChatView";
import { RoutinesPage } from "../components/RoutineCalendarPage";
import { SideThreadPanel } from "../components/SideThreadPanel";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import type { Routine, RoutineRun } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale("en");
const width = Number(params.get("width") ?? 1200);
const height = Number(params.get("height") ?? 760);

const NOW = Date.now();
const H = 3_600_000;
const report = "All three services are healthy. Two open items:\n\n| Area | State |\n| --- | --- |\n| Build | green |\n| Dependencies | 2 updates |";
const bot = {
  id: "atlas", threadId: "atlas-thread", mainThreadId: "atlas-thread", name: "Atlas", title: "", description: "", color: "blue", notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
  tasks: [
    { threadId: "atlas-thread", title: "Main", createdAt: NOW - 48 * H },
    { threadId: "atlas-run-thread", title: "Project health watch", createdAt: NOW - H, routineRunId: "x1" },
  ],
} as unknown as Bot;
const routines = [{
  id: "r1", botId: "atlas", name: "Project health watch", prompt: "Check the build, the dependencies and the open issues; report what needs attention.",
  target: "bot", runOn: "maus", durationMinutes: 30, timeoutMinutes: 45, createdAt: 1, updatedAt: 1, canRun: true, canEdit: true, enabled: true,
  schedule: { type: "cron", expression: "35 11 * * *", timeZone: "America/Toronto" }, nextRunAt: NOW + 20 * H, weekRuns: { ok: 5, total: 5 },
}] as unknown as Routine[];
const runs = [{
  id: "x1", routineId: "r1", routineName: "Project health watch", prompt: routines[0]!.prompt, timeoutMinutes: 45, target: "bot", botId: "atlas", runOn: "maus",
  scheduledFor: NOW - H, createdAt: NOW - H, startedAt: NOW - H + 20_000, finishedAt: NOW - H + 4 * 60_000, status: "completed", manual: false,
  output: report, cost: 0.021, threadId: "atlas-run-thread", executionThreadId: "atlas-run-thread", resultsThreadId: "atlas-thread", seenAt: NOW - H,
}] as unknown as RoutineRun[];
const message: Message = {
  id: "m-report", role: "bot", kind: "routine.run", at: NOW - H + 4 * 60_000, from: { botId: "atlas" },
  routineRun: { runId: "x1", routineId: "r1", routineName: "Project health watch", status: "completed", scheduledFor: NOW - H, executionThreadId: "atlas-run-thread", summary: report },
} as unknown as Message;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/calendar-calls")) return json({ calls: [] });
  if (url.includes("/api/instances")) return json({ instances: [] });
  if (url.includes("/api/webhooks")) return json({ webhooks: [], attempts: [], ingress: {} });
  if (url.includes("/activity/item")) {
    return json({ item: {
      id: "run:x1", kind: "routine", botId: "atlas", title: "Project health watch", status: "finished", startedAt: NOW - H, endedAt: NOW - H + 4 * 60_000,
      threadId: "atlas-run-thread", startedBy: { kind: "routine", name: "Project health watch" }, engine: { instanceId: "test", model: "fable" },
      steps: [
        { id: "s1", name: "run_command", summary: "build status", ok: true, at: NOW - H + 5_000, where: "computer" },
        { id: "s2", name: "read_file", summary: "package.json", ok: true, at: NOW - H + 30_000, where: "computer" },
      ],
      stepsTruncated: false, files: [], children: [], canStop: false,
    } });
  }
  if (url.includes("/api/threads/atlas-run-thread/messages")) {
    return json({ messages: [
      { id: "p1", role: "user", at: NOW - H, text: routines[0]!.prompt },
      { id: "b1", role: "bot", at: NOW - H + 4 * 60_000, text: report, from: { botId: "atlas" } },
    ] });
  }
  if (url.includes("/api/bots?")) return json({ bots: [bot], groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/routines")) return json({ routines, runs, scope: "mine", allowed: { mine: true, team: false, all: false }, facets: { teams: [], owners: [], botChoices: [{ id: "atlas", name: "Atlas" }] } });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function Shell() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines, runs });
    dispatch({ type: "select", id: "atlas" });
  }, [dispatch]);
  const routinesShown = state.activeView === "routines";
  return (
    <div data-gallery-sample={routinesShown ? "routines" : "chat"} className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
      {routinesShown ? (
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
          <RoutinesPage fill onBack={() => {}} onOpenRoom={() => {}} />
        </div>
      ) : <>
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
          <div className="flex min-h-[52px] items-center px-4 text-[14px] font-semibold">Atlas</div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
            <div className="ml-auto w-fit rounded-2xl bg-accent/15 px-4 py-2.5 text-[14px]">Keep an eye on the project every morning.</div>
            <RoutineRunRow message={message} botId="atlas" />
          </div>
        </div>
        <SideThreadPanel />
      </>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><StoreProvider><Shell /></StoreProvider></StrictMode>,
);
