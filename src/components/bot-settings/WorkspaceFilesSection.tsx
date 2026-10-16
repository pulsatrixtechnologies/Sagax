// Files: the bot's whole workspace (docs/bot-workspace.md). Each file says
// when it reaches the bot (every turn, on demand, never loaded), its size
// against a budget when it has one, its dates, when the bot last used it,
// and whether it looks forgotten (no use in 30 days, not loaded every turn).
//
// RULES.md and docs/ open in the markdown editor in place for whoever may
// edit the Soul (owner or admin); MEMORY.md and memory/ do too when the
// viewer may edit Memory (admin routes). Every save has Memory's conflict
// check; any other file is read-only, with a download.
// SOUL.md lives on the bot record and opens the Soul category. Documents in
// docs/ can be created, uploaded (.md), renamed and deleted here.
//
// The Bot folder is also the memory's one interface (JC 2026-10-15): for a
// viewer who may edit Memory, "Use memory" heads the page, "New" makes a
// document or a memory topic (a file in memory/), memory files can be
// deleted from their row, and the memory's options (tidying, the change log
// with undo) are in the folder's "..." menu (MemoryFolderOptions).
//
// Simple mode keeps the list and the badges, and leaves out their details
// (budgets, dates, last use). Folders start collapsed; a chevron opens
// them like a file manager.
import { ChevronRight, Download, File as FileIcon, FilePlus, Folder, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { deleteMemoryDoc, fetchMemoryDoc, formatBytes, relativeTime, saveMemoryDoc, topicFileName } from "@/lib/memory";
import {
  DOCS_DIR,
  deleteWorkspaceDoc,
  docPathFromName,
  entryAncestors,
  entryDepth,
  entryName,
  entryVisible,
  fetchWorkspace,
  fetchWorkspaceDoc,
  isRulesOrDoc,
  renameWorkspaceDoc,
  saveWorkspaceDoc,
  workspaceDownloadUrl,
  type WorkspaceEntry,
  type WorkspaceListing,
  type WorkspaceLoad,
} from "@/lib/workspace-files";
import type { LocaleKey } from "@/locales";
import type { Bot, BotSettingsSection } from "@/state/store";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { ConfirmDialog } from "../ConfirmDialog";
import { HelpTip, PILL } from "../SettingsPrimitives";
import { inputCls } from "./field";
import { RulesCounter } from "./RulesSection";
import { MemoryToggleCard, topicTemplate } from "./MemorySection";
import { MemoryFolderOptions } from "./MemoryFolderOptions";

// Settings' grey pill (2026-10-16).
const buttonCls = PILL;
const iconButtonCls = "rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50";
/** sha256 of "": a save that expects it creates the file and refuses to
 * overwrite one that already exists. */
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const LOAD_LABEL: Record<WorkspaceLoad, LocaleKey> = {
  "every-turn": "persona.files.load.everyTurn",
  "on-demand": "persona.files.load.onDemand",
  never: "persona.files.load.never",
};
const LOAD_DETAIL: Record<WorkspaceLoad, LocaleKey> = {
  "every-turn": "persona.files.load.everyTurnDetail",
  "on-demand": "persona.files.load.onDemandDetail",
  never: "persona.files.load.neverDetail",
};
const LOAD_TONE: Record<WorkspaceLoad, string> = {
  "every-turn": "bg-accent/15 text-ink",
  "on-demand": "bg-raised text-ink-secondary",
  never: "bg-transparent text-ink-tertiary border border-hairline/40",
};

interface Open {
  path: string;
  text: string;
  hash: string;
  dirty: boolean;
  readOnly: boolean;
}

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export function LoadBadge({ load, detailed }: { load: WorkspaceLoad; detailed: boolean }) {
  return (
    <span
      data-load-badge={load}
      title={detailed ? t(LOAD_DETAIL[load]) : undefined}
      className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4", LOAD_TONE[load])}
    >
      {t(LOAD_LABEL[load])}
    </span>
  );
}

function budgetText(entry: WorkspaceEntry): string | null {
  const budget = entry.budget;
  if (!budget) return null;
  return budget.maxLines
    ? t("persona.files.budgetLines", { lines: budget.lines, maxLines: budget.maxLines, bytes: formatBytes(budget.bytes), maxBytes: formatBytes(budget.maxBytes) })
    : t("persona.files.budgetBytes", { bytes: formatBytes(budget.bytes), maxBytes: formatBytes(budget.maxBytes) });
}

/** One row's details line (Advanced only): size or budget, dates, last use. */
export function entryDetails(entry: WorkspaceEntry, now: number): string {
  const parts = [budgetText(entry) ?? formatBytes(entry.bytes)];
  if (entry.createdAt) parts.push(t("persona.files.created", { when: relativeTime(entry.createdAt, now) }));
  if (entry.modifiedAt) parts.push(t("persona.files.modified", { when: relativeTime(entry.modifiedAt, now) }));
  parts.push(entry.lastUsedAt ? t("persona.files.lastUsed", { when: relativeTime(entry.lastUsedAt, now) }) : t("persona.files.neverUsed"));
  return parts.join(" · ");
}

async function downloadEntry(botId: string, path: string): Promise<void> {
  const response = await fetch(workspaceDownloadUrl(botId, path));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? t("attach.downloadFailed"));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = entryName(path);
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function WorkspaceFilesSection({
  bot,
  active,
  onOpenSection,
  initial,
  initialExpanded,
  memoryEditable = false,
  memory,
}: {
  bot: Bot;
  active: boolean;
  /** the viewer may edit Memory too (MEMORY.md, memory/ in place) */
  memoryEditable?: boolean;
  /** "Use memory" at the head of the folder, for a viewer who may change it */
  memory?: { enabled: boolean; busy: boolean; onToggle: (enabled: boolean) => void };
  onOpenSection: (target: BotSettingsSection) => void;
  /** a listing to start from (tests); otherwise fetched when active */
  initial?: WorkspaceListing;
  /** folders start collapsed; tests pass the open ones */
  initialExpanded?: Iterable<string>;
}) {
  const advanced = useAdvancedMode();
  const [listing, setListing] = useState<WorkspaceListing | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState<"doc" | "topic" | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [conflict, setConflict] = useState<{ current: string; currentHash: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded));
  const uploadRef = useRef<HTMLInputElement>(null);

  const reload = () =>
    fetchWorkspace(bot.id).then(
      (next) => {
        setListing(next);
        setError(null);
      },
      (reason: unknown) => setError(errorText(reason)),
    );

  useEffect(() => {
    setExpanded(new Set(initialExpanded));
    // Folders start collapsed per bot; initialExpanded is a test seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  useEffect(() => {
    if (!active) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bot.id]);

  const reveal = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestor of entryAncestors(path)) next.add(ancestor);
      return next;
    });
  };

  const toggleDir = (path: string) => {
    const closing = expanded.has(path);
    const hidesOpen = Boolean(open && (open.path === path || open.path.startsWith(`${path}/`)));
    if (closing && hidesOpen && open?.dirty && !window.confirm(t("persona.files.dropDraft"))) return;
    if (closing && hidesOpen && open?.dirty) {
      setOpen(null);
      setConflict(null);
    }
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const editableHere = (entry: WorkspaceEntry) => entry.editable && (isRulesOrDoc(entry.path) || memoryEditable);

  const openEntry = (entry: WorkspaceEntry) => {
    if (entry.virtual === "soul") return onOpenSection("soul");
    if (open?.dirty && !window.confirm(t("persona.files.dropDraft"))) return;
    setConflict(null);
    if (open?.path === entry.path) return setOpen(null);
    reveal(entry.path);
    void run(async () => {
      if (editableHere(entry)) {
        const doc = isRulesOrDoc(entry.path) ? await fetchWorkspaceDoc(bot.id, entry.path) : await fetchMemoryDoc(bot.id, entry.path);
        setOpen({ path: entry.path, text: doc.text, hash: doc.hash, dirty: false, readOnly: false });
        return;
      }
      if (!entry.markdown) {
        await downloadEntry(bot.id, entry.path);
        return;
      }
      const response = await fetch(workspaceDownloadUrl(bot.id, entry.path));
      if (!response.ok) throw new Error(t("persona.files.readFailed"));
      setOpen({ path: entry.path, text: await response.text(), hash: "", dirty: false, readOnly: true });
    });
  };

  const save = (expectedHash: string) =>
    run(async () => {
      if (!open) return;
      const result = isRulesOrDoc(open.path)
        ? await saveWorkspaceDoc(bot.id, open.path, open.text, expectedHash)
        : await saveMemoryDoc(bot.id, open.path, open.text, expectedHash);
      if (!result.ok) {
        setConflict({ current: result.current, currentHash: result.currentHash });
        return;
      }
      setConflict(null);
      setOpen({ ...open, text: result.doc.text, hash: result.doc.hash, dirty: false });
      await reload();
    });

  const createDoc = (name: string, text: string) =>
    run(async () => {
      const path = docPathFromName(name);
      if (!path) throw new Error(t("persona.files.badName"));
      const result = await saveWorkspaceDoc(bot.id, path, text, EMPTY_HASH);
      if (!result.ok) throw new Error(t("persona.files.exists", { path }));
      setNewName("");
      await reload();
      reveal(path);
      setOpen({ path, text: result.doc.text, hash: result.doc.hash, dirty: false, readOnly: false });
    });

  /** A memory topic: a file in memory/ with the header recall reads. */
  const createTopic = (name: string) =>
    run(async () => {
      const file = topicFileName(name);
      if (!file) throw new Error(t("botPanel.memory.badTopic"));
      const path = `memory/${file}`;
      const result = await saveMemoryDoc(bot.id, path, topicTemplate(file), EMPTY_HASH);
      if (!result.ok) throw new Error(t("persona.files.exists", { path }));
      setNewName("");
      setCreating(null);
      await reload();
      reveal(path);
      setOpen({ path, text: result.doc.text, hash: result.doc.hash, dirty: false, readOnly: false });
    });

  const create = () => {
    if (!newName.trim()) return;
    if (creating === "topic") void createTopic(newName);
    else void createDoc(newName, `# ${newName.trim().replace(/\.md$/i, "")}\n`).then(() => setCreating(null));
  };

  // A delete asks first in the app's own dialog, with a red pill
  // (2026-10-16, Settings' rule for what erases).
  const [removing, setRemoving] = useState<{ path: string; name: string; memory: boolean } | null>(null);
  const removeMemoryFile = (entry: WorkspaceEntry) => setRemoving({ path: entry.path, name: entryName(entry.path), memory: true });
  const deleteMemoryFile = (entry: { path: string }) => {
    void run(async () => {
      await deleteMemoryDoc(bot.id, entry.path);
      if (open?.path === entry.path) setOpen(null);
      await reload();
    });
  };

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setError(t("persona.files.uploadOnlyMarkdown"));
      return;
    }
    void file.text().then((text) => createDoc(file.name.replace(/\.markdown$/i, ".md"), text), (reason: unknown) => setError(errorText(reason)));
  };

  const removeDoc = (path: string) => setRemoving({ path, name: entryName(path), memory: false });
  const deleteDoc = (path: string) => {
    void run(async () => {
      await deleteWorkspaceDoc(bot.id, path);
      if (open?.path === path) setOpen(null);
      await reload();
    });
  };

  const rename = () => {
    if (!renaming) return;
    const target = docPathFromName(renaming.value);
    if (!target) {
      setError(t("persona.files.badName"));
      return;
    }
    void run(async () => {
      await renameWorkspaceDoc(bot.id, renaming.path, target);
      if (open?.path === renaming.path) setOpen({ ...open, path: target });
      setRenaming(null);
      await reload();
    });
  };

  const now = listing?.now ?? Date.now();
  const listedDirs = new Set((listing?.entries ?? []).filter((entry) => entry.kind === "dir").map((entry) => entry.path));
  const rows = listing ? [listing.soul, ...listing.entries].filter((entry) => entryVisible(entry.path, expanded, listedDirs)) : [];
  const isDoc = (entry: WorkspaceEntry) => entry.kind === "file" && entry.path.startsWith(`${DOCS_DIR}/`) && entry.path.split("/").length === 2;

  return (
    <div className="flex flex-col gap-3" data-workspace-files="">
      {memory && <MemoryToggleCard enabled={memory.enabled} busy={memory.busy} onToggle={memory.onToggle} />}
      <div className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
        <span>{t("persona.files.short")}</span>
        <HelpTip label={t("settings.moreAbout", { title: t("botSettings.nav.files") })}>
          <span className="block">{t("persona.files.intro")}</span>
          {advanced && listing && <span className="mt-2 block break-all font-mono" data-workspace-path="">{listing.workspacePath}</span>}
        </HelpTip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(buttonCls, "inline-flex items-center gap-1.5")}
          disabled={busy}
          aria-expanded={creating !== null}
          onClick={() => setCreating(creating === null ? "doc" : null)}
          data-files-new-menu=""
        >
          <FilePlus size={14} aria-hidden="true" />
          {t("persona.files.newMenu")}
        </button>
        <button
          type="button"
          className={cn(buttonCls, "inline-flex items-center gap-1.5")}
          disabled={busy}
          onClick={() => uploadRef.current?.click()}
          data-files-upload=""
        >
          <Upload size={14} aria-hidden="true" />
          {t("persona.files.upload")}
        </button>
        {memoryEditable && (
          <button
            type="button"
            className={cn(iconButtonCls, "ml-auto p-1.5")}
            aria-label={t("persona.files.options")}
            title={t("persona.files.options")}
            aria-expanded={showOptions}
            onClick={() => setShowOptions((shown) => !shown)}
            data-files-options=""
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        )}
        <input ref={uploadRef} type="file" accept=".md,.markdown,text/markdown" hidden onChange={onUpload} />
      </div>

      {creating && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-[0.5px] border-border bg-elevated p-2" data-files-create={creating}>
          {memoryEditable && (
            <div role="radiogroup" aria-label={t("persona.files.newKindLabel")} className="flex gap-0.5 rounded-lg bg-control p-0.5">
              {(["doc", "topic"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={creating === kind}
                  onClick={() => setCreating(kind)}
                  data-files-kind={kind}
                  className={cn("rounded-md px-2.5 py-1 text-[12.5px]", creating === kind ? "bg-selected font-medium text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}
                >
                  {t(kind === "doc" ? "persona.files.newKind.document" : "persona.files.newKind.topic")}
                </button>
              ))}
            </div>
          )}
          <input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && newName.trim()) {
                event.preventDefault();
                create();
              }
              if (event.key === "Escape") setCreating(null);
            }}
            placeholder={t(creating === "topic" ? "botPanel.memory.topicPlaceholder" : "persona.files.newPlaceholder")}
            aria-label={t(creating === "topic" ? "botPanel.memory.topicAria" : "persona.files.newLabel")}
            className={cn(inputCls, "min-w-0 max-w-[240px] flex-1")}
            data-files-new-name=""
          />
          <button type="button" className={buttonCls} disabled={busy || !newName.trim()} onClick={create} data-files-new="">
            {t("persona.files.create")}
          </button>
          <button type="button" className="rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink" onClick={() => setCreating(null)}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      {memoryEditable && <MemoryFolderOptions bot={bot} active={active} showOptions={showOptions} onChanged={() => void reload()} />}

      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {listing === null && !error && <p className="text-[12.5px] text-ink-secondary">{t("persona.files.loading")}</p>}
      {listing?.truncated && <p className="text-[12.5px] text-ink-secondary">{t("persona.files.truncated")}</p>}

      <ul className="flex flex-col divide-y divide-hairline/40 overflow-clip rounded-xl border-[0.5px] border-border bg-elevated" data-files-list="">
        {rows.map((entry) => {
          const depth = entryDepth(entry.path);
          const name = entryName(entry.path);
          const isOpen = open?.path === entry.path;
          const folderOpen = entry.kind === "dir" && expanded.has(entry.path);
          return (
            <li key={entry.path} data-file-row={entry.path} data-forgotten={entry.forgotten ? "" : undefined} data-folder-expanded={entry.kind === "dir" ? (folderOpen ? "true" : "false") : undefined} className="px-3 py-2">
              <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                {entry.kind === "dir" ? (
                  <button
                    type="button"
                    data-folder-toggle={entry.path}
                    aria-expanded={folderOpen}
                    aria-label={t(folderOpen ? "persona.files.collapse" : "persona.files.expand", { name })}
                    onClick={() => toggleDir(entry.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-ink-secondary hover:text-ink"
                  >
                    <ChevronRight size={12} aria-hidden="true" className={cn("shrink-0 transition-transform", folderOpen && "rotate-90")} />
                    <Folder size={14} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{name}/</span>
                  </button>
                ) : (
                  <span className="w-3 shrink-0" aria-hidden="true" />
                )}
                {entry.kind === "file" && <FileIcon size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
                {entry.kind === "dir" ? null : renaming?.path === entry.path ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(event) => setRenaming({ path: entry.path, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") rename();
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    aria-label={t("persona.files.renameLabel")}
                    className={cn(inputCls, "min-w-0 flex-1")}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => openEntry(entry)}
                    aria-expanded={entry.markdown ? isOpen : undefined}
                    className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline"
                    data-file-open={entry.path}
                  >
                    {name}
                  </button>
                )}
                {entry.forgotten && (
                  <span data-forgotten-badge="" title={advanced ? t("persona.files.forgottenDetail", { days: listing?.forgottenAfterDays ?? 30 }) : undefined} className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] leading-4 text-warning">
                    {t("persona.files.forgotten")}
                  </span>
                )}
                {entry.kind === "file" && <LoadBadge load={entry.load} detailed={advanced} />}
                {isDoc(entry) && renaming?.path !== entry.path && (
                  <>
                    <button type="button" className={iconButtonCls} disabled={busy} aria-label={t("persona.files.rename", { name })} onClick={() => setRenaming({ path: entry.path, value: name.replace(/\.md$/, "") })}>
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button type="button" className={iconButtonCls} disabled={busy} aria-label={t("persona.files.delete", { name })} onClick={() => removeDoc(entry.path)}>
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </>
                )}
                {memoryEditable && entry.kind === "file" && entry.path.startsWith("memory/") && (
                  <button type="button" className={iconButtonCls} disabled={busy} aria-label={t("botPanel.memory.delete", { name })} onClick={() => removeMemoryFile(entry)} data-file-delete={entry.path}>
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
                {entry.kind === "file" && !entry.virtual && (
                  <button type="button" className={iconButtonCls} disabled={busy} aria-label={t("persona.files.download", { name })} onClick={() => void run(() => downloadEntry(bot.id, entry.path))}>
                    <Download size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
              {advanced && entry.kind === "file" && (
                <div className={cn("mt-0.5 text-[11.5px] text-ink-tertiary", entry.budget?.over && "text-danger")} style={{ paddingLeft: depth * 16 + 42 }} data-file-details="">
                  {entryDetails(entry, now)}
                </div>
              )}
              {isOpen && open && (
                <div className="mt-2 flex flex-col gap-2" data-file-editor={open.path}>
                  {open.readOnly && <p className="text-[12px] text-ink-secondary">{t("persona.files.readOnly")}</p>}
                  <MarkdownEditor
                    ariaLabel={open.path}
                    value={open.text}
                    readOnly={open.readOnly}
                    onChange={(text) => setOpen({ ...open, text, dirty: true })}
                    minHeight={200}
                    dataField={`workspace-file:${open.path}`}
                    footer={open.path === "RULES.md" ? <RulesCounter text={open.text} /> : <span>{open.path}</span>}
                  />
                  {conflict && (
                    <div role="alert" className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink">
                      <div className="font-medium">{t("persona.rules.conflict")}</div>
                      <div className="mt-2 flex gap-2">
                        <button type="button" className={buttonCls} disabled={busy} onClick={() => { setOpen({ ...open, text: conflict.current, hash: conflict.currentHash, dirty: false }); setConflict(null); }}>
                          {t("persona.rules.reload")}
                        </button>
                        <button type="button" className={buttonCls} disabled={busy} onClick={() => void save(conflict.currentHash)}>
                          {t("persona.rules.overwrite")}
                        </button>
                      </div>
                    </div>
                  )}
                  {!open.readOnly && (
                    <div className="flex items-center gap-2">
                      <button type="button" className={buttonCls} disabled={busy || !open.dirty} onClick={() => void save(open.hash)} data-file-save="">
                        {t("persona.rules.save")}
                      </button>
                      <button type="button" className="rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink" disabled={busy} onClick={() => { setOpen(null); setConflict(null); }}>
                        {t("common.close")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {listing && rows.length === 1 && listing.entries.length === 0 && (
          <li className="px-3 py-2 text-[12.5px] text-ink-secondary">{t("persona.files.empty")}</li>
        )}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        title={t(removing?.memory ? "botPanel.memory.delete" : "persona.files.delete", { name: removing?.name ?? "" })}
        body={removing ? (removing.memory ? t("botPanel.memory.confirmDelete", { name: removing.name }) : t("persona.files.confirmDelete", { path: removing.path })) : ""}
        confirmLabel={t("common.delete")}
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) return;
          if (target.memory) deleteMemoryFile(target);
          else deleteDoc(target.path);
        }}
      />
    </div>
  );
}
