/** Isolated gallery for Playwright screenshots of two conversation events
 * (2026-10-15): the "Disabled · 5 routines" line with its menu. The Connect
 * apps pill left with the Composio integration (#1014). Not shipped in the app.
 * ?skin=<id>&lang=<code>&view=closed|open */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RoutineToggleLine } from "../components/RoutineToggleLine";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "closed";

const disabled = {
  action: "disabled" as const,
  turnKey: "u1",
  routines: [
    { id: "r1", name: "[Daily] Sagax & Perspicax daily dev + Connector memory watch" },
    { id: "r2", name: "[Fleet] Weekly review of Ember's routines" },
    { id: "r3", name: "[Daily] Revue des billets ACME ouverts depuis plus de 5 jours" },
    { id: "r4", name: "Résumé du matin" },
    { id: "r5", name: "Vérification des factures" },
  ],
};
const enabled = { action: "enabled" as const, turnKey: "u1", routines: [{ id: "r4", name: "Résumé du matin" }] };

let opened = false;

function Gallery() {
  useEffect(() => {
    // StrictMode runs this twice in development: open the menu once.
    if (view !== "open" || opened) return;
    opened = true;
    document.querySelector<HTMLButtonElement>("[data-routine-toggle] button")?.click();
  }, []);
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-xl flex-col gap-4" data-gallery={view}>
        <div className="self-end rounded-[18px] bg-bubble-user px-3 py-2 text-[13px] text-ink">Désactive mes routines quotidiennes, sauf le résumé du matin.</div>
        <RoutineToggleLine event={disabled} canOpen={(id) => id !== "r5"} onOpen={() => {}} />
        <RoutineToggleLine event={enabled} canOpen={() => true} onOpen={() => {}} />
        <div className="self-start rounded-[18px] bg-card px-3 py-2 text-[13px] text-ink">C'est fait : 5 routines désactivées, le résumé du matin reste actif. Je n'ai pas pu envoyer le récapitulatif par courriel : Gmail n'est pas connecté.</div>
        <div className="h-64" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
