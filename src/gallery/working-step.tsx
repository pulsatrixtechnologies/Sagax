/** Isolated gallery for screenshots of the working line naming its step
 * (2026-10-29, shared/working-step.ts): the line under the transcript
 * while a call runs, worded from the row's step as the conversation draws
 * it (liveActivityPhrases into TurnPresence), with the quiet time once the
 * step lasts. Not shipped in the app. ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TurnPresence } from "../components/TurnPresence";
import { setLocale } from "../lib/i18n";
import { liveActivityPhrases } from "../lib/live-activity";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import type { WorkingStep } from "../../shared/working-step";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
setLocale(lang);
document.documentElement.lang = lang;
const fr = lang.startsWith("fr");

const bot = { name: "Wren", color: "orange" } as { name: string; color: "orange" };
const now = Date.now();
const rows: Array<{ asked: string; step: WorkingStep | null; ago: number }> = [
  { asked: fr ? "Lance le script de collecte des prix." : "Run the price scraper.", step: { key: "run", detail: "scrape.py" }, ago: 125_000 },
  { asked: fr ? "Qu'est-ce que j'ai reçu ce matin ?" : "What did I get this morning?", step: { key: "readMail" }, ago: 4_000 },
  { asked: fr ? "Ouvre le tableau de bord des ventes." : "Open the sales dashboard.", step: { key: "openApp", detail: "Chrome" }, ago: 3_000 },
  { asked: fr ? "Trouve les horaires du musée." : "Find the museum's hours.", step: { key: "searchWeb" }, ago: 2_000 },
  { asked: fr ? "Écris le compte rendu." : "Write up the summary.", step: { key: "writeFile", detail: "compte-rendu.md" }, ago: 1_000 },
  { asked: fr ? "Et pour demain ?" : "And for tomorrow?", step: null, ago: 0 },
];

function Line({ asked, step, ago }: { asked: string; step: WorkingStep | null; ago: number }) {
  const message: Message = { id: "m", at: now - ago, role: "bot", kind: "activity", tool: { name: "tool", ...(step ? { step } : {}) } };
  const activity = liveActivityPhrases(step ? message : undefined);
  return (
    <section className="flex w-[620px] flex-col gap-3 rounded-2xl bg-app px-6 py-5">
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-[18px] bg-bubble-user px-4 py-2 text-[14px] text-ink">{asked}</p>
      </div>
      <TurnPresence
        bot={bot}
        visible
        phrases={activity.phrases}
        phase={activity.phase}
        quietSince={activity.stepSince ?? null}
        seed="gallery"
        since={now - ago - 20_000}
        typing={false}
      />
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main data-shot="steps" className="flex w-fit flex-col items-start gap-4 bg-panel p-6">
      {rows.map((row) => <Line key={row.asked} {...row} />)}
    </main>
  </StrictMode>,
);
