import { useRef, useState } from "react";
import { Download, Monitor, Terminal, Upload } from "lucide-react";

import type { RemoteSessionView } from "../../../shared/remote-session";
import { t } from "@/lib/i18n";
import { downloadRemoteFile, openRemoteShell, uploadRemoteFile } from "./remote-session-client";

/** The line shown after a file leaves or arrives. */
export function remoteFileNotice(kind: "sent" | "downloaded", name: string): string {
  if (kind === "sent") return t("remoteSession.sent", { name });
  const base = name.split(/[\\/]/).pop() || name;
  return t("remoteSession.downloaded", { name: base });
}

/** Shell, upload and download for one connected session. The chat card adds
 * Prendre le contrôle (onTakeControl), which opens the Computer tab. */
export function RemoteSessionActions({ botId, view, onTakeControl }: { botId: string; view: RemoteSessionView; onTakeControl?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<"shell" | "upload" | "download" | null>(null);
  const [path, setPath] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const live = view.state === "connected";

  const shell = async () => {
    setPending("shell");
    setError(null);
    const failed = await openRemoteShell(botId, view.id);
    setPending(null);
    setError(failed);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setPending("upload");
    setError(null);
    setNotice(null);
    const failed = await uploadRemoteFile(botId, view.id, file);
    setPending(null);
    if (failed) setError(failed);
    else setNotice(remoteFileNotice("sent", file.name));
  };

  const download = async () => {
    const remotePath = path.trim();
    if (!remotePath) return;
    setPending("download");
    setError(null);
    setNotice(null);
    const failed = await downloadRemoteFile(botId, view.id, remotePath);
    setPending(null);
    if (failed) setError(failed);
    else setNotice(remoteFileNotice("downloaded", remotePath));
  };

  if (!live) return <p className="px-3 py-2 text-[12px] text-ink-secondary">{t("remoteSession.closed")}</p>;

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap gap-2">
        {onTakeControl && (
          <button type="button" data-remote-take-control="" onClick={onTakeControl} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-raised">
            <Monitor size={14} /> {t("remoteSession.takeControl")}
          </button>
        )}
        <button type="button" disabled={pending !== null} onClick={() => void shell()} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-raised disabled:opacity-50">
          <Terminal size={14} /> {t("remoteSession.shell")}
        </button>
        <button type="button" disabled={pending !== null} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-raised disabled:opacity-50">
          <Upload size={14} /> {t("remoteSession.upload")}
        </button>
        <button type="button" disabled={pending !== null} onClick={() => setDownloadOpen((open) => !open)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-raised disabled:opacity-50">
          <Download size={14} /> {t("remoteSession.download")}
        </button>
        <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
      </div>
      {downloadOpen && (
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void download(); }}>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={t("remoteSession.downloadPath")}
            aria-label={t("remoteSession.downloadPath")}
            className="min-w-0 flex-1 rounded-lg border border-hairline/50 bg-inset px-2.5 py-1.5 text-[12.5px] text-ink"
          />
          <button type="submit" disabled={pending !== null || !path.trim()} className="rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-raised disabled:opacity-50">{t("remoteSession.download")}</button>
        </form>
      )}
      {notice && <p className="text-[12px] text-ink-secondary">{notice}</p>}
      {error && <p className="text-[12px] text-danger" role="alert">{error}</p>}
    </div>
  );
}
