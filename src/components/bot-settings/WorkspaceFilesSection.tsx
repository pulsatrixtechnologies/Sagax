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
// Simple mode keeps the list and the badges, and leaves out their details
// (budgets, dates, last use).
import { Download, File as FileIcon, FilePlus, Folder, Pencil, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { fetchMemoryDoc, formatBytes, relativeTime, saveMemoryDoc } from "@/lib/memory";
import {
  DOCS_DIR,
  deleteWorkspaceDoc,
  docPathFromName,
  entryDepth,
  entryName,
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
import { inputCls } from "./field";
import { RulesCounter } from "./RulesSection";

const buttonCls = "rounded-lg bg-control px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50";
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
  memoryEditable = false,
}: {
  bot: Bot;
  active: boolean;
  /** the viewer may edit Memory too (MEMORY.md, memory/ in place) */
  memoryEditable?: boolean;
  onOpenSection: (target: BotSettingsSection) => void;
  /** a listing to start from (tests); otherwise fetched when active */
  initial?: WorkspaceListing;
}) {
  const advanced = useAdvancedMode();
  const [listing, setListing] = useState<WorkspaceListing | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [conflict, setConflict] = useState<{ current: string; currentHash: string } | null>(null);
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
    if (!active) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bot.id]);

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
      setOpen({ path, text: result.doc.text, hash: result.doc.hash, dirty: false, readOnly: false });
    });

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

  const removeDoc = (path: string) => {
    if (!window.confirm(t("persona.files.confirmDelete", { path }))) return;
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
  const rows = listing ? [listing.soul, ...listing.entries] : [];
  const isDoc = (entry: WorkspaceEntry) => entry.kind === "file" && entry.path.startsWith(`${DOCS_DIR}/`) && entry.path.split("/").length === 2;

  return (
    <div className="flex flex-col gap-3" data-workspace-files="">
      <p className="text-[13px] leading-relaxed text-ink-secondary">{t("persona.files.intro")}</p>
      {advanced && listing && (
        <p className="break-all text-[12px] text-ink-tertiary" data-workspace-path="">{listing.workspacePath}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && newName.trim()) {
              event.preventDefault();
              void createDoc(newName, `# ${newName.trim().replace(/\.md$/i, "")}\n`);
            }
          }}
          placeholder={t("persona.files.newPlaceholder")}
          aria-label={t("persona.files.newLabel")}
          className={cn(inputCls, "max-w-[240px]")}
          data-files-new-name=""
        />
        <button
          type="button"
          className={cn(buttonCls, "inline-flex items-center gap-1.5")}
          disabled={busy || !newName.trim()}
          onClick={() => void createDoc(newName, `# ${newName.trim().replace(/\.md$/i, "")}\n`)}
          data-files-new=""
        >
          <FilePlus size={14} aria-hidden="true" />
          {t("persona.files.new")}
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
        <input ref={uploadRef} type="file" accept=".md,.markdown,text/markdown" hidden onChange={onUpload} />
      </div>

      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {listing === null && !error && <p className="text-[12.5px] text-ink-secondary">{t("persona.files.loading")}</p>}
      {listing?.truncated && <p className="text-[12.5px] text-ink-secondary">{t("persona.files.truncated")}</p>}

      <ul className="flex flex-col divide-y divide-hairline/30 rounded-xl border border-hairline/40" data-files-list="">
        {rows.map((entry) => {
          const depth = entryDepth(entry.path);
          const name = entryName(entry.path);
          const isOpen = open?.path === entry.path;
          return (
            <li key={entry.path} data-file-row={entry.path} data-forgotten={entry.forgotten ? "" : undefined} className="px-3 py-2">
              <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                {entry.kind === "dir"
                  ? <Folder size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                  : <FileIcon size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
                {entry.kind === "dir" ? (
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{name}/</span>
                ) : renaming?.path === entry.path ? (
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
                {entry.kind === "file" && !entry.virtual && (
                  <button type="button" className={iconButtonCls} disabled={busy} aria-label={t("persona.files.download", { name })} onClick={() => void run(() => downloadEntry(bot.id, entry.path))}>
                    <Download size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
              {advanced && entry.kind === "file" && (
                <div className={cn("mt-0.5 text-[11.5px] text-ink-tertiary", entry.budget?.over && "text-danger")} style={{ paddingLeft: depth * 16 + 22 }} data-file-details="">
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
    </div>
  );
}
