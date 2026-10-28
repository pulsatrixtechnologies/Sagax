/** Isolated gallery for headless screenshots of an artifact leaving the app:
 * the Library's dialog with "Open in its own window" (desktop app only), and
 * the floating panel, kept whole inside the app's window, that can be dragged
 * out of it. Neutral sample data. Not shipped in the app.
 * ?view=dialog|panel&lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArtifactDialog } from "../components/artifacts/ArtifactsSection";
import { ArtifactsHost } from "../components/artifacts/ArtifactsHost";
import { openArtifactWindow } from "../components/artifacts/artifact-windows";
import { FloatingWindowsHost } from "../components/floating/FloatingWindowsHost";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");
try {
  localStorage.clear();
} catch {
  /* nothing saved */
}

// the desktop bridge is only there in the desktop app; the gallery records what it is asked
const asked: unknown[] = [];
(window as unknown as { ogb: unknown; artifactWindowAsks: unknown[] }).ogb = {
  artifactWindow: { open: async (request: unknown) => { asked.push(request); return "created"; }, close: async () => true, onClosed: () => () => {} },
};
(window as unknown as { artifactWindowAsks: unknown[] }).artifactWindowAsks = asked;

const rows = [["Item A", "Open", 4], ["Item B", "Waiting", 2], ["Item C", "Open", 7], ["Item D", "Done", 1]];
const html = `<body style="font-family:system-ui,sans-serif;margin:0;padding:12px;color:#ddd;background:transparent">
<input id="q" placeholder="Filter" style="margin-bottom:8px;padding:4px 6px;width:160px">
<table id="t" style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr><th align="left">Item</th><th align="left">Status</th><th align="right">Count</th></tr></thead>
<tbody>${rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td align="right">${c}</td></tr>`).join("")}</tbody></table>
<script>q.oninput=()=>{for(const r of t.tBodies[0].rows)r.hidden=!r.textContent.toLowerCase().includes(q.value.toLowerCase())}</script></body>`;
const now = Date.now();
const view = params.get("view") ?? "dialog";
const artifact = {
  id: "a1", botId: "b1", title: "Live table", favorite: true, popped: view === "panel", createdAt: now, updatedAt: now, rev: 1,
  refresh: { state: "idle", failures: 0 }, html,
};
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots/b1/artifacts/a1") && init?.method === "PATCH") return new Response(JSON.stringify({ artifact }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/bots/b1/artifacts/a1")) return new Response(JSON.stringify({ artifact }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/artifacts/watch")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/artifacts")) return new Response(JSON.stringify({ artifacts: [artifact] }), { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

if (view === "panel") openArtifactWindow({ id: "a1", botId: "b1", title: "Live table", bounds: { x: 900, y: 500, width: 520, height: 320 } }, () => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app text-ink" data-gallery-sample={view}>
      {view === "dialog" ? (
        <ArtifactDialog artifact={artifact} onClose={() => {}} onPopOut={() => {}} onOwnWindow={() => {}} />
      ) : (
        <>
          <ArtifactsHost />
          <FloatingWindowsHost />
        </>
      )}
    </div>
  </StrictMode>,
);
