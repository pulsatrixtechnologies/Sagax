/** Isolated gallery for the bot panel's Routines list (condensed rows: one
 * rounded card, hairline separators, the schedule in words on one line even
 * when paused, a switch on the right). Neutral fictional routines. Not
 * shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CalendarClock, Plus } from "lucide-react";
import { RoutineList } from "../components/routines/RoutineList";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import type { Routine } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

const NOW = Date.now();
const H = 3_600_000;
const base = { prompt: "", target: "bot", botId: "pepper", runOn: "maus", durationMinutes: 30, createdAt: 1, updatedAt: 1 };
const routines = [
  { ...base, id: "r1", name: "Morning summary of the shared inbox", enabled: true, schedule: { type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" }, nextRunAt: NOW + H },
  { ...base, id: "r2", name: "Weekly planning digest", enabled: true, schedule: { type: "cron", expression: "6 8 * * 1", timeZone: "America/Toronto" }, nextRunAt: NOW + 30 * H },
  { ...base, id: "r3", name: "Check the release checklist", enabled: false, schedule: { type: "cron", expression: "0 17 * * 5", timeZone: "America/Toronto" }, nextRunAt: undefined },
  { ...base, id: "r4", name: "Hourly status sweep", enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: 1 }, nextRunAt: undefined },
  { ...base, id: "r5", name: "One-time reminder", enabled: true, schedule: { type: "once", at: NOW + 72 * H }, nextRunAt: NOW + 72 * H },
] as unknown as Routine[];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <aside data-gallery-panel="" className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel px-4 pt-4 text-ink">
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-ink-secondary" />
            <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h2>
            <span className="ui-icon-button"><Plus size={15} /></span>
          </div>
          <RoutineList routines={routines} runs={[]} onOpen={() => {}} onToggle={() => {}} grouped />
        </section>
      </aside>
    </StoreProvider>
  </StrictMode>,
);
