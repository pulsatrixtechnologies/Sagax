import { formatEndLabel, publicText, type RemoteSessionView } from "../../../shared/remote-session";
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

export function RemoteSessionFacts({ view }: { view: RemoteSessionView }) {
  return (
    <div data-remote-session-facts="">
      {remoteSessionRows(view).map((row) => (
        <div key={row.id} data-remote-field={row.id} className="flex items-baseline justify-between gap-4 border-b border-hairline/40 px-3 py-2 last:border-b-0">
          <span className="shrink-0 text-[13px] text-ink-secondary">{row.label}</span>
          <span className="min-w-0 text-right text-[13px] font-semibold text-ink">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
