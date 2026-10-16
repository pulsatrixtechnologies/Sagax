/** Isolated gallery for Playwright screenshots of the brand surfaces before
 * sign-in (2026-10-16): the launch screen, a welcome tour bubble and the
 * shared workspace note, each with the Pulsatrix mark. Not shipped.
 * ?skin=<id>&lang=<code>&view=launch|server|spotlight|hint */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LaunchScreen } from "../components/onboarding/LaunchScreen";
import { SharedWorkspaceHint } from "../components/onboarding/SharedWorkspaceHint";
import { Spotlight } from "../components/onboarding/Spotlight";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "launch";

// No server here: loads never answer, so the fixtures stay.
window.fetch = () => new Promise<Response>(() => {});
const bridges = {
  environments: { state: () => Promise.resolve({ activeId: "local", environments: [] }) },
  orgJoin: { probe: () => new Promise(() => {}), join: () => new Promise(() => {}) },
} as never;
const store = { state: { config: null, selectedId: null }, dispatch: () => {} } as never;

function Gallery() {
  return (
    <BotEditorStore value={store}>
      <div className="min-h-screen bg-app" data-gallery={view}>
        {(view === "launch" || view === "server") && <LaunchScreen bridges={bridges} onSolo={() => {}} initialMode={view === "server" ? "server" : "solo"} />}
        {view === "spotlight" && (
          <Spotlight anchor={null} placement="below" progress="1 / 6" primary={{ label: t("onboarding.tour.next"), onClick: () => {} }} onDone={() => {}}>
            {t("onboarding.spot.composer")}
          </Spotlight>
        )}
        {view === "hint" && <SharedWorkspaceHint replay onClose={() => {}} />}
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
