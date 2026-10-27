// An artifact in a window of its own (#1140): the page behind
// `/artifact-window#bot=<id>&artifact=<id>`, drawn by the desktop app in a
// separate BrowserWindow (electron/artifact-window.mjs) that can sit outside
// the app's frame, beside the work or on another monitor. It shows what the
// floating window shows (the widget, its status, Refresh now, Dock back) and
// has its own store, like any other tab of the app. Closing the window docks
// the artifact; Dock back does the same and the app closes the window.
import { useEffect, useState, useSyncExternalStore } from "react";

import { StoreProvider, useStore } from "@/state/store";
import { effectiveLanguage, useLanguageChoice } from "@/lib/language-preference";
import { setLocale, t } from "@/lib/i18n";
import { useArtifact } from "@/lib/artifacts";
import { ArtifactWindowBody } from "./ArtifactsHost";

const ID = /^[a-zA-Z0-9:_-]{1,128}$/;

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
const currentHash = () => location.hash;

/** The bot and artifact an own-window address names, or null. */
export function readArtifactWindowTarget(hash: string): { botId: string; artifactId: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const botId = params.get("bot") ?? "";
  const artifactId = params.get("artifact") ?? "";
  return ID.test(botId) && ID.test(artifactId) ? { botId, artifactId } : null;
}

function Title({ botId, artifactId }: { botId: string; artifactId: string }) {
  const { artifact } = useArtifact(botId, artifactId);
  useEffect(() => {
    if (artifact?.title) document.title = artifact.title;
  }, [artifact?.title]);
  return null;
}

function ArtifactStandaloneBody() {
  const { state } = useStore();
  const hash = useSyncExternalStore(subscribeHash, currentHash);
  const target = readArtifactWindowTarget(hash);
  const ready = state.hydrated === true && state.config != null;

  // This device's language, else the server's, as the main window does.
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  const [, setLocaleEpoch] = useState(0);
  useEffect(() => {
    setLocale(language || globalThis.navigator?.language);
    setLocaleEpoch((epoch) => epoch + 1);
  }, [language]);

  if (!target || !ready) {
    return (
      <main className="flex h-dvh items-center justify-center bg-panel px-6 text-center text-[13px] text-ink-secondary" role="status">
        {target ? t("artifacts.loading") : t("artifacts.error")}
      </main>
    );
  }
  return (
    <main data-artifact-standalone={target.artifactId} className="flex h-dvh min-h-0 flex-col bg-panel text-ink">
      <Title botId={target.botId} artifactId={target.artifactId} />
      <ArtifactWindowBody data={target} />
    </main>
  );
}

export function ArtifactStandaloneWindow() {
  return (
    <StoreProvider>
      <ArtifactStandaloneBody />
    </StoreProvider>
  );
}
