import { useRef, useState } from "react";
import { CheckCircle2, Download, Loader2, Monitor, Terminal, Upload, type LucideIcon } from "lucide-react";

import type { RemoteSessionView } from "../../../shared/remote-session";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { downloadRemoteFile, openRemoteShell, REMOTE_UPLOAD_MAX, uploadRemoteFile } from "./remote-session-client";
import { RemoteFileBrowser, type RemoteBrowserMode } from "./RemoteFileBrowser";

/** The line shown after a file leaves or arrives. */
export function remoteFileNotice(kind: "sent" | "downloaded", name: string): string {
  if (kind === "sent") return t("remoteSession.sent", { name });
  const base = name.split(/[\\/]/).pop() || name;
  return t("remoteSession.downloaded", { name: base });
}

type Pending = "shell" | "upload" | "download" | null;

// One height, one radius, one type size for every action (Grok Bot's 30 px
// pill): Prendre le contrôle is the filled pill, the rest are grey pills. In
// a narrow card (the Computer tab, a phone) the grey ones become three equal
// tiles, icon over label, so no label is cut and nothing wraps.
const ACTION = "ui-button min-w-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const PRIMARY = "ui-button-primary h-9 w-full font-medium @min-[460px]/actions:h-[30px] @min-[460px]/actions:w-auto";
const SECONDARY = "h-auto flex-col gap-1 rounded-xl px-1.5 py-2 text-[12px] leading-4 @min-[460px]/actions:h-[30px] @min-[460px]/actions:flex-row @min-[460px]/actions:gap-1.5 @min-[460px]/actions:rounded-full @min-[460px]/actions:px-[13px] @min-[460px]/actions:py-0 @min-[460px]/actions:text-[13px] @min-[460px]/actions:leading-[18px]";

function ActionButton({ icon: Icon, label, title, busy, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; busy?: boolean }) {
  return (
    <button type="button" title={title ?? label} {...props} className={cn(ACTION, className)}>
      {busy ? <Loader2 size={15} aria-hidden="true" className="shrink-0 animate-spin" /> : <Icon size={15} aria-hidden="true" className="shrink-0" />}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/** Shell, upload and download for one connected session. The chat card adds
 * Prendre le contrôle (onTakeControl), which opens the Computer tab. Upload
 * and download go through the remote file browser. */
export function RemoteSessionActions({ botId, view, onTakeControl }: { botId: string; view: RemoteSessionView; onTakeControl?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [browser, setBrowser] = useState<RemoteBrowserMode | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const live = view.state === "connected";

  const shell = async () => {
    setPending("shell");
    setError(null);
    const failed = await openRemoteShell(botId, view.id);
    setPending(null);
    setError(failed);
  };

  const chooseFile = (chosen: File | undefined) => {
    if (!chosen) return;
    setNotice(null);
    if (chosen.size <= 0 || chosen.size > REMOTE_UPLOAD_MAX) {
      setError(t("remoteSession.browser.tooLarge"));
      return;
    }
    setError(null);
    setBrowserError(null);
    setFile(chosen);
    setBrowser({ kind: "upload", fileName: chosen.name });
  };

  const closeBrowser = () => {
    setBrowser(null);
    setBrowserError(null);
    setFile(null);
  };

  const transfer = async (path: string) => {
    if (!browser || pending) return;
    const kind = browser.kind;
    setPending(kind);
    setBrowserError(null);
    const failed = kind === "upload"
      ? (file ? await uploadRemoteFile(botId, view.id, file, path) : t("remoteSession.browser.tooLarge"))
      : await downloadRemoteFile(botId, view.id, path);
    setPending(null);
    if (failed) {
      setBrowserError(failed);
      return;
    }
    setNotice(kind === "upload" ? remoteFileNotice("sent", file?.name ?? "") : remoteFileNotice("downloaded", path));
    setError(null);
    closeBrowser();
  };

  if (!live) return <p className="px-3 py-2.5 text-[12.5px] text-ink-secondary">{t("remoteSession.closed")}</p>;

  const busy = pending !== null;
  return (
    <div data-remote-actions="" className="@container/actions flex flex-col gap-2 px-3 py-3">
      <div className={"flex flex-col gap-2 @min-[460px]/actions:flex-row @min-[460px]/actions:items-center"}>
        {onTakeControl && (
          <ActionButton
            data-remote-take-control=""
            icon={Monitor}
            label={t("remoteSession.takeControl")}
            onClick={onTakeControl}
            className={PRIMARY}
          />
        )}
        <div className={"grid grid-cols-3 gap-2 @min-[460px]/actions:flex @min-[460px]/actions:items-center"}>
          <ActionButton data-remote-action="shell" className={SECONDARY} icon={Terminal} label={t("remoteSession.shell")} busy={pending === "shell"} disabled={busy} onClick={() => void shell()} />
          <ActionButton
            data-remote-action="upload"
            className={SECONDARY}
            data-remote-browse="upload"
            icon={Upload}
            label={t("remoteSession.uploadShort")}
            title={t("remoteSession.upload")}
            aria-label={t("remoteSession.upload")}
            busy={pending === "upload"}
            disabled={busy}
            onClick={() => input.current?.click()}
          />
          <ActionButton
            data-remote-action="download"
            className={SECONDARY}
            data-remote-browse="download"
            icon={Download}
            label={t("remoteSession.download")}
            busy={pending === "download"}
            disabled={busy}
            onClick={() => { setNotice(null); setError(null); setBrowserError(null); setBrowser({ kind: "download" }); }}
          />
        </div>
        <input ref={input} type="file" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ""; chooseFile(chosen); }} />
      </div>
      {notice && (
        <p role="status" className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
          <CheckCircle2 size={14} aria-hidden="true" className="shrink-0 text-success" /> <span className="min-w-0 truncate">{notice}</span>
        </p>
      )}
      {error && <p className="text-[12.5px] text-danger" role="alert">{error}</p>}
      {browser && (
        <RemoteFileBrowser
          botId={botId}
          view={view}
          mode={browser}
          busy={busy}
          error={browserError}
          onPick={(path) => void transfer(path)}
          onClose={closeBrowser}
        />
      )}
    </div>
  );
}
