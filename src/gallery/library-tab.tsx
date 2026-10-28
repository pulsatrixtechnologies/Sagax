/** Isolated gallery of the bot panel's Library tab for screenshots: files,
 * artifacts and pages in one list, Pinned on top, then Today, This week and
 * Older (five rows and Show more), each row with its mini preview (a real
 * thumbnail for an image, a mark per type otherwise). Pinning works in the
 * page (no server); the capture script answers the thumbnail route. Not
 * shipped in the app.
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
import type { PublishedPageSummary } from "../../shared/published-pages";
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
const startOfToday = new Date(NOW).setHours(0, 0, 0, 0);
/** A time today, whatever the hour the capture runs. */
const today = (minutesAgo: number) => Math.max(startOfToday + 60_000, NOW - minutesAgo * 60_000);
const todayFile = (n: number, name: string, mime: string, minutesAgo: number): ThreadFile => ({ ...file(n, name, mime, 0), at: today(minutesAgo) });
const page: PublishedPageSummary = {
  id: "pageAAAA1111", title: "Quarterly overview", status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "gallery-bot", threadId: "t1",
  createdAt: NOW - 3 * DAY, updatedAt: NOW - 3 * DAY, expired: false, versions: [], pinned: false,
};
const initialFiles: ThreadFile[] = state === "empty" ? [] : [
  todayFile(6, "chart.png", "image/png", 5),
  todayFile(7, "site-photo.jpg", "image/jpeg", 20),
  todayFile(1, "plan.md", "text/markdown", 40),
  file(2, "project-export.zip", "application/zip", 2),
  file(8, "team.webp", "image/webp", 2.2),
  file(9, "logo.svg", "image/svg+xml", 3),
  file(10, "dashboard.html", "text/html", 4),
  file(5, "quarterly-summary.pdf", "application/pdf", 5),
  file(11, "demo.gif", "image/gif", 6),
  file(3, "meeting-notes.md", "text/markdown", 12),
  file(4, "release-checklist.md", "text/markdown", 14, state === "pinned"),
  file(12, "archive-2025.zip", "application/zip", 18),
  file(13, "old-chart.png", "image/png", 22),
  file(14, "contract.pdf", "application/pdf", 30),
  file(15, "scan.jpg", "image/jpeg", 33),
  file(16, "notes-q2.md", "text/markdown", 41),
  file(17, "backup.zip", "application/zip", 52),
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
      pages={state === "empty" ? [] : [page]}
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
