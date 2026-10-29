/** Isolated gallery for a bot's "Where this bot runs" row, the real
 * BotHostForm. ?host=fleet (default): the organization server is selected;
 * ?host=machine: one of the person's computers. Not shipped in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotHostForm, type PublishedComputer } from "../components/bot-settings/BotHostSettings";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

const laptop: PublishedComputer = {
  deviceId: "laptop",
  name: "Studio",
  online: true,
  engines: [{ instanceId: "pi", label: "pi", models: [{ id: "qwen", label: "Qwen" }] }],
};
const machine = params.get("host") === "machine";
const noop = () => undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <aside data-gallery-panel="" className="w-[420px] border-r border-hairline/40 bg-panel px-2 py-2 text-ink">
      <BotHostForm
        host={machine ? { kind: "machine", userId: "person", deviceId: "laptop" } : { kind: "fleet" }}
        workers={machine ? [laptop] : []}
        canEdit
        model={{ instanceId: "pi", model: "qwen" }}
        onFleet={noop}
        onMachine={noop}
        onModel={noop}
      />
    </aside>
  </StrictMode>,
);
