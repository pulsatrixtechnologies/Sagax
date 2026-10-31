/** Isolated gallery for the bot panel's Routines block, the real
 * RoutinesSection. ?routines=0 (default): a bot without routines, one quiet
 * hint line; ?routines=1: a bot with routines, the section as before.
 * Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RoutinesSection } from "../components/bot-settings/RoutinesSection";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { useEffect } from "react";
import { StoreProvider, useStore, type Bot } from "../state/store";
import type { Routine } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const bot = { id: "pepper", threadId: "t1", name: "Pepper", title: "Pepper", description: "", notifications: false, color: "green", unread: false, messages: [] } as unknown as Bot;
const H = 3_600_000;
const routines = params.get("routines") === "1"
  ? [{ id: "r1", name: "Morning summary of the shared inbox", prompt: "", target: "bot", botId: "pepper", runOn: "maus", enabled: true, schedule: { type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" }, nextRunAt: Date.now() + H, durationMinutes: 30, createdAt: 1, updatedAt: 1 }] as unknown as Routine[]
  : [];

// The store starts "loading"; the real app hydrates it from the server.
function Ready({ children }: { children: React.ReactNode }) {
  const { dispatch } = useStore();
  useEffect(() => { dispatch({ type: "routinesHydrated", routines: [], runs: [] }); }, [dispatch]);
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready>
      <aside data-gallery-panel="" className="min-h-[200px] w-[380px] border-r border-hairline/40 bg-panel px-4 py-4 text-ink">
        <section data-bot-settings-section="routines" className="flex flex-col gap-2">
          <RoutinesSection bot={bot} routines={routines} runs={[]} grouped />
        </section>
      </aside>
    </Ready></StoreProvider>
  </StrictMode>,
);
