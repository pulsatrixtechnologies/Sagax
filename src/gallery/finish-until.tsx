/** Isolated gallery for headless screenshots (no window) of "do not finish
 * until" (#1329): the bot setting (off, then on with its bound) and a 1:1
 * where the first reply does not meet the condition, Sagax writes
 * "relaunch 1/5" and starts the next turn, and the second reply meets it.
 * Plus the bound reached. Not shipped in the app.
 * ?skin=<id>&lang=<code>&only=<sample id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { FinishUntilSettings } from "../components/bot-settings/FinishUntilSettings";
import { BotEditorContext } from "../components/bot-settings/BotEditorContext";
import { StatusActivityRow } from "../components/StatusActivityRow";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Bot, Message } from "../state/store";
import type { FinishUntilLine } from "../../shared/finish-until-line";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const only = params.get("only");

const CONDITION = "les tests passent et la branche est poussée";
const baseBot = { id: "b1", name: "Atlas", messages: [] } as unknown as Bot;
// The gallery never saves: a request that answers nothing.
const noRequest = (async () => ({})) as never;

const userBubble = (text: string) => (
  <div className="max-w-[460px] self-end rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] whitespace-pre-wrap text-ink">{text}</div>
);
const botBubble = (text: string) => (
  <div className="max-w-[460px] self-start rounded-[18px] bg-card px-3 py-[7px] text-[13px] whitespace-pre-wrap text-ink">{text}</div>
);
const row = (finishUntil: FinishUntilLine) => (
  <StatusActivityRow message={{ id: `f-${finishUntil.status}-${finishUntil.round ?? 0}`, at: 1, role: "bot", kind: "activity", tool: { name: "Finish until", ok: true, finishUntil } } as Message} />
);
const settings = (bot: Bot) => (
  <BotEditorContext.Provider value={{ request: noRequest }}>
    <div className="w-[560px]"><FinishUntilSettings bot={bot} /></div>
  </BotEditorContext.Provider>
);

const samples: Array<{ id: string; render: () => React.ReactNode }> = [
  { id: "setting-off", render: () => settings(baseBot) },
  { id: "setting-on", render: () => settings({ ...baseBot, finishUntil: CONDITION, finishUntilMaxRounds: 8 }) },
  {
    id: "relaunch",
    render: () => (
      <div className="flex w-[560px] flex-col gap-2">
        {userBubble("Corrige le test qui échoue sur la page de connexion.")}
        {botBubble("J'ai corrigé la validation du courriel. Un cas échoue encore : le mot de passe vide.")}
        {row({ status: "relaunch", condition: CONDITION, round: 1, max: 5 })}
        {botBubble("J'ai corrigé le dernier cas, les 42 tests passent et la branche est poussée.")}
        {row({ status: "met", condition: CONDITION, round: 1, max: 5, detail: "42 tests passent, branche poussée" })}
      </div>
    ),
  },
  {
    id: "limit",
    render: () => (
      <div className="flex w-[560px] flex-col gap-2">
        {row({ status: "relaunch", condition: CONDITION, round: 2, max: 2 })}
        {botBubble("Le test d'intégration attend toujours le service de paiement.")}
        {row({ status: "limit", condition: CONDITION, round: 2, max: 2 })}
        {row({ status: "blocked", condition: CONDITION, detail: "il me faut la clé du service de test" })}
        {row({ status: "stopped", condition: CONDITION, round: 1, max: 5 })}
      </div>
    ),
  },
];

function Gallery() {
  return (
    <div className="flex flex-col items-start gap-10 bg-app p-8 text-ink" data-gallery>
      {samples.filter((sample) => !only || sample.id === only).map((sample) => (
        <div key={sample.id} data-gallery-sample={sample.id}>
          {sample.render()}
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
