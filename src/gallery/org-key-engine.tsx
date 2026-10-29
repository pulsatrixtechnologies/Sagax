/** Isolated gallery for #1533: the engine card a member reads for the
 * organization's API-key engine, as GET /api/me/engines answers it.
 * ?state=after (default): "Claude (organization key)", paid by the
 * organization; ?state=before: the saved name and the person's
 * subscription, as it read before. Not shipped in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EngineConnect } from "../components/EngineConnect";
import { setLocale } from "../lib/i18n";
import type { MyEngine } from "../lib/perspicax-org";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
setLocale(lang);
const before = params.get("state") === "before";
const name = (provider: string) => before ? `${provider === "Grok" ? "xAI" : `${provider} (API key)`}` : lang.startsWith("fr") ? `${provider} (clé de l'organisation)` : `${provider} (organization key)`;
const engine = (provider: string, driver: string, instanceId: string): MyEngine => ({
  instanceId, driver, displayName: name(provider), installed: true,
  subscription: { supported: before && driver === "claudeAgent", signedIn: before && driver === "claudeAgent" },
  myKey: false, orgKey: true, myTurns: before && driver === "claudeAgent" ? "subscription" : "org-key",
});
const engines = [engine("Claude", "claudeAgent", "claudeApi"), engine("Grok", "grok", "xaiApi")];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <aside data-gallery-panel="" className="flex w-[420px] flex-col gap-3 border-r border-hairline/40 bg-panel px-4 py-4 text-ink">
        {engines.map((item) => (
          <div key={item.instanceId} data-org-key-engine={item.instanceId} className="rounded-xl border border-hairline/40 px-3.5 py-2.5">
            <div className="mb-1 text-[13px] font-medium">{item.displayName}</div>
            <EngineConnect engine={item} issuer="https://px.example.test" onChanged={() => undefined} disconnect={false} />
          </div>
        ))}
      </aside>
    </StoreProvider>
  </StrictMode>,
);
