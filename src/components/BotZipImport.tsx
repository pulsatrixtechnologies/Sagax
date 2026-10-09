// Import a bot from its zip (`<bot>.sagaxbot.zip`, docs/bot-package.md).
// One file picked, uploaded once, then the server's preview: what will be
// created, what is skipped and why, what needs a token or a sign-in after.
// Nothing is created before Import. The panel is the Templates tool of
// Browse Bots; the dialog wraps it for New bot.
import { useEffect, useRef, useState } from "react";
import { FileArchive, Loader2, X } from "lucide-react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { botZipLineText, discardStagedBotZip, importStagedBotZip, previewStagedBotZip, uploadBotZip, type StagedBotZip } from "@/lib/bot-zip";
import type { BotZipImportResult, BotZipPreviewLine } from "../../shared/bot-zip";
import { Switch } from "./SettingsPrimitives";

const EXCLUDED_KEYS: LocaleKey[] = ["botZip.excluded.secrets", "botZip.excluded.session", "botZip.excluded.person", "botZip.excluded.rooms"];

function Lines({ title, lines, tone, id }: { title: string; lines: BotZipPreviewLine[]; tone?: "warn"; id: string }) {
  if (!lines.length) return null;
  return (
    <section data-bot-zip-lines={id} className="flex flex-col gap-1">
      <h4 className="text-[12.5px] font-medium text-ink">{title}</h4>
      <ul className={cn("flex flex-col gap-0.5 rounded-lg px-3 py-2 text-[12.5px] leading-[18px]", tone === "warn" ? "bg-warning/10 text-ink" : "bg-hover text-ink-secondary")}>
        {lines.map((line, index) => <li key={`${line.part}-${index}`} data-bot-zip-line={line.part}>{botZipLineText(line)}</li>)}
      </ul>
    </section>
  );
}

export function BotZipImportPanel({ onImported, onCancel, autoFocus = false }: {
  onImported?: (result: BotZipImportResult) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const { dispatch } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedBotZip | null>(null);
  const [busy, setBusy] = useState<"upload" | "preview" | "import" | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [conversations, setConversations] = useState(false);
  const [sharing, setSharing] = useState(false);
  const stagedId = useRef<string | null>(null);
  stagedId.current = staged?.id ?? null;
  // A staged file nobody imported is let go when the panel closes.
  useEffect(() => () => { if (stagedId.current) discardStagedBotZip(stagedId.current); }, []);

  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  const choose = async (file: File | undefined) => {
    if (!file || busy) return;
    setError("");
    setBusy("upload");
    try {
      if (staged) discardStagedBotZip(staged.id);
      const next = await uploadBotZip(file);
      setStaged(next);
      setName(next.preview.importName);
      setConversations(false);
      setSharing(false);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const refreshName = async () => {
    if (!staged || !name.trim() || name.trim() === staged.preview.importName) return;
    setBusy("preview");
    try {
      const preview = await previewStagedBotZip(staged.id, name.trim());
      setStaged({ ...staged, preview });
      setName(preview.importName);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };

  const importNow = async () => {
    if (!staged || busy) return;
    setError("");
    setBusy("import");
    try {
      const result = await importStagedBotZip(staged.id, { name: name.trim() || undefined, conversations, sharing });
      stagedId.current = null;
      setStaged(null);
      if (result.bot) dispatch({ type: "botAdded", bot: result.bot });
      dispatch({ type: "select", id: result.botId });
      onImported?.(result);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    if (staged) discardStagedBotZip(staged.id);
    stagedId.current = null;
    setStaged(null);
    setError("");
    onCancel?.();
  };

  const preview = staged?.preview;
  return (
    <div className="flex flex-col gap-3 text-[13px]" data-bot-zip-import="">
      <input ref={input} type="file" accept=".zip,.sagaxbot.zip,application/zip,.json,.md" className="hidden" data-bot-zip-file=""
        onChange={(event) => void choose(event.target.files?.[0])} />
      {!preview && (
        <button type="button" autoFocus={autoFocus} disabled={busy !== null} onClick={() => input.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); void choose(event.dataTransfer.files?.[0]); }}
          data-bot-zip-pick=""
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-60">
          {busy === "upload" ? <Loader2 size={20} className="animate-spin" /> : <FileArchive size={20} />}
          <span className="text-[13px] text-ink">{busy === "upload" ? t("botZip.uploading") : t("botZip.choose")}</span>
          <span className="text-[12px]">{t("botZip.chooseHint")}</span>
        </button>
      )}
      {preview && (
        <div className="flex flex-col gap-3" data-bot-zip-preview={preview.kind}>
          <div>
            <div className="text-[14px] font-medium text-ink">{preview.name}</div>
            <div className="text-[12px] text-ink-secondary">
              {preview.kind === "legacy"
                ? t("botZip.legacy")
                : t("botZip.exportedBy", { version: preview.appVersion ?? "?", date: preview.exportedAt ? new Date(preview.exportedAt).toLocaleDateString() : "?" })}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
            {t("botZip.name")}
            <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} onBlur={() => void refreshName()} data-bot-zip-name=""
              className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink focus:border-border-strong focus:outline-none" />
          </label>
          {preview.hasConversations && (
            <label className="flex items-center justify-between gap-3">
              <span className="min-w-0"><span className="block text-ink">{t("botZip.includeConversations")}</span><span className="block text-[12px] text-ink-secondary">{t("botZip.includeConversationsHint")}</span></span>
              <Switch checked={conversations} onClick={() => setConversations((value) => !value)} aria-label={t("botZip.includeConversations")} data-bot-zip-conversations="" />
            </label>
          )}
          {preview.hasSharing && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-ink">{t("botZip.includeSharing")}</span>
              <Switch checked={sharing} onClick={() => setSharing((value) => !value)} aria-label={t("botZip.includeSharing")} data-bot-zip-sharing="" />
            </label>
          )}
          <Lines id="created" title={t("botZip.created")} lines={preview.created} />
          <Lines id="needs" title={t("botZip.needsAction")} lines={preview.needsAction} tone="warn" />
          <Lines id="skipped" title={t("botZip.skipped")} lines={preview.skipped} />
          <details className="text-[12px] text-ink-secondary" data-bot-zip-excluded="">
            <summary className="cursor-pointer">{t("botZip.excluded.title")}</summary>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">{EXCLUDED_KEYS.map((key) => <li key={key}>{t(key)}</li>)}</ul>
          </details>
          <div className="flex justify-end gap-2">
            <button type="button" className="ui-button" disabled={busy === "import"} onClick={cancel} data-bot-zip-cancel="">{t("common.cancel")}</button>
            <button type="button" className="ui-button ui-button-primary" disabled={busy !== null || !name.trim()} onClick={() => void importNow()} data-bot-zip-confirm="">
              {busy === "import" ? t("botZip.importing") : t("botZip.import")}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-[12.5px] text-danger" data-bot-zip-error="">{error}</p>}
    </div>
  );
}

/** The panel over the page (New bot's "Import from zip"). */
export function BotZipImportDialog({ onClose, onImported }: { onClose: () => void; onImported?: (result: BotZipImportResult) => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3 sm:p-5" data-bot-zip-dialog=""
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t("botZip.importTitle")}
        className="flex max-h-[min(720px,94dvh)] w-full max-w-[560px] flex-col overflow-hidden rounded-[14px] border border-border bg-elevated">
        <div className="flex shrink-0 items-center justify-between border-b border-hairline/40 px-5 py-4">
          <h2 className="text-[16px] font-semibold text-ink">{t("botZip.importTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")}
            className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary"><X size={18} /></button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <BotZipImportPanel autoFocus onCancel={onClose} onImported={(result) => { onImported?.(result); onClose(); }} />
        </div>
      </div>
    </div>
  );
}
