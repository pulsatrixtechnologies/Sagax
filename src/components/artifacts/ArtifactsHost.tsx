// App-wide artifacts: shows the artifact the palette (or anything outside
// its bot's Files tab) asked for (docs/superpowers/specs/2026-10-16-artifacts-design.md).
import { useEffect, useState } from "react";

import { OPEN_ARTIFACT_EVENT, type OpenArtifactDetail } from "@/lib/artifact-events";
import { ArtifactDialog } from "./ArtifactsSection";

export function ArtifactsHost() {
  const [opened, setOpened] = useState<OpenArtifactDetail | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenArtifactDetail>).detail;
      if (detail?.botId && detail.artifactId) setOpened(detail);
    };
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen);
  }, []);
  if (!opened) return null;
  return <ArtifactDialog key={opened.artifactId} artifact={{ id: opened.artifactId, botId: opened.botId, title: opened.title }} onClose={() => setOpened(null)} />;
}
