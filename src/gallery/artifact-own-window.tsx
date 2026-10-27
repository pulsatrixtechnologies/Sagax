/** Isolated gallery for headless screenshots of a popped-out artifact's window
 * with its "Open in its own window" button (desktop app only), as it sits in
 * the app and as the standalone page shows it. Not shipped in the app.
 * ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArtifactWindowBody } from "../components/artifacts/ArtifactsHost";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

// the desktop bridge is only there in the desktop app
(window as unknown as { ogb: unknown }).ogb = { artifactWindow: { open: async () => "created", close: async () => true, onClosed: () => () => {} } };

const artifact = {
  id: "a1", botId: "b1", title: "Sales dashboard", favorite: false, popped: true, createdAt: 1, updatedAt: 2, rev: 1,
  refresh: { state: "idle", failures: 0 },
  html: "<body style=\"font-family:sans-serif;padding:16px\"><h3>Sales dashboard</h3><p>Orders this week: <b>128</b></p></body>",
};
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots/b1/artifacts/a1")) return new Response(JSON.stringify({ artifact }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/artifacts/watch")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app p-6 text-ink">
      <div className="h-[300px] w-[520px] overflow-hidden rounded-xl border border-hairline bg-panel">
        <ArtifactWindowBody data={{ botId: "b1", artifactId: "a1" }} />
      </div>
    </div>
  </StrictMode>,
);
