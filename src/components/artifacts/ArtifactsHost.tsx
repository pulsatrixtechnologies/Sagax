// App-wide artifacts (docs/superpowers/specs/2026-10-16-artifacts-design.md):
// the floating windows of popped-out artifacts, kept matching the server
// (artifact-windows.ts), and the artifact the palette asked for, popped out.
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, PanelBottomClose, RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { registerFloatingKind } from "@/lib/floating-windows";
import { OPEN_ARTIFACT_EVENT, type OpenArtifactDetail } from "@/lib/artifact-events";
import { refreshArtifact, useAllArtifacts, useArtifact, useArtifactWatch } from "@/lib/artifacts";
import { ArtifactFrame } from "./ArtifactFrame";
import { ArtifactStatusLine } from "./ArtifactsSection";
import {
  ARTIFACT_WINDOW_KIND, artifactWindowData, closeArtifactWindow, dockArtifact, dockArtifactWindow, popOutArtifact, reconcileArtifactWindows, type ArtifactWindowData,
} from "./artifact-windows";

const TOOL = "flex size-7 items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40";

/** One artifact's window body: its widget, its state, Refresh now and Dock.
 * Mounted means visible, so it holds a watch lease. */
export function ArtifactWindowBody({ data }: { data: ArtifactWindowData }) {
  const { artifact, error, gone } = useArtifact(data.botId, data.artifactId);
  useArtifactWatch(data.artifactId);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (gone) closeArtifactWindow(data.artifactId); }, [gone, data.artifactId]);
  return (
    <div className="flex size-full flex-col" data-artifact-window={data.artifactId}>
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline/30 px-2 py-1">
        <span className="min-w-0 flex-1">{artifact && <ArtifactStatusLine artifact={{ ...artifact, ...(artifact.data ? { dataAt: artifact.data.at } : {}) }} />}</span>
        {artifact?.source && (
          <button
            type="button"
            className={TOOL}
            disabled={refreshing}
            aria-label={t("artifacts.refreshNow")}
            title={t("artifacts.refreshNow")}
            onClick={() => {
              setRefreshing(true);
              void refreshArtifact(data.botId, data.artifactId).catch(() => {}).finally(() => setRefreshing(false));
            }}
          >
            <RefreshCw size={13} aria-hidden="true" className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
          </button>
        )}
        <button type="button" className={TOOL} aria-label={t("artifacts.dock")} title={t("artifacts.dock")} onClick={() => void dockArtifactWindow({ id: data.artifactId, botId: data.botId }).catch(() => {})}>
          <PanelBottomClose size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 p-2">
        {artifact ? (
          <ArtifactFrame artifact={artifact} fill />
        ) : error ? (
          <p role="alert" className="p-2 text-[12.5px] text-danger">{t("artifacts.error")}</p>
        ) : (
          <span role="status" className="flex items-center gap-2 p-2 text-[12.5px] text-ink-secondary">
            <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("artifacts.loading")}
          </span>
        )}
      </div>
    </div>
  );
}

export function ArtifactsHost() {
  // Every artifact this viewer sees, kept current by the server's frames:
  // the popped ones are the windows that should be open.
  const { artifacts } = useAllArtifacts(true);
  useEffect(() => registerFloatingKind(ARTIFACT_WINDOW_KIND, (entry) => {
    const data = artifactWindowData(entry.data);
    return data ? <ArtifactWindowBody key={data.artifactId} data={data} /> : null;
  }), []);
  // Only a list the server answered decides: offline, restored windows stay.
  useEffect(() => {
    if (artifacts) reconcileArtifactWindows(artifacts, dockArtifact);
  }, [artifacts]);
  const onOpen = useCallback((event: Event) => {
    const detail = (event as CustomEvent<OpenArtifactDetail>).detail;
    if (!detail?.botId || !detail.artifactId) return;
    const known = artifacts?.find((artifact) => artifact.id === detail.artifactId);
    void popOutArtifact({ id: detail.artifactId, botId: detail.botId, title: detail.title, ...(known?.bounds ? { bounds: known.bounds } : {}) }).catch(() => {});
  }, [artifacts]);
  useEffect(() => {
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen);
  }, [onOpen]);
  return null;
}
