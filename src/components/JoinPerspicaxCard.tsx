// Settings > Organization on a solo Sagax (slice 8): "Join a Perspicax
// server". Copying bots is optional. With no bot chosen, Join saves the
// server and starts its "Sign in with Pulsatrix" (orgJoin.join, the launch
// screen's Server mode). Otherwise the person picks which of their own bots
// to copy, with or without their conversations and memory, sees what stays
// behind, then either hands the copy to the desktop (which opens the
// organization server) or downloads it for the organization's own Sagax.
import { useEffect, useMemo, useState } from "react";

import { t } from "@/lib/i18n";
import {
  choiceFor,
  copiedTo,
  exportRequest,
  offeredBots,
  serverAddress,
  withChoice,
  type JoinChoice,
  type LinkedSubject,
  type OrgExportAnswer,
} from "@/lib/org-join";
import { api, useStore } from "@/state/store";
import { Card } from "./SettingsPrimitives";

function download(answer: OrgExportAnswer): void {
  const blob = new Blob([JSON.stringify(answer.document)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = answer.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function notCopiedLine(entry: OrgExportAnswer["summary"]["notCopied"][number]): string {
  if (entry.kind === "grant") return t("orgJoin.notCopied.grant", { name: entry.name, person: entry.person ?? "" });
  if (entry.reason === "other_people") return t("orgJoin.notCopied.otherPeople", { name: entry.name, person: entry.person ?? "" });
  if (entry.reason === "room_not_copied") return t("orgJoin.notCopied.roomNotCopied", { name: entry.name });
  return t("orgJoin.notCopied.botNotChosen", { name: entry.name });
}

export function JoinPerspicaxCard() {
  const { state: store } = useStore();
  const bridge = window.ogb?.remoteClient?.active ? undefined : window.ogb?.orgJoin;
  const bots = useMemo(() => offeredBots(store.bots ?? [], store.config?.viewer?.principalId), [store.bots, store.config?.viewer?.principalId]);
  const [choices, setChoices] = useState<Record<string, JoinChoice>>({});
  const [preview, setPreview] = useState<OrgExportAnswer | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linked, setLinked] = useState<LinkedSubject[]>([]);

  useEffect(() => {
    let alive = true;
    void api<{ linkedSubjects?: LinkedSubject[] }>("/api/identity/linked-subjects")
      .then((body) => { if (alive) setLinked(body.linkedSubjects ?? []); }, () => {});
    return () => { alive = false; };
  }, []);

  const request = exportRequest(bots, choices);
  const set = (botId: string, field: keyof JoinChoice, value: boolean) => {
    setChoices((current) => withChoice(current, botId, field, value));
    setPreview(null);
  };
  const runExport = async (): Promise<OrgExportAnswer | null> => {
    if (!request.bots.length) return null;
    setBusy(true);
    setError("");
    try {
      const answer = await api<OrgExportAnswer>("/api/org/export", { method: "POST", body: JSON.stringify(request) });
      setPreview(answer);
      return answer;
    } catch {
      setError(t("orgJoin.exportFailed"));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const joinAndCopy = async () => {
    const origin = serverAddress(address);
    if (!bridge || !origin) {
      setError(t("orgJoin.badAddress"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const probed = await bridge.probe(origin);
      if (!request.bots.length) {
        await bridge.join({ origin: probed.origin });
        return;
      }
      const answer = await api<OrgExportAnswer>("/api/org/export", { method: "POST", body: JSON.stringify(request) });
      setPreview(answer);
      await bridge.stage({ origin: probed.origin, document: answer.document });
    } catch {
      setError(t("orgJoin.joinFailed"));
    } finally {
      setBusy(false);
    }
  };

  const summary = preview?.summary;
  return (
    <Card collapsible cardId="organization.joinPerspicax" title={t("orgJoin.title")} summary={t("orgJoin.summary")}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="leading-relaxed text-ink-secondary">{t("orgJoin.intro")}</p>
        {bots.length === 0 ? <p className="text-ink-secondary">{t("orgJoin.noBots")}</p> : (
          <ul className="flex flex-col divide-y divide-hairline/40" aria-label={t("orgJoin.botsLabel")}>
            {bots.map((bot) => {
              const choice = choiceFor(choices, bot.id);
              return (
                <li key={bot.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <label className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-ink">
                    <input type="checkbox" checked={choice.copy} onChange={(event) => set(bot.id, "copy", event.target.checked)} />
                    <span className="truncate">{bot.name}</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-ink-secondary">
                    <input type="checkbox" checked={choice.copy && choice.threads} disabled={!choice.copy} onChange={(event) => set(bot.id, "threads", event.target.checked)} />
                    {t("orgJoin.threads")}
                  </label>
                  <label className="flex items-center gap-1.5 text-ink-secondary">
                    <input type="checkbox" checked={choice.copy && choice.memory} disabled={!choice.copy} onChange={(event) => set(bot.id, "memory", event.target.checked)} />
                    {t("orgJoin.memory")}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[12px] text-ink-secondary">{t("orgJoin.neverCopied")}</p>
        {bridge && <p className="text-[12px] text-ink-secondary">{t("orgJoin.copyOptional")}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-button" disabled={busy || !request.bots.length} onClick={() => void runExport()}>{t("orgJoin.preview")}</button>
        </div>
        {summary && (
          <div role="status" className="flex flex-col gap-1 rounded-lg border border-hairline/40 p-3">
            <p className="text-ink">{t("orgJoin.counts", { bots: summary.bots.length, rooms: summary.groups.length, routines: summary.routines.length })}</p>
            {summary.routines.length > 0 && <p className="text-ink-secondary">{t("orgJoin.routinesPaused")}</p>}
            {summary.redacted > 0 && <p className="text-ink-secondary">{t("orgJoin.redacted", { count: summary.redacted })}</p>}
            {summary.notCopied.length > 0 && (
              <>
                <p className="mt-1 text-ink">{t("orgJoin.notCopiedTitle")}</p>
                <ul className="list-disc ps-5 text-ink-secondary">
                  {summary.notCopied.map((entry, index) => <li key={index} className="break-words">{notCopiedLine(entry)}</li>)}
                </ul>
              </>
            )}
          </div>
        )}
        {bridge ? (
          <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void joinAndCopy(); }}>
            <label className="flex flex-col gap-1.5 text-ink">{t("orgJoin.address")}
              <input type="url" value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)} placeholder="https://sagax.example.com"
                autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} maxLength={2048}
                className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
            </label>
            <button type="submit" className="w-fit rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
              disabled={busy || !address.trim()}>{busy ? t("orgJoin.working") : request.bots.length ? t("orgJoin.joinAndCopy") : t("orgJoin.join")}</button>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <button type="button" className="ui-button w-fit" disabled={busy || !request.bots.length}
              onClick={() => void runExport().then((answer) => { if (answer) download(answer); })}>{t("orgJoin.download")}</button>
            <p className="text-ink-secondary">{t("orgJoin.downloadHelp")}</p>
          </div>
        )}
        {error && <p role="alert" className="text-danger">{error}</p>}
        {linked.length > 0 && (
          <div className="flex flex-col gap-1">
            {copiedTo(linked).map((origin) => <p key={origin} className="break-all text-ink-secondary">{t("orgJoin.copiedTo", { origin })}</p>)}
          </div>
        )}
      </div>
    </Card>
  );
}
