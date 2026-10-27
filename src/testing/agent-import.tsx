// Isolated page for Import an agent (scripts/testing/capture-agent-import.ts):
// the real store and dialog panel against a disposable fake-engine server.
// `?skin=` picks the skin, `?lang=` the language.
import { createRoot } from "react-dom/client";
import { AgentImportPanel } from "../components/AgentImport";
import { StoreProvider } from "../state/store";
import { applySkin, type SkinId } from "../lib/skins";
import { setLocale, t } from "../lib/i18n";
import "../styles.css";

const params = new URLSearchParams(location.search);
setLocale(params.get("lang") ?? "fr");

function Fixture() {
  return <main className="flex min-h-screen items-start justify-center bg-app p-8">
    <div data-agent-import-card="" className="w-full max-w-[600px] overflow-hidden rounded-[14px] border border-border bg-elevated">
      <div className="border-b border-hairline/40 px-5 py-4"><h2 className="text-[16px] font-semibold text-ink">{t("agentImport.title")}</h2></div>
      <div className="px-5 py-4"><AgentImportPanel onImported={(result) => { document.body.dataset.imported = result.botId; }} /></div>
    </div>
  </main>;
}

applySkin((params.get("skin") ?? "pulsatrix") as SkinId);
const root = createRoot(document.getElementById("root")!);
root.render(<StoreProvider><Fixture /></StoreProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
