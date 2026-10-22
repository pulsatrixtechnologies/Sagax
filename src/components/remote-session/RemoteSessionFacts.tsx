import { formatEndLabel, publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

function shown(value: string | undefined): string {
  return publicText(value) ?? t("remoteSession.unknown");
}

export function remoteSessionRows(view: RemoteSessionView): Array<{ id: string; label: string; value: string }> {
  const posteName = publicText(view.hostname);
  const osName = publicText(view.osName);
  const poste = posteName && osName ? `${posteName}, ${osName}` : posteName || osName || t("remoteSession.unknown");
  const time = formatEndLabel(view.endAt);
  const ends = time ? t("remoteSession.ends", { time }) : "";
  const session = ends ? `${view.code}, ${ends}` : view.code;
  return [
    { id: "poste", label: t("remoteSession.field.poste"), value: poste },
    { id: "user", label: t("remoteSession.field.user"), value: shown(view.user) },
    { id: "rights", label: t("remoteSession.field.rights"), value: view.elevated ? t("remoteSession.rights.admin") : t("remoteSession.rights.standard") },
    { id: "session", label: t("remoteSession.field.session"), value: session },
    { id: "serial", label: t("remoteSession.field.serial"), value: shown(view.serial) },
    { id: "model", label: t("remoteSession.field.model"), value: shown(view.model) },
    { id: "cpu", label: t("remoteSession.field.cpu"), value: shown(view.cpu) },
    { id: "ram", label: t("remoteSession.field.ram"), value: shown(view.ram) },
    { id: "disk", label: t("remoteSession.field.disk"), value: shown(view.disk) },
  ];
}

// The machine's inventory stays folded under "Détails du poste" (JC
// 2026-10-21): the card opens on who and where, not on a block of hardware.
// The folded row still says the model and the memory, so the fold reads as a
// summary rather than a mystery button.
const DETAIL_FIELDS = new Set(["serial", "model", "cpu", "ram", "disk"]);

/** "PowerEdge R650 · 32 Go": the model and the memory, when known. */
export function remoteDetailsSummary(view: RemoteSessionView): string {
  return [publicText(view.model), publicText(view.ram)].filter(Boolean).join(" · ");
}

function FactRow({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div data-remote-field={id} className="flex items-baseline justify-between gap-4 border-b border-hairline/40 px-3 py-2 last:border-b-0">
      <span className="shrink-0 text-[13px] text-ink-secondary">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px] font-semibold text-ink">{value}</span>
    </div>
  );
}

export function RemoteSessionFacts({ view, detailsOpen = false }: { view: RemoteSessionView; detailsOpen?: boolean }) {
  const [open, setOpen] = useState(detailsOpen);
  const bodyId = useId();
  const rows = remoteSessionRows(view);
  const main = rows.filter((row) => !DETAIL_FIELDS.has(row.id));
  const details = rows.filter((row) => DETAIL_FIELDS.has(row.id));
  const summary = remoteDetailsSummary(view);
  return (
    <div data-remote-session-facts="">
      {main.map((row) => <FactRow key={row.id} {...row} />)}
      <button
        type="button"
        data-remote-details-toggle=""
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full min-w-0 items-center gap-3 border-b border-hairline/40 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none motion-reduce:transition-none"
      >
        <span className="shrink-0 text-[13px] text-ink-secondary group-hover:text-ink">{t("remoteSession.details")}</span>
        {!open && summary && (
          <span data-remote-details-summary="" className="min-w-0 flex-1 truncate text-right text-[12.5px] text-ink-tertiary">{summary}</span>
        )}
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={cn(
            "ml-auto shrink-0 text-ink-tertiary transition-transform duration-200 ease-out group-hover:text-ink-secondary motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          id={bodyId}
          data-remote-details=""
          className="border-b border-hairline/40 bg-inset/40 transition-[opacity,translate] duration-200 ease-out last:border-b-0 starting:-translate-y-1 starting:opacity-0 motion-reduce:transition-none"
        >
          {details.map((row) => <FactRow key={row.id} {...row} />)}
        </div>
      )}
    </div>
  );
}
