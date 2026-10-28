// App-wide artifacts (docs/superpowers/specs/2026-10-16-artifacts-design.md):
// the system windows of popped-out artifacts, kept matching the server
// (artifact-windows.ts), and the artifact the palette asked for, opened in its
// window. Nothing here draws an artifact inside Sagax's window, except the
// full-screen view of an artifact shown in a chat.
import { useCallback, useEffect } from "react";

import { OPEN_ARTIFACT_EVENT, type OpenArtifactDetail } from "@/lib/artifact-events";
import { useAllArtifacts } from "@/lib/artifacts";
import { ArtifactFullscreenHost } from "./ArtifactFrame";
import { migrateLegacyArtifactPanels, openArtifactInOwnWindow, ownArtifactWindowClosed, reconcileArtifactWindows } from "./artifact-windows";

export function ArtifactsHost() {
  // Every artifact this viewer sees, kept current by the server's frames:
  // the popped ones are the windows that should be open.
  const { artifacts } = useAllArtifacts(true);
  // Floating panels an older Sagax restored for artifacts: dropped.
  useEffect(() => migrateLegacyArtifactPanels(), []);
  // Only a list the server answered decides: offline, open windows stay.
  useEffect(() => {
    if (artifacts) reconcileArtifactWindows(artifacts);
  }, [artifacts]);
  // The person closed a system window: an artifact's is docked, a page's
  // (`page:…`) is ignored (ownArtifactWindowClosed).
  useEffect(() => window.ogb?.artifactWindow?.onClosed(ownArtifactWindowClosed), []);
  const onOpen = useCallback((event: Event) => {
    const detail = (event as CustomEvent<OpenArtifactDetail>).detail;
    if (!detail?.botId || !detail.artifactId) return;
    const known = artifacts?.find((artifact) => artifact.id === detail.artifactId);
    void openArtifactInOwnWindow({
      id: detail.artifactId,
      botId: detail.botId,
      title: detail.title,
      ...(known ? { popped: known.popped } : {}),
      ...(known?.bounds ? { bounds: known.bounds } : {}),
    });
  }, [artifacts]);
  useEffect(() => {
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen);
  }, [onOpen]);
  return <ArtifactFullscreenHost />;
}
