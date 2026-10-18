// Update prompt. Updates download by themselves (upstream #2342), so nothing
// shows while one checks or downloads. A downloaded update opens a small
// "Update ready" dialog (Not now, Update) whose release notes unfold under
// "What's new"; "Not now" leaves the sidebar's update button, which opens
// it again (openUpdatePrompt). Errors and the Linux package hand-off stay on
// the small bottom-left card.
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { useUpdatePromptRequests } from "@/lib/update-prompt";
import { ReleaseNotesBody } from "./ReleaseNotesMarkdown";
import { CountPill, DialogFrame, DialogLayer, GROUP_CARD, PILL, PRIMARY_PILL } from "./SettingsPrimitives";

const NOTES_STATUS = new Set<UpdaterState["status"]>(["preparing", "downloaded", "installing"]);

function friendlyError(message?: string): string {
  if (!message) return t("updates.problem.generic");
  if (/cannot find .*\.yml|404/i.test(message))
    return t("updates.problem.noRelease");
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(message))
    return t("updates.problem.offline");
  return message.split("\n")[0].slice(0, 140);
}

function busyLabel(s: UpdaterState, pending: "install" | "check" | null): string {
  if (s.status === "preparing") return t("settings.updates.preparingShort");
  if (s.status === "installing" || pending === "install") {
    return s.installMode === "handoff" ? t("settings.updates.opening") : t("releaseNotes.restarting");
  }
  if (s.status === "downloading" && s.percent != null) return t("releaseNotes.percent", { percent: Math.round(s.percent) });
  return t("releaseNotes.starting");
}

function notesTitle(s: UpdaterState): string {
  const version = s.version ?? "";
  if (s.status === "downloading") return t("releaseNotes.downloading", { version });
  if (s.status === "preparing") return t("releaseNotes.preparing");
  if (s.status === "installing") {
    return s.installMode === "handoff" ? t("settings.updates.openingTerminal") : t("releaseNotes.restarting");
  }
  if (s.status === "downloaded") return t("releaseNotes.readyTitle");
  return t("releaseNotes.updateTitle", { name: brand().name, version });
}

/** The sentence under "Update ready": what the restart does, or the
 * terminal hand-off of a system package. */
export function readyBody(s: UpdaterState): string {
  if (s.installMode === "handoff") return t("settings.updates.readyInstall", { version: s.version ?? "" });
  // An unknown version leaves a double space behind, in every language.
  return t("releaseNotes.readyBody", { app: brand().name, version: s.version ?? "" }).replace("  ", " ");
}

export function UpdateBanner() {
  const s = useUpdaterState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pending, setPending] = useState<"install" | "check" | null>(null);
  const status = s?.status;
  useEffect(() => setPending(null), [status]);
  // the sidebar's update button asks for the dialog again after "Not now"
  const requests = useUpdatePromptRequests();
  useEffect(() => {
    if (requests > 0) setDismissed(null);
  }, [requests]);

  if (!s || s.status === "idle" || s.status === "checking" || s.status === "downloading") return null;
  const key = `${s.status}:${s.version ?? ""}`;
  if (dismissed === key) return null;

  const dismiss = () => setDismissed(key);
  const beginUpdate = () => {
    const updater = window.ogb?.updater;
    if (!updater || s.status !== "downloaded") return;
    setPending("install");
    void updater.install();
  };

  if (NOTES_STATUS.has(s.status)) {
    return (
      <UpdateNotesDialog state={s} pending={pending} onDismiss={dismiss} onUpdate={beginUpdate} />
    );
  }

  return (
    <UpdateProblemCard
      state={s}
      pending={pending}
      onDismiss={dismiss}
      onRetry={() => {
        setPending("check");
        void window.ogb?.updater?.check();
      }}
    />
  );
}

function UpdateNotesDialog({
  state: s,
  pending,
  onDismiss,
  onUpdate,
}: {
  state: UpdaterState;
  pending: "install" | "check" | null;
  onDismiss: () => void;
  onUpdate: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const installing = s.status === "installing";
  const preparing = s.status === "preparing";
  const busy = s.status === "downloading" || preparing || installing || pending !== null;
  const handoff = s.installMode === "handoff";

  useEffect(() => {
    primaryRef.current?.focus();
  }, [s.status]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || busy) return;
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onDismiss]);

  const primaryLabel = handoff ? t("settings.updates.install") : t("releaseNotes.update");

  const notesId = "update-notes-list";
  // 2026-10-16 (JC): drawn like Settings: the title, one grey line, the
  // notes folded in a row of one card behind a pill, the pills at the right.
  return (
    <DialogLayer className="z-[60]" onBackdropMouseDown={() => { if (!busy) onDismiss(); }}>
      <DialogFrame
        titleId="update-notes-title"
        title={notesTitle(s)}
        width={notesOpen ? "lg" : "sm"}
        frameProps={{ "aria-describedby": "update-notes-body", "data-update-dialog": "" }}
        footer={
          <>
            <button type="button" onClick={onDismiss} disabled={busy} className={PILL}>
              {t("releaseNotes.notNow")}
            </button>
            {busy ? (
              <button type="button" disabled className={PRIMARY_PILL}>
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {busyLabel(s, pending)}
              </button>
            ) : (
              <button ref={primaryRef} type="button" onClick={onUpdate} className={PRIMARY_PILL}>
                {primaryLabel}
              </button>
            )}
          </>
        }
      >
        <p id="update-notes-body" className="-mt-2 px-0 text-[13px] leading-[19px] text-ink-secondary empty:hidden">
          {s.status === "downloaded"
            ? readyBody(s)
            : preparing
              ? t("settings.updates.preparing")
              : installing && s.message
                ? s.message
                : null}
        </p>

        {s.status === "downloading" && (
          <div>
            <div className="text-[12.5px] text-ink-secondary">
              {s.percent == null
                ? t("releaseNotes.starting")
                : t("releaseNotes.percent", { percent: Math.round(s.percent) })}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-control">
              <div
                className={cn("h-full rounded-full bg-accent transition-[width]", s.percent == null && "w-1/4 animate-pulse")}
                style={s.percent == null ? undefined : { width: `${Math.min(100, Math.max(0, s.percent))}%` }}
              />
            </div>
          </div>
        )}

        {/* The feed's notes stay one tap away rather than filling the dialog. */}
        <div className={GROUP_CARD}>
          <div className="flex min-h-[44px] items-center justify-between gap-3 px-3.5 py-1 md:min-h-[36px]">
            <span className="min-w-0 truncate text-[13px] leading-[18px] text-ink">
              {t("releaseNotes.whatsNew", { version: s.version ?? "" }).replace(/\s+$/, "")}
            </span>
            <span data-update-notes-toggle="">
              <CountPill
                open={notesOpen}
                onToggle={() => setNotesOpen((open) => !open)}
                label={t("releaseNotes.whatsNew", { version: s.version ?? "" }).replace(/\s+$/, "")}
                controls={notesId}
              />
            </span>
          </div>
          {notesOpen && (
            <div id={notesId} className="max-h-[50dvh] overflow-y-auto border-t-[0.5px] border-border px-2.5 pb-2 pt-3">
              <ReleaseNotesBody notes={s.notes} fallbackVersion={s.version ?? ""} />
            </div>
          )}
        </div>
      </DialogFrame>
    </DialogLayer>
  );
}

function UpdateProblemCard({
  state: s,
  pending,
  onDismiss,
  onRetry,
}: {
  state: UpdaterState;
  pending: "install" | "check" | null;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const title = s.status === "handed-off" ? t("updates.problem.terminalTitle") : t("updates.problem.failedTitle");
  const subtitle =
    s.status === "handed-off"
      ? s.terminalOpened
        ? t("updates.problem.terminalOpened")
        : t("updates.problem.terminalPaste")
      : s.retryable === false
        ? `${friendlyError(s.message?.split(" Quit and reopen ")[0])} ${t("updates.problem.reopen", { app: brand().name })}`
        : friendlyError(s.message);

  return (
    <div role="status" className="animate-panel-in fixed bottom-4 left-4 z-50 w-[300px] rounded-[14px] border-[0.5px] border-border bg-elevated p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Sparkles size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-[18px] text-ink">{title}</div>
          <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary" title={subtitle}>
            {subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("updates.problem.dismiss")}
          title={t("updates.problem.dismiss")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 touch:size-11"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {s.status === "handed-off" && s.command && (
        <code className="mt-2.5 block overflow-x-auto rounded-lg bg-inset px-2 py-1.5 font-mono text-[11.5px] whitespace-pre text-ink-secondary">
          {s.command}
        </code>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          disabled={pending !== null}
          className={PILL}
        >
          {s.status === "handed-off" || s.retryable === false ? t("updates.problem.dismiss") : t("releaseNotes.later")}
        </button>
        {s.status === "error" && s.retryable !== false && (
          <button
            type="button"
            onClick={onRetry}
            disabled={pending !== null}
            className={PRIMARY_PILL}
          >
            {pending === "check" ? (
              <>
                <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("common.checking")}
              </>
            ) : (
              t("updates.problem.retry")
            )}
          </button>
        )}
      </div>
    </div>
  );
}
