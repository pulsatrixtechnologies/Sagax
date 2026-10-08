// Memory: what this bot believes, as a panel a person can read, fix, and
// audit. The switch turns memory on or off. A gauge says what loadMemory()
// cuts. Clicking a file opens it in an editor dialog that refuses to
// overwrite what the bot wrote while the person was typing. The journal
// lists every change with one-click undo.
//
// Fetched when the section becomes active, not on mount: settings opens
// for every bot and most visits never look at memory. A re-activation
// re-reads, so notes the bot wrote mid-session show up on the next look.
// The dialog keeps this mounted while hidden so an unsaved draft survives
// a visit to another section. A file opens only when the person clicks it.
import { FileText, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  MEMORY_INDEX,
  capacityStatus,
  deleteMemoryDoc,
  fetchMemoryDoc,
  fetchMemoryJournal,
  fetchMemoryOverview,
  formatBytes,
  journalSource,
  journalSummary,
  relativeTime,
  revertMemoryChange,
  saveMemoryDoc,
  fetchUpkeepStatus,
  tidyMemoryNow,
  tidySummary,
  noticedCount,
  topicFileName,
  type UpkeepStatus,
  type MemoryCapacity,
  type MemoryFileInfo,
  type MemoryJournalRow,
  type MemoryOverview,
  type LendingReview,
  markMemoryReviewed,
} from "@/lib/memory";
import { ApiError, useStore, type Bot } from "@/state/store";
import { Switch, SwitchRow } from "../SettingsPrimitives";
import { inputCls } from "./field";

const buttonCls = "rounded-lg bg-control px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50";
const quietButtonCls = "rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50";

interface Editing {
  path: string;
  text: string;
  /** sha256 the server reported when the text was loaded; sent back on save. */
  hash: string;
  dirty: boolean;
  readOnly: boolean;
}

interface Conflict {
  path: string;
  /** What is on disk now — the bot's version. */
  current: string;
  currentHash: string;
}

/** The on/off card at the top of the Memory section: the standard switch row. */
export function MemoryToggleCard({ enabled, busy, onToggle }: { enabled: boolean; busy: boolean; onToggle: (next: boolean) => void }) {
  return (
    <div className="rounded-xl border border-hairline/40 p-4">
      <div className="text-[13px] font-medium text-ink">{t("botPanel.memory.title")}</div>
      <SwitchRow
        className="mt-3"
        label={t("botPanel.memory.let")}
        description={<>{t("botPanel.memory.off")}{busy ? t("botPanel.memory.busy") : ""}</>}
        checked={enabled}
        disabled={busy}
        onChange={onToggle}
      />
    </div>
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The file body lives in this dialog, not in the settings column. Escape
 * and the backdrop close it. A dirty draft asks before it is dropped. */
export function MemoryEditorDialog({
  editing,
  botName,
  conflict,
  saving,
  savedDraft,
  onChange,
  onSave,
  onDiscard,
  onClose,
  onReload,
  onOverwrite,
  onDismissDraft,
  onOpenIndex,
}: {
  editing: Editing;
  botName: string;
  conflict: Conflict | null;
  saving: boolean;
  savedDraft: string | null;
  onChange: (text: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  onReload: () => void;
  onOverwrite: () => void;
  onDismissDraft: () => void;
  onOpenIndex: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialogRef.current;
    const area = root?.querySelector("textarea");
    if (area instanceof HTMLTextAreaElement && !area.readOnly) area.focus();
    else root?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previousFocus?.focus();
    };
  }, [editing.path]);

  const content = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-editor-title"
        tabIndex={-1}
        className="animate-pop-in flex max-h-[min(820px,calc(100dvh-2rem))] w-full max-w-[760px] flex-col overflow-hidden rounded-[14px] border border-border bg-elevated outline-none"
      >
        <header className="flex items-center justify-between gap-3 border-b border-hairline/40 px-5 py-4">
          <h2 id="memory-editor-title" className="min-w-0 truncate font-mono text-[13px] font-medium text-ink">
            {editing.path}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {editing.path !== MEMORY_INDEX && (
              <button type="button" className={quietButtonCls} onClick={onOpenIndex}>
                {t("botPanel.memory.back")}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("botPanel.memory.closeEditor")}
              className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {conflict && (
            <ConflictNotice botName={botName} busy={saving} onReload={onReload} onOverwrite={onOverwrite} />
          )}
          <textarea
            className={cn(inputCls, "min-h-[320px] flex-1 resize-y font-mono text-[13px] leading-relaxed", conflict && "mt-2")}
            value={editing.text}
            readOnly={editing.readOnly}
            placeholder={editing.path === MEMORY_INDEX ? t("botPanel.memory.indexPlaceholder") : t("botPanel.memory.write")}
            aria-label={editing.path === MEMORY_INDEX ? t("botPanel.memory.aria") : t("botPanel.memory.fileAria", { path: editing.path })}
            onChange={(event) => onChange(event.target.value)}
          />
          {savedDraft !== null && (
            <div className="mt-3">
              <div className="mb-1 text-[12px] text-ink-secondary">{t("botPanel.memory.draft")}</div>
              <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg border border-hairline/40 bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink">
                {savedDraft}
              </pre>
              <button type="button" className={cn(quietButtonCls, "mt-1")} onClick={onDismissDraft}>
                {t("botPanel.memory.dismiss")}
              </button>
            </div>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-hairline/40 px-5 py-3">
          {editing.readOnly ? (
            <p className="mr-auto text-[12px] text-ink-secondary">{t("botPanel.memory.logsReadOnly")}</p>
          ) : (
            <>
              {editing.dirty && (
                <button type="button" className={quietButtonCls} disabled={saving} onClick={onDiscard}>
                  {t("botPanel.memory.discard")}
                </button>
              )}
              <button type="button" onClick={onSave} disabled={saving || !editing.dirty} className={buttonCls}>
                {saving ? t("botPanel.memory.saving") : t("common.save")}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return content;
  return createPortal(content, document.body);
}

/** On an OMB Cloud home: this bot's memory changed in a conversation the
 * owner did not write, so its turns cannot use the owner's lent Mac until
 * the owner has looked. It names the files that changed; one click accepts
 * them as shown (no confirmation), and the server refuses it if anything
 * changed since. */
export function LendingReviewNotice({ changed, stale, busy, onReviewed }: { changed: readonly string[]; stale: boolean; busy: boolean; onReviewed: () => void }) {
  return (
    <div role="status" className="rounded-xl border border-danger/40 bg-card p-4">
      <p className="text-[13px] leading-relaxed text-ink">{t(stale ? "memory.lendingReviewStale" : "memory.lendingReview")}</p>
      {changed.length > 0 && (
        <>
          <p className="mt-2 text-[12px] text-ink-secondary">{t("memory.lendingReviewChanged")}</p>
          <ul className="mt-1 space-y-0.5">
            {changed.map((file) => (
              <li key={file} className="break-all font-mono text-[12px] text-ink">{file}</li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className={cn(buttonCls, "mt-3")} disabled={busy} onClick={onReviewed}>
        {t("memory.lendingReviewed")}
      </button>
    </div>
  );
}

export function MemorySection({ bot, active = true, onToggle }: { bot: Bot; active?: boolean; onToggle: (enabled: boolean) => void }) {
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [journal, setJournal] = useState<MemoryJournalRow[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState("");
  const [upkeep, setUpkeep] = useState<UpkeepStatus | null>(null);
  const [tidying, setTidying] = useState(false);
  // OMB Cloud home: memory changed where the owner did not write.
  const [lendingReview, setLendingReview] = useState<LendingReview | null>(null);
  const [lendingReviewStale, setLendingReviewStale] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const { dispatch } = useStore();

  const refresh = async (openPath?: string) => {
    const [nextOverview, nextJournal, nextUpkeep] = await Promise.all([
      fetchMemoryOverview(bot.id),
      fetchMemoryJournal(bot.id),
      fetchUpkeepStatus(bot.id).catch(() => null),
    ]);
    setOverview(nextOverview);
    setLendingReview(nextOverview.lendingReview ?? null);
    setJournal(nextJournal);
    setUpkeep(nextUpkeep);
    if (openPath) {
      const doc = await fetchMemoryDoc(bot.id, openPath);
      setEditing({ path: doc.path, text: doc.text, hash: doc.hash, dirty: false, readOnly: openPath.startsWith("memory/log/") });
    }
  };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError(null);
    // a dirty draft survives a re-activation; everything else re-reads
    const keepDraft = editing?.dirty === true;
    refresh(keepDraft ? undefined : editing?.path).catch((e: unknown) => {
      if (!cancelled) setError(errorText(e));
    });
    return () => {
      cancelled = true;
    };
  }, [active, bot.id]);

  const open = async (path: string): Promise<boolean> => {
    if (editing?.dirty && editing.path !== path && !window.confirm(t("botPanel.memory.closeDirty"))) return false;
    setError(null);
    setConflict(null);
    if (editing?.path !== path) setSavedDraft(null);
    try {
      const doc = await fetchMemoryDoc(bot.id, path);
      setEditing({ path: doc.path, text: doc.text, hash: doc.hash, dirty: false, readOnly: path.startsWith("memory/log/") });
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };

  const requestClose = () => {
    if (editing?.dirty && !window.confirm(t("botPanel.memory.closeDirty"))) return;
    setEditing(null);
    setConflict(null);
    setSavedDraft(null);
  };

  const save = async (expectedHash: string | undefined) => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveMemoryDoc(bot.id, editing.path, editing.text, expectedHash);
      if (!result.ok) {
        setConflict({ path: editing.path, current: result.current, currentHash: result.currentHash });
        return;
      }
      setConflict(null);
      setSavedDraft(null);
      setEditing({ ...editing, text: result.doc.text, hash: result.doc.hash, dirty: false });
      setOverview(result.overview);
      setJournal(await fetchMemoryJournal(bot.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  /** Reload keeps the person's words: the draft moves under the editor
   * as read-only text so nothing typed is lost, and the editor shows the
   * bot's version. */
  const reloadFromConflict = () => {
    if (!conflict || !editing) return;
    setSavedDraft(editing.text);
    setEditing({ ...editing, text: conflict.current, hash: conflict.currentHash, dirty: false });
    setConflict(null);
  };

  const remove = async (file: MemoryFileInfo) => {
    if (!window.confirm(t("botPanel.memory.confirmDelete", { name: file.name }))) return;
    setError(null);
    try {
      const { overview: next } = await deleteMemoryDoc(bot.id, file.path);
      setOverview(next);
      setJournal(await fetchMemoryJournal(bot.id));
      if (editing?.path === file.path) setEditing(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const createTopic = async () => {
    const name = topicFileName(newTopic);
    if (!name) {
      setError(t("botPanel.memory.badTopic"));
      return;
    }
    const opened = await open(`memory/${name}`);
    if (!opened) return;
    setNewTopic("");
    setEditing((current) => (current ? { ...current, dirty: true, text: current.text || topicTemplate(name) } : current));
  };

  const revert = async (row: MemoryJournalRow) => {
    setReverting(row.id);
    setError(null);
    try {
      const result = await revertMemoryChange(bot.id, row.id);
      setOverview(result.overview);
      setJournal(await fetchMemoryJournal(bot.id));
      if (editing?.path === row.path && !editing.dirty) {
        setEditing({ ...editing, text: result.text, hash: result.hash });
      }
      setNotice(t("botPanel.memory.restored", { path: row.path }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReverting(null);
    }
  };

  const toggleUpkeep = () => {
    const enabled = bot.memoryUpkeep === false;
    dispatch({ type: "updateBot", botId: bot.id, patch: { memoryUpkeep: enabled } });
    setUpkeep((current) => (current ? { ...current, enabled } : current));
  };

  const tidyNow = async () => {
    setTidying(true);
    setError(null);
    setNotice(null);
    try {
      const { report, overview: next } = await tidyMemoryNow(bot.id);
      setOverview(next);
      setJournal(await fetchMemoryJournal(bot.id));
      setUpkeep(await fetchUpkeepStatus(bot.id));
      if (editing && !editing.dirty) await open(editing.path);
      setNotice(`${tidySummary(report)}.${report.note ? ` ${report.note}` : ""}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTidying(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <MemoryToggleCard enabled={bot.memoryEnabled !== false} busy={Boolean(bot.busy)} onToggle={onToggle} />

      {lendingReview && (
        <LendingReviewNotice
          changed={lendingReview.changed}
          stale={lendingReviewStale}
          busy={reviewing}
          onReviewed={() => {
            setReviewing(true);
            markMemoryReviewed(bot.id, lendingReview.token)
              .then(() => { setLendingReview(null); setLendingReviewStale(false); })
              // Changed again since it was shown: show what is there now.
              .catch((e: unknown) => {
                if (e instanceof ApiError && e.status === 409) {
                  setLendingReviewStale(true);
                  return refresh();
                }
                setError(errorText(e));
              })
              .finally(() => setReviewing(false));
          }}
        />
      )}

      {overview && <MemoryGauge index={overview.index} />}

      {bot.memoryEnabled !== false && <MemoryUpkeepCard
        enabled={bot.memoryUpkeep !== false}
        status={upkeep}
        tidying={tidying}
        onToggle={toggleUpkeep}
        onTidy={() => void tidyNow()}
      />}

      {editing && (
        <MemoryEditorDialog
          editing={editing}
          botName={bot.name}
          conflict={conflict}
          saving={saving}
          savedDraft={savedDraft}
          onChange={(text) => setEditing({ ...editing, text, dirty: true })}
          onSave={() => void save(editing.hash)}
          onDiscard={() => void open(editing.path)}
          onClose={requestClose}
          onReload={reloadFromConflict}
          onOverwrite={() => { if (conflict) void save(conflict.currentHash); }}
          onDismissDraft={() => setSavedDraft(null)}
          onOpenIndex={() => void open(MEMORY_INDEX)}
        />
      )}

      {overview && (
        <div className="rounded-xl border border-hairline/40 p-4">
          <button
            type="button"
            onClick={() => void open(MEMORY_INDEX)}
            aria-label={t("botPanel.memory.aria")}
            className={cn(
              "mb-4 flex w-full items-center gap-2 rounded-lg border border-hairline/40 px-3 py-2 text-left hover:bg-control/40",
              editing?.path === MEMORY_INDEX && "bg-control/60",
            )}
          >
            <FileText size={14} className="shrink-0 text-ink-secondary" />
            <span className="truncate font-mono text-[12.5px] text-ink">MEMORY.md</span>
          </button>
          <MemoryFileRows
            title={t("botPanel.memory.topics")}
            hint={t("botPanel.memory.topicsHint")}
            files={overview.topics}
            selected={editing?.path}
            onOpen={(file) => void open(file.path)}
            onDelete={(file) => void remove(file)}
          />
          <div className="mt-3 flex items-center gap-2">
            <input
              className={cn(inputCls, "py-1.5 text-[13px]")}
              value={newTopic}
              placeholder={t("botPanel.memory.topicPlaceholder")}
              aria-label={t("botPanel.memory.topicAria")}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createTopic();
              }}
            />
            <button type="button" className={buttonCls} disabled={!newTopic.trim()} onClick={() => void createTopic()}>
              {t("botPanel.memory.newTopic")}
            </button>
          </div>
          {overview.logs.length > 0 && (
            <div className="mt-4">
              <MemoryFileRows
                title={t("botPanel.memory.logs")}
                hint={t("botPanel.memory.logsHint")}
                files={overview.logs}
                selected={editing?.path}
                onOpen={(file) => void open(file.path)}
                onDelete={(file) => void remove(file)}
              />
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-hairline/40 p-4">
        <div className="text-[13px] font-medium text-ink">{t("botPanel.memory.changes")}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
          {t("botPanel.memory.changesHelp")}
        </p>
        <div className="mt-3">
          <MemoryJournalList rows={journal} botName={bot.name} reverting={reverting} onRevert={(row) => void revert(row)} />
        </div>
      </div>

      {notice && <div className="text-[12.5px] text-ink-secondary">{notice}</div>}
      {error && <div className="text-[12.5px] text-danger">{error}</div>}
    </div>
  );
}

/** A new topic's starting text: the header the topic index and recall read,
 * so the other words a person would use for it are one line to fill in. */
export function topicTemplate(fileName: string): string {
  const title = fileName.replace(/\.md$/, "");
  return `---\ntitle: ${title}\ndescription: \naliases: []\n---\n\n`;
}

// ── presentational pieces (tested through renderToStaticMarkup) ─────────

export function MemoryUpkeepCard({
  enabled,
  status,
  tidying,
  onToggle,
  onTidy,
}: {
  enabled: boolean;
  status: UpkeepStatus | null;
  tidying: boolean;
  onToggle: () => void;
  onTidy: () => void;
}) {
  return (
    <div className="rounded-xl bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-ink">{t("botPanel.memory.upkeep")}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
            {t("botPanel.memory.upkeepHelp")}
          </p>
        </div>
        <Switch checked={enabled} aria-label={t("botPanel.memory.upkeep")} onClick={onToggle} />
      </div>
      {enabled && status && !status.modelSteps && (
        <p className="mt-2 text-[12.5px] text-ink-secondary">
          {t("botPanel.memory.noSteps")}
        </p>
      )}
      {enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={buttonCls} disabled={tidying} onClick={onTidy}>
            {tidying ? t("botPanel.memory.tidying") : t("botPanel.memory.tidyNow")}
          </button>
          <span className="text-[12.5px] text-ink-secondary">
            {status?.lastTidy
              ? t("botPanel.memory.lastTidy", { when: relativeTime(status.lastTidy.at), summary: tidySummary(status.lastTidy).toLowerCase() })
              : t("botPanel.memory.notTidied")}
            {status?.lastCapture && noticedCount(status.lastCapture)
              ? t(noticedCount(status.lastCapture) === 1 ? "botPanel.memory.noticedOne" : "botPanel.memory.noticedMany", {
                count: String(noticedCount(status.lastCapture)),
                when: relativeTime(status.lastCapture.at),
              })
              : ""}
          </span>
        </div>
      )}
    </div>
  );
}

export function MemoryGauge({ index }: { index: MemoryCapacity }) {
  const status = capacityStatus(index);
  const fill = status.level === "over" ? "bg-danger" : status.level === "near" ? "bg-warning" : "bg-accent";
  return (
    <div className={cn("p-1", status.level === "over" && "rounded-xl border border-danger/30 bg-danger/10 p-4")}>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="font-medium text-ink">{t("botPanel.memory.lines")}</span>
        <span className={cn("text-[12px]", status.level === "over" ? "text-danger" : "text-ink-secondary")}>
          {index.lines} / {index.maxLines} {t("botPanel.memory.linesLabel").toLocaleLowerCase()} · {formatBytes(index.bytes)} / {formatBytes(index.maxBytes)}
        </span>
      </div>
      <GaugeBar label={t("botPanel.memory.linesLabel")} share={status.lineShare} fill={fill} />
      <GaugeBar label={t("botPanel.memory.sizeLabel")} share={status.byteShare} fill={fill} />
      <p className={cn("mt-2 text-[12.5px] leading-relaxed", status.level === "over" ? "text-danger" : "text-ink-secondary")}>
        {status.warning ?? status.sentence}
      </p>
      {status.warning && <p className="mt-1 text-[12px] text-ink-secondary">{status.sentence}</p>}
    </div>
  );
}

function GaugeBar({ label, share, fill }: { label: string; share: number; fill: string }) {
  const width = `${Math.min(100, Math.round(share * 100))}%`;
  return (
    <div className="mt-2 flex items-center gap-2 text-[11.5px] text-ink-secondary">
      <span className="w-10 shrink-0">{label}</span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset"
        role="meter"
        aria-label={t("botPanel.memory.meter", { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(share * 100))}
      >
        <div className={cn("h-full rounded-full", fill)} style={{ width }} />
      </div>
    </div>
  );
}

export function ConflictNotice({
  botName,
  busy,
  onReload,
  onOverwrite,
}: {
  botName: string;
  busy: boolean;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink">
      <div className="font-medium">{t("botPanel.memory.changed", { name: botName })}</div>
      <div className="mt-0.5 text-ink-secondary">
        {t("botPanel.memory.nothingSaved", { name: botName })}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" className={buttonCls} disabled={busy} onClick={onReload}>
          {t("botPanel.memory.reload")}
        </button>
        <button type="button" className={buttonCls} disabled={busy} onClick={onOverwrite}>
          {t("botPanel.memory.overwrite")}
        </button>
      </div>
    </div>
  );
}

export function MemoryFileRows({
  title,
  hint,
  files,
  selected,
  onOpen,
  onDelete,
}: {
  title: string;
  hint: string;
  files: MemoryFileInfo[];
  selected?: string;
  onOpen: (file: MemoryFileInfo) => void;
  onDelete: (file: MemoryFileInfo) => void;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{title}</div>
      <div className="mt-0.5 text-[12px] text-ink-secondary">{hint}</div>
      {files.length === 0 ? (
        <div className="mt-2 text-[12.5px] text-ink-secondary">{t("botPanel.memory.noneYet")}</div>
      ) : (
        <div className="mt-2 overflow-hidden rounded-lg border border-hairline/40">
          {files.map((file) => (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-2 border-b border-hairline/40 px-3 py-2 last:border-b-0",
                selected === file.path ? "bg-control/60" : "hover:bg-control/40",
              )}
            >
              <button type="button" onClick={() => onOpen(file)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <FileText size={14} className="shrink-0 text-ink-secondary" />
                <span className="truncate font-mono text-[12.5px] text-ink">{file.name}</span>
                <span className="shrink-0 text-[11.5px] text-ink-secondary">
                  {formatBytes(file.bytes)} · {relativeTime(file.modifiedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(file)}
                aria-label={t("botPanel.memory.delete", { name: file.name })}
                title={t("botPanel.memory.deleteTitle")}
                className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-control hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MemoryJournalList({
  rows,
  botName,
  reverting,
  onRevert,
  now = Date.now(),
}: {
  rows: MemoryJournalRow[] | null;
  botName: string;
  reverting: string | null;
  onRevert: (row: MemoryJournalRow) => void;
  now?: number;
}) {
  if (!rows) return <div className="text-[13px] text-ink-secondary">{t("botPanel.loading")}</div>;
  if (rows.length === 0) return <div className="text-[13px] text-ink-secondary">{t("botPanel.history.empty")}</div>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const source = journalSource(row);
        return (
          <div key={row.id} className="rounded-lg bg-inset px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
                <span>{journalSummary(row, botName)}</span>
                {" · "}
                <span className="text-ink-secondary">{relativeTime(row.at, now)}</span>
                {source && (
                  <>
                    {" · "}
                    <span className="text-ink-secondary">{source}</span>
                  </>
                )}
              </div>
              {row.canRevert ? (
                <button
                  type="button"
                  disabled={reverting !== null}
                  onClick={() => onRevert(row)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10 disabled:opacity-50"
                >
                  <RotateCcw size={12} />
                  {reverting === row.id ? t("botPanel.memory.undoing") : t("botPanel.memory.undo")}
                </button>
              ) : (
                <span className="shrink-0 text-[11.5px] text-ink-secondary" title={row.revertUnavailableReason}>
                  {t("botPanel.memory.cantUndo")}
                </span>
              )}
            </div>
            {row.diff && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[12px] text-ink-secondary">
                  {t("botPanel.memory.diff", { added: String(row.added), removed: String(row.removed) })}
                </summary>
                <pre className="mt-1 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-md p-2 font-mono text-[11.5px] leading-relaxed text-ink">
                  {row.diff}
                </pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
