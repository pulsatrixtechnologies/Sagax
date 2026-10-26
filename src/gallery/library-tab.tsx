/** Isolated gallery of the bot panel's Library tab for screenshots: files and
 * artifacts in one list, Pinned on top, then This week and Older. Pinning
 * works in the page (no server). Not shipped in the app.
 * ?skin=<id>&lang=<code>&state=empty|pinned */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { LibraryBody } from "../components/bot-settings/LibraryTab";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import type { ThreadFile } from "../lib/chat-files";
import type { ArtifactList } from "../lib/artifacts";
import type { ArtifactSummary } from "../../shared/artifacts";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

const NOW = Date.now();
const DAY = 24 * 3_600_000;
const id = (n: number) => n.toString(16).padStart(24, "0");
const file = (n: number, name: string, mime: string, daysAgo: number, pinned = false): ThreadFile => ({
  id: id(n), messageId: `m${n}`, source: "written", path: name, name, mime, at: NOW - daysAgo * DAY, size: 2_048 * n, available: true, ...(pinned ? { pinned } : {}),
});
const artifact = (n: number, title: string, daysAgo: number, favorite = false): ArtifactSummary => ({
  id: `art_000000${n}`, botId: "gallery-bot", title, favorite, popped: false, createdAt: NOW - 30 * DAY, updatedAt: NOW - daysAgo * DAY, rev: 1, refresh: { state: "idle", failures: 0 },
});

const state = params.get("state");
const initialFiles: ThreadFile[] = state === "empty" ? [] : [
  file(1, "plan.md", "text/markdown", 1),
  file(2, "project-export.zip", "application/zip", 2),
  file(3, "meeting-notes.md", "text/markdown", 4),
  file(4, "release-checklist.md", "text/markdown", 14, state === "pinned"),
  file(5, "quarterly-summary.pdf", "application/pdf", 21),
  file(6, "chart.png", "image/png", 25),
];
const initialArtifacts: ArtifactSummary[] = state === "empty" ? [] : [
  artifact(1, "Queue overview", 0.4, state === "pinned"),
  artifact(2, "Dispatch email preview in French", 18),
];

function Gallery() {
  const [files, setFiles] = useState(initialFiles);
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const list: ArtifactList = {
    artifacts,
    error: false,
    reload: () => {},
    patch: (artifactId, change) => setArtifacts((current) => change === null ? current.filter((a) => a.id !== artifactId) : current.map((a) => a.id === artifactId ? { ...a, ...change } : a)),
  };
  return (
    <LibraryBody
      threadId="t1"
      files={files}
      list={list}
      onPinFile={(target, pinned) => setFiles((current) => current.map((f) => f.id === target.id ? { ...f, pinned } : f))}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <aside data-gallery-panel="" className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel text-ink">
        <Gallery />
      </aside>
    </StoreProvider>
  </StrictMode>,
);
