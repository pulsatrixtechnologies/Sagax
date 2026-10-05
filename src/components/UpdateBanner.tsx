// Update prompt. An available or downloaded update opens a notes dialog.
// Errors and the Linux package hand-off stay on the small bottom-left card.
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Loader2, PackageOpen, RefreshCw, Sparkles, X } from "lucide-react";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { ReleaseNotesBody } from "./ReleaseNotesMarkdown";

const primaryAction =
  "flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-1.5 text-[13px] font-medium text-accent-ink transition-colors disabled:cursor-default disabled:bg-control disabled:text-ink-secondary";

const NOTES_STATUS = new Set<UpdaterState["status"]>(["available", "downloading", "preparing", "downloaded", "installing"]);

function friendlyError(message?: string): string {
  if (!message) return "Something went wrong.";
  if (/cannot find .*\.yml|404/i.test(message))
    return "No update has been published for this platform yet.";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(message))
    return "Couldn't reach the update server.";
  return message.split("\n")[0].slice(0, 140);
}

function busyLabel(s: UpdaterState, pending: "download" | "install" | "check" | null): string {
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
  if (s.status === "downloaded") return t("releaseNotes.updateReady", { version });
  return t("releaseNotes.updateTitle", { name: brand().name, version });
}

export function UpdateBanner() {
  const s = useUpdaterState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pending, setPending] = useState<"download" | "install" | "check" | null>(null);
  // "Update and restart" downloads, then installs when the file is ready.
  const installAfter = useRef(false);
  const status = s?.status;

  useEffect(() => {
    if (installAfter.current && status === "downloaded") {
      installAfter.current = false;
      setPending("install");
      void window.ogb?.updater?.install();
      return;
    }
    if (status === "error" || status === "idle" || status === "handed-off") installAfter.current = false;
    setPending(null);
  }, [status]);

  if (!s || s.status === "idle" || s.status === "checking") return null;
  const key = `${s.status}:${s.version ?? ""}`;
  if (dismissed === key) return null;

  const dismiss = () => setDismissed(key);
  const beginUpdate = () => {
    const updater = window.ogb?.updater;
    if (!updater) return;
    if (s.status === "downloaded") {
      setPending("install");
      void updater.install();
      return;
    }
    installAfter.current = true;
    setPending("download");
    void updater.download();
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
  pending: "download" | "install" | "check" | null;
  onDismiss: () => void;
  onUpdate: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
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

  const primaryLabel = handoff
    ? s.status === "downloaded" || pending === "install"
      ? t("settings.updates.install")
      : t("settings.updates.download")
    : t("releaseNotes.updateRestart");

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onDismiss()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-notes-title"
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-[520px] flex-col rounded-[14px] border border-border bg-elevated p-5"
      >
        <div className="flex items-start gap-2">
          <h2 id="update-notes-title" className="min-w-0 flex-1 text-[16px] font-semibold text-ink">
            {notesTitle(s)}
          </h2>
          {!busy && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
              title={t("releaseNotes.later")}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {s.status === "preparing" && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{t("settings.updates.preparing")}</p>
        )}
        {s.status === "installing" && s.message && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{s.message}</p>
        )}
        {s.status === "downloaded" && handoff && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
            {t("settings.updates.readyInstall", { version: s.version ?? "" })}
          </p>
        )}

        {s.status === "downloading" && (
          <div className="mt-3">
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

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <ReleaseNotesBody notes={s.notes} fallbackVersion={s.version ?? ""} />
        </div>

        <div className="mt-4 flex gap-2">
          {busy ? (
            <button type="button" disabled className={primaryAction}>
              <Loader2 size={13} className="animate-spin" />
              {busyLabel(s, pending)}
            </button>
          ) : (
            <>
              <button ref={primaryRef} type="button" onClick={onUpdate} className={primaryAction}>
                {handoff ? (
                  s.status === "downloaded" ? <PackageOpen size={13} /> : <ArrowDownToLine size={13} />
                ) : (
                  <RefreshCw size={13} />
                )}
                {primaryLabel}
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-control hover:text-ink"
              >
                {t("releaseNotes.later")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UpdateProblemCard({
  state: s,
  pending,
  onDismiss,
  onRetry,
}: {
  state: UpdaterState;
  pending: "download" | "install" | "check" | null;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const title = s.status === "handed-off" ? "Finish in a terminal" : "Update failed";
  const subtitle =
    s.status === "handed-off"
      ? s.terminalOpened
        ? "Command copied. Paste it in the terminal that opened."
        : "Command copied. Paste it in a terminal to finish."
      : s.retryable === false
        ? `${friendlyError(s.message?.split(" Quit and reopen ")[0])} Quit and reopen ${brand().name} before trying the update again.`
        : friendlyError(s.message);

  return (
    <div className="animate-panel-in fixed bottom-4 left-4 z-50 w-[300px] rounded-[10px] border-[0.5px] border-border bg-elevated p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Sparkles size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">{title}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-secondary" title={subtitle}>
            {subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      {s.status === "handed-off" && s.command && (
        <code className="mt-2.5 block overflow-x-auto rounded-lg bg-control px-2 py-1.5 font-mono text-[11.5px] whitespace-pre text-ink-secondary">
          {s.command}
        </code>
      )}

      <div className="mt-2.5 flex gap-2">
        {s.status === "error" && s.retryable !== false && (
          <button
            type="button"
            onClick={onRetry}
            disabled={pending !== null}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-control py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:text-ink-secondary disabled:hover:bg-control"
          >
            {pending === "check" ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Checking…
              </>
            ) : (
              "Try again"
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          disabled={pending !== null}
          className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {s.status === "handed-off" || s.retryable === false ? "Dismiss" : "Later"}
        </button>
      </div>
    </div>
  );
}
