/** Isolated gallery for Show a task in my Chrome
 * (src/components/MyChromeRecordDialog.tsx): the chooser, the dialog before
 * and during a recording, and the steps it produced. The capture script
 * (scripts/capture-my-chrome-recorder.mjs) answers /api itself.
 * Not shipped in the app. ?view=chooser|setup|recording|steps&skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MyChromeRecordDialog } from "../components/MyChromeRecordDialog";
import { TeachChooserDialog, TeachStepsDialog } from "../components/TeachStepsDialog";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { TeachStep } from "../../shared/teach-recording";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const site = "https://portail.example.com";
const GALLERY_STEPS: TeachStep[] = [
  { id: "1", kind: "open", url: `${site}/factures` },
  { id: "2", kind: "click", url: `${site}/factures`, target: { role: "link", name: "Nouvelle demande", tag: "a", selector: "#new" } },
  { id: "3", kind: "type", url: `${site}/demande`, target: { role: "textbox", name: "Nom", tag: "input", selector: "#name" }, text: "Atelier Nord" },
  { id: "4", kind: "type", url: `${site}/demande`, target: { role: "textbox", name: "Mot de passe", tag: "input", selector: "#pw" }, secret: true },
  { id: "5", kind: "click", url: `${site}/demande`, target: { role: "button", name: "Envoyer la demande", tag: "button", selector: "#send" } },
  { id: "6", kind: "note", url: `${site}/demande`, text: "Vérifier que le numéro de confirmation s'affiche" },
];

const view = params.get("view") ?? "setup";
const noop = () => undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-panel text-ink">
      {view === "chooser" && <TeachChooserDialog botName="Nova" onShow={noop} onShowInMyChrome={noop} onDescribe={noop} onClose={noop} />}
      {(view === "setup" || view === "recording") && <MyChromeRecordDialog botId="nova" botName="Nova" dictationEngine="xai" onDone={noop} onClose={noop} />}
      {view === "steps" && <TeachStepsDialog botId="nova" botName="Nova" steps={GALLERY_STEPS} recordedAt="2026-10-29T14:00:00.000Z" replay="my-chrome" onClose={noop} />}
    </div>
  </StrictMode>,
);
