/** Isolated gallery for headless screenshots of a Tailcat remote session:
 * the bot panel's Sessions à distance section above Routines (its
 * neighbour), the chat card, and the Computer tab's read-only screen. The
 * capture answers /api itself (GET .../remote-sessions, .../screen), so
 * ?rows=0 shows the empty state. Not shipped in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CalendarClock, Plus } from "lucide-react";
import type { RemoteSessionView } from "../../shared/remote-session";
import { RemoteSessionCard } from "../components/remote-session/RemoteSessionCard";
import { RemoteSessionControl } from "../components/remote-session/RemoteSessionControl";
import { RemoteControlSurface } from "../components/remote-session/RemoteControlSurface";
import { RemoteSessionsSection } from "../components/remote-session/RemoteSessionsSection";
import { RoutineList } from "../components/routines/RoutineList";
import { setLocale, t } from "../lib/i18n";
import type { Routine } from "../lib/routines";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const NOW = Date.now();
const H = 3_600_000;
const view: RemoteSessionView = {
  id: "0123456789ab",
  code: "BQDHS7",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: new Date(NOW + 2 * H).toISOString(),
  hostname: "POSTE-01",
  osName: "Windows Server 2022",
  user: "exemple\\usager",
  model: "PowerEdge R650",
  serial: "7XK2Q93",
  cpu: "Intel Xeon Silver 4310",
  ram: "32 Go",
  disk: "212 Go libres sur 476 Go",
  suggestions: [{ id: "rights" }, { id: "cpu" }, { id: "errors" }, { id: "startup" }],
};
const routine = (id: string, name: string, everyMinutes: number): Routine => ({
  id, name, prompt: "", target: "bot", botId: "melonie", runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes, anchorAt: 1 }, durationMinutes: 30, nextRunAt: NOW + H, createdAt: 1, updatedAt: 1,
} as Routine);

function Gallery() {
  return (
    <div className="flex items-start gap-6 bg-app p-4 text-ink">
      <aside data-gallery-panel="" className="w-[380px] shrink-0 rounded-xl border border-hairline/40 bg-panel">
        <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
          <RemoteSessionsSection bot={{ id: "melonie" } as Bot} />
          <section data-bot-settings-section="routines" className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CalendarClock size={16} className="text-ink-secondary" />
              <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h2>
              <span className="ui-icon-button"><Plus size={15} /></span>
            </div>
            <RoutineList routines={[routine("r1", "Résumé du matin", 1440)]} runs={[]} onOpen={() => {}} grouped toggle={false} />
          </section>
        </div>
      </aside>
      <div data-gallery-card="" className="w-[560px] shrink-0">
        <RemoteSessionCard botId="melonie" threadId="thread-1" view={view} />
      </div>
      <aside data-gallery-computer="" className="w-[380px] shrink-0 rounded-xl border border-hairline/40 bg-panel px-4 pt-4">
        <RemoteSessionControl botId="melonie" />
      </aside>
      <aside data-gallery-control="" className="flex w-[380px] shrink-0 flex-col gap-4">
        <div className="overflow-hidden rounded-xl border border-hairline bg-panel">
          <RemoteControlSurface controllable active connecting={false} frameUrl={MOCK_FRAME} aspect={16 / 9} error={null} missed={false} onToggle={() => {}} />
        </div>
        <div className="overflow-hidden rounded-xl border border-hairline bg-panel">
          <RemoteControlSurface controllable={false} active={false} connecting={false} frameUrl={null} aspect={16 / 10} error={null} missed={false} />
        </div>
      </aside>
    </div>
  );
}

// A mocked frame (a neutral desktop) so a headless capture shows the live
// control surface without a real session: never a real screen.
const MOCK_FRAME = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='640' height='360' fill='#1f2933'/><rect x='0' y='0' width='640' height='28' fill='#111827'/><circle cx='320' cy='190' r='40' fill='#374151'/><text x='320' y='320' fill='#9ca3af' font-family='sans-serif' font-size='16' text-anchor='middle'>POSTE-01</text></svg>`,
);

// the capture serves this list; ?rows=0 serves an empty one
(window as unknown as { __remoteRows: RemoteSessionView[] }).__remoteRows = params.get("rows") === "0" ? [] : [view];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Gallery />
    </StoreProvider>
  </StrictMode>,
);
