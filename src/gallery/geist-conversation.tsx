/** Isolated gallery for headless screenshots of the interface face (Geist) and
 * the code face (Geist Mono) in a conversation: French accents and guillemets,
 * a table of figures in tabular-nums columns, inline code and a code block.
 * Fictional content. Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const reply = [
  "Voici le résumé de l’été : « les dépenses ont baissé » et la sécurité des accès s’est améliorée. Œuvres, façade, déjà, où, çà et là : àâäéèêëîïôöùûüÿç ÀÉÈÊÎÔÛÇ.",
  "",
  "| Client | Billets | Heures | Facturé |",
  "| --- | ---: | ---: | ---: |",
  "| Alpha | 12 | 41,5 | 3 112,50 $ |",
  "| Bêta | 108 | 7,25 | 543,75 $ |",
  "| Gamma | 1 004 | 118,0 | 8 850,00 $ |",
  "",
  "Lancez `pnpm test src/lib/fonts.test.ts` puis :",
  "",
  "```ts",
  "export const total = (rows: number[]) => rows.reduce((a, b) => a + b, 0); // 0123456789",
  "```",
].join("\n");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app p-6 text-ink">
      <div className="mb-3 ml-auto max-w-md rounded-2xl bg-raised p-3 text-[14px] leading-7">
        Peux-tu résumer l’activité des clients ce mois-ci?
      </div>
      <div className="max-w-2xl rounded-2xl p-3 text-[14px] leading-7 tabular-nums">
        <ChatMarkdown text={reply} />
      </div>
    </div>
  </StrictMode>,
);
