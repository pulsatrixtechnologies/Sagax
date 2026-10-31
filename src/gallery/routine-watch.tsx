/** Isolated gallery for headless screenshots of "Only when something
 * changes" in the routine modal (2026-10-26), next to the same modal with
 * no watch, and the Automations row badge. Mocked API (Check now answers a
 * canned reading); no server. Not shipped in the app.
 * ?lang=<code>&skin=<id>&sample=off|files|tool|command|list */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RoutineEditor } from "../components/RoutineCalendarPage";
import { RoutineList } from "../components/routines/RoutineList";
import { loadLocale } from "../lib/i18n";
import type { Routine } from "../lib/routines";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const sample = params.get("sample") ?? "files";

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/routines/watch-check")) {
    return new Response(JSON.stringify({
      ok: true, summary: "3 items", items: 3, ms: 184,
      condition: { holds: true, seen: "$.items.length = 3" },
      excerpt: '{"items":[{"id":"A-104","status":"open","priority":1},{"id":"A-105","status":"open","priority":2},{"id":"A-109","status":"waiting","priority":1}]}',
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/")) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const bot = { id: "bot-ember", name: "Ember", color: "violet", tasks: [], threadId: "thread-ember" } as unknown as Bot;
const base = {
  id: "routine-1", name: "Nouveaux éléments prioritaires", prompt: "Résume les nouveaux éléments prioritaires et dis-moi quoi faire.",
  target: "bot", botId: bot.id, runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes: 15, anchorAt: Date.parse("2026-10-26T13:00:00Z") },
  durationMinutes: 30, nextRunAt: Date.now() + 900_000, createdAt: Date.now(), updatedAt: Date.now(),
};
const watches: Record<string, unknown> = {
  files: { kind: "watch", source: { type: "files", path: "rapports/entrants", recursive: true } },
  tool: {
    kind: "watch", source: { type: "tool", tool: "tracker__search_items", args: { status: "open", priority: 1 } },
    track: { items: "$.items", key: "id", fields: ["status", "priority"] },
    condition: { test: "json_path", path: "$.items.length", op: "gt", value: 0 },
  },
  command: {
    kind: "watch", source: { type: "command", command: "git status --short" },
    condition: { test: "exit_code", op: "ne", value: 0 }, wakeOn: "match", whenAsleep: "wake",
  },
};
const routine = { ...base, ...(watches[sample] ? { precheck: watches[sample] } : {}) } as unknown as Routine;
const plain = { ...base, id: "routine-2", name: "Bilan du matin", schedule: { type: "daily", time: "08:30", weekdays: [1, 2, 3, 4, 5] } } as unknown as Routine;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      {sample === "list"
        ? <div style={{ width: 420, padding: 16 }} data-gallery-card><RoutineList routines={[{ ...routine, precheck: watches.tool } as unknown as Routine, plain]} runs={[]} onOpen={() => {}} /></div>
        : <RoutineEditor routine={routine} bots={[bot]} lockedBotId={bot.id} onClose={() => {}} />}
    </StoreProvider>
  </StrictMode>,
);
