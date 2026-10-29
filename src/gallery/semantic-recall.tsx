/** Isolated gallery for the bot Memory settings' Recall by meaning card, the
 * real SemanticRecallCard. ?state=built-in (default): the built-in vectors,
 * editable; ?state=endpoint: an embedding endpoint that did not answer;
 * ?state=member: someone who may not change the installation's settings.
 * Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SemanticRecallCard } from "../components/bot-settings/MemorySection";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

const state = params.get("state") ?? "built-in";
const endpoint = state === "endpoint";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <aside data-gallery-panel="" className="w-[520px] border-r border-hairline/40 bg-panel px-4 py-4 text-ink">
      <SemanticRecallCard
        status={endpoint
          ? { enabled: true, encoder: "endpoint", model: "nomic-embed-text", endpointOk: false, memoryPassages: 42, conversationPassages: 1_318 }
          : { enabled: true, encoder: "built-in", memoryPassages: 42, conversationPassages: 1_318 }}
        config={endpoint ? { semanticRecall: true, embeddingsUrl: "http://127.0.0.1:11434/v1", embeddingsModel: "nomic-embed-text" } : { semanticRecall: true, embeddingsUrl: "", embeddingsModel: "" }}
        editable={state !== "member"}
        onSave={async () => undefined}
      />
    </aside>
  </StrictMode>,
);
