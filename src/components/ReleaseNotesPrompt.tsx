// "What's new" after an update. Once per version, never on a fresh install
// and never in a dev build. About and Help → Release notes open it again.
import { useEffect, useRef, useState } from "react";
import { appVersion } from "@/lib/app-links";
import { bundledNotesFor } from "@/lib/bundled-release-notes";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { activeLocale, t } from "@/lib/i18n";
import {
  RELEASE_NOTES_SEEN_KEY,
  readSeenRelease,
  releaseNotesPriorInstall,
  seenReleaseRecord,
  whatsNewDecision,
} from "@/lib/release-notes";
import { subscribeReleaseNotes } from "@/lib/release-notes-ui";
import { useStore } from "@/state/store";
import { ReleaseNotesMarkdown } from "./ReleaseNotesMarkdown";

function readSeen(): string | null {
  try {
    return readSeenRelease(localStorage.getItem(RELEASE_NOTES_SEEN_KEY));
  } catch {
    return null;
  }
}

function writeSeen(version: string): void {
  try {
    localStorage.setItem(RELEASE_NOTES_SEEN_KEY, seenReleaseRecord(version));
  } catch {
    // Private mode can refuse the write. This launch can still show the dialog.
  }
}

export function ReleaseNotesPrompt() {
  const { state } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const [open, setOpen] = useState(false);
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
    if (decision.seenVersion && decision.seenVersion !== seen) writeSeen(decision.seenVersion);
    if (decision.show) setOpen(true);
  }, [state.config, ready, capabilities.host.packaged]);

  useEffect(() => subscribeReleaseNotes(() => setOpen(true)), []);
  useEffect(() => window.ogb?.onOpenReleaseNotes?.(() => setOpen(true)), []);

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
  const notes = bundledNotesFor(version, activeLocale());
  const safe = notes?.trim() ?? "";

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
          {t("releaseNotes.whatsNew", { version })}
        </h2>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {safe ? (
            <ReleaseNotesMarkdown source={safe} />
          ) : (
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              {t("releaseNotes.whatsNewEmpty", { version })}
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
