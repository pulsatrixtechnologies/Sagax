/** Isolated gallery for screenshots of a reply drawn as it is written
 * (2026-10-29, src/components/LiveReply.tsx): a 1:1 conversation and a room,
 * each caught mid-answer (a finished table, a code block still open). Not
 * shipped in the app. ?lang=<code>&skin=<id>&cut=<0..1> (how much of the
 * answer has arrived; 1 shows it whole). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LiveReply } from "../components/LiveReply";
import { CHAT_COLUMN_CLASS } from "../lib/chat-bubble-width";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StreamingPreview } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
document.documentElement.lang = lang;
const fr = lang.startsWith("fr");
const cut = Math.min(1, Math.max(0, Number(params.get("cut") ?? "0.72")));

const asked = fr ? "Prépare le plan de migration." : "Draft the migration plan.";
const answer = fr
  ? "Voici le plan en trois étapes.\n\n| Étape | Durée | Risque |\n|---|---|---|\n| Copie des données | 2 h | Faible |\n| Bascule | 30 min | Moyen |\n| Vérification | 1 h | Faible |\n\nLe script de copie :\n\n```bash\nrsync -a --info=progress2 /srv/ancien/ /srv/nouveau/\npsql -f schema.sql nouvelle_base\n```\n\nEnsuite :\n\n- valider les sommes de contrôle ;\n- prévenir l'équipe avant la bascule."
  : "Here is the plan in three steps.\n\n| Step | Time | Risk |\n|---|---|---|\n| Copy the data | 2 h | Low |\n| Switch over | 30 min | Medium |\n| Check | 1 h | Low |\n\nThe copy script:\n\n```bash\nrsync -a --info=progress2 /srv/old/ /srv/new/\npsql -f schema.sql new_db\n```\n\nThen:\n\n- check the checksums;\n- warn the team before the switch.";
const partial = answer.slice(0, Math.round(answer.length * cut));

function Conversation({ threadId, room }: { threadId: string; room?: boolean }) {
  return (
    <section className="w-[680px] rounded-2xl bg-app px-5 py-5">
      <div className={CHAT_COLUMN_CLASS}>
        <div className="flex justify-end">
          <p className="max-w-[80%] rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">{asked}</p>
        </div>
        <LiveReply threadId={threadId} botId="gallery" {...(room ? { room: true, label: "Wren" } : {})} />
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StreamingPreview streaming={{ direct: partial, room: partial }}>
      <main data-shot="live" className="flex w-fit flex-col items-start gap-4 bg-panel p-6">
        <Conversation threadId="direct" />
        <Conversation threadId="room" room />
      </main>
    </StreamingPreview>
  </StrictMode>,
);
