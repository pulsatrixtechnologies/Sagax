// What an attached archive holds: its file count on the chip and, on
// request ("Voir le contenu"), the list the server made of it. The list is
// read from the server's own manifest (GET /api/attachments/<name>/manifest),
// never by opening the archive in the renderer.
import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight, FileArchive } from "lucide-react";
import { cn } from "@/lib/cn";
import { attachmentBasename, formatSize, type ArchiveSummary } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";

/** "12 files" / "1 file", and the state when it was not unpacked. */
export function archiveCountLabel(summary: Pick<ArchiveSummary, "files" | "status">): string {
  const count = summary.files === 1 ? t("attach.archive.fileSingle") : t("attach.archive.files", { count: summary.files });
  switch (summary.status) {
    case "encrypted": return `${count} · ${t("attach.archive.encrypted")}`;
    case "too-large": return `${count} · ${t("attach.archive.tooLarge")}`;
    case "unsupported": return t("attach.archive.unsupported");
    case "invalid": return t("attach.archive.invalid");
    default: return count;
  }
}

/** The manifest of a stored archive, fetched once per path. Only the
 * server's own generated names are asked for. */
export function useArchiveManifest(path: string, initial?: ArchiveSummary): ArchiveSummary | null {
  const name = attachmentBasename(path);
  const valid = /^[0-9a-f-]+\.(zip|tar|tgz|7z)$/i.test(name);
  const [summary, setSummary] = useState<ArchiveSummary | null>(initial ?? null);
  useEffect(() => {
    if (initial || !valid) return;
    let cancelled = false;
    void fetch(`/api/attachments/${encodeURIComponent(name)}/manifest`)
      .then(async (response) => (response.ok ? (await response.json()) as ArchiveSummary : null))
      .then((value) => { if (!cancelled && value && Array.isArray(value.entries)) setSummary(value); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [name, valid, initial]);
  return summary;
}

/** The toggle and the list, under a chip. */
export function ArchiveContents({ summary, className }: { summary: ArchiveSummary; className?: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return <ArchiveContentsView summary={summary} className={className} open={open} onToggle={() => setOpen((value) => !value)} listId={listId} />;
}

export function ArchiveContentsView({ summary, className, open, onToggle, listId }: {
  summary: ArchiveSummary;
  className?: string;
  open: boolean;
  onToggle: () => void;
  listId: string;
}) {
  const hidden = summary.files - summary.entries.length;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 text-[10.5px] text-ink-tertiary">
        <FileArchive size={11} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate" data-testid="archive-count">{archiveCountLabel(summary)}</span>
      </div>
      {summary.entries.length > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={listId}
          className="mt-1 inline-flex items-center gap-0.5 rounded text-[10.5px] font-medium text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
        >
          {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
          {open ? t("attach.archive.hide") : t("attach.archive.show")}
        </button>
      )}
      {open && (
        <ul
          id={listId}
          aria-label={t("attach.archive.contents")}
          className="mt-1 max-h-48 overflow-auto rounded-md border border-hairline/40 bg-panel/80 px-2 py-1 font-mono text-[10.5px] leading-[1.5] text-ink-secondary"
        >
          {summary.entries.map((entry) => (
            <li key={entry.path} className="flex min-w-0 gap-2">
              <span className="min-w-0 flex-1 truncate" title={entry.path}>{entry.path}</span>
              <span className="shrink-0 text-ink-tertiary">{formatSize(entry.size)}</span>
            </li>
          ))}
          {hidden > 0 && <li className="text-ink-tertiary">{t("attach.archive.more", { count: hidden })}</li>}
        </ul>
      )}
    </div>
  );
}
