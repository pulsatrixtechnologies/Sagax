// "What's new" after an update. Once per version, never on a fresh install
// and never in a dev build. About and Help → Release notes open it again.
import { useEffect, useMemo, useRef, useState } from "react";
import { appVersion } from "@/lib/app-links";
import { bundledNotesFor, bundledNotesSince, bundledReleaseCatalog, bundledVersions } from "@/lib/bundled-release-notes";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { activeLocale, t } from "@/lib/i18n";
import {
  RELEASE_NOTES_SEEN_KEY,
  readPreviousRelease,
  readSeenRelease,
  releaseNotesPriorInstall,
  seenReleaseRecord,
  whatsNewDecision,
} from "@/lib/release-notes";
import { subscribeReleaseNotes, type ReleaseNotesMode } from "@/lib/release-notes-ui";
import { useStore } from "@/state/store";
import { ReleaseNotesBody, ReleaseNotesMarkdown } from "./ReleaseNotesMarkdown";

function readSeen(): string | null {
  try {
    return readSeenRelease(localStorage.getItem(RELEASE_NOTES_SEEN_KEY));
  } catch {
    return null;
  }
}

function readPrevious(): string | null {
  try {
    return readPreviousRelease(localStorage.getItem(RELEASE_NOTES_SEEN_KEY));
  } catch {
    return null;
  }
}

function writeSeen(version: string, previous: string | null): void {
  try {
    localStorage.setItem(RELEASE_NOTES_SEEN_KEY, seenReleaseRecord(version, previous));
  } catch {
    // Private mode can refuse the write. This launch can still show the dialog.
  }
}

export function ReleaseNotesPrompt() {
  const { state } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReleaseNotesMode>("current");
  const [picked, setPicked] = useState(appVersion());
  const [since, setSince] = useState(false);
  const catalog = useMemo(() => bundledReleaseCatalog(), []);
  const openWith = (next: ReleaseNotesMode) => {
    setMode(next);
    setPicked(appVersion());
    setSince(false);
    setOpen(true);
  };
  const decided = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Decide once, after the real config and desktop capabilities are both
  // known. A later write in this same launch (the welcome screen setting
  // launchMode) must not flip a fresh install into What's new.
  useEffect(() => {
    if (decided.current) return;
    if (state.config == null || !ready) return;
    decided.current = true;
    const version = appVersion();
    const seen = readSeen();
    const decision = whatsNewDecision({
      version,
      dev: capabilities.host.packaged !== true,
      seenVersion: seen,
      previouslyInstalled: releaseNotesPriorInstall(state.config.onboarding),
    });
    if (decision.seenVersion && decision.seenVersion !== seen) writeSeen(decision.seenVersion, seen);
    if (decision.show) openWith("current");
  }, [state.config, ready, capabilities.host.packaged]);

  useEffect(() => subscribeReleaseNotes((next) => openWith(next)), []);
  useEffect(() => window.ogb?.onOpenReleaseNotes?.(() => openWith("current")), []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
    };
    // Capture so this dialog, painted above the update prompt, takes Escape first.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  const version = appVersion();
  const language = activeLocale();
  const browse = mode === "browse";
  const shown = browse ? picked : version;
  const notes = bundledNotesFor(shown, language, catalog);
  const safe = notes?.trim() ?? "";
  const versions = bundledVersions(catalog);
  // Always offer the running version, even when this build has no file for it.
  if (browse && !versions.includes(version)) versions.unshift(version);
  const previous = readPrevious();
  const sinceEntries = browse && previous ? bundledNotesSince(previous, version, catalog) : [];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notes-title"
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-[520px] flex-col rounded-[14px] border border-border bg-elevated p-5"
      >
        <h2 id="release-notes-title" className="text-[16px] font-semibold text-ink">
          {browse ? t("releaseNotes.browseTitle") : t("releaseNotes.whatsNew", { version })}
        </h2>
        {browse ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="release-notes-version" className="sr-only">
              {t("releaseNotes.versionPicker")}
            </label>
            <select
              id="release-notes-version"
              value={picked}
              onChange={(event) => {
                setPicked(event.target.value);
                setSince(false);
              }}
              className="rounded-lg border border-border bg-raised px-2 py-1 text-[13px] text-ink"
            >
              {versions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === version ? t("releaseNotes.currentTag", { version: entry }) : entry}
                </option>
              ))}
            </select>
            {sinceEntries.length > 0 ? (
              <button
                type="button"
                aria-pressed={since}
                onClick={() => setSince((on) => !on)}
                className={`rounded-lg px-2 py-1 text-[12px] ${since ? "bg-accent text-white" : "bg-raised text-ink hover:brightness-110"}`}
              >
                {t("releaseNotes.sinceLast", { version: previous ?? "" })}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {browse && since ? (
            <ReleaseNotesBody notes={sinceEntries} language={language} />
          ) : safe ? (
            <ReleaseNotesMarkdown source={safe} />
          ) : (
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              {t("releaseNotes.whatsNewEmpty", { version: shown })}
            </p>
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 w-full rounded-xl bg-raised px-4 py-2 text-[13px] font-medium text-ink hover:brightness-110"
        >
          {t("releaseNotes.close")}
        </button>
      </div>
    </div>
  );
}
