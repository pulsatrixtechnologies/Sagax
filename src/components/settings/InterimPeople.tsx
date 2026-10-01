// Settings > Organization, admins only (slice 8): "People from before
// Perspicax". Each interim person (known by an address on this server) is
// attached by an admin to the Perspicax person who is them; a matching
// address is only a suggestion, never an automatic attach.
import { useEffect, useState } from "react";

import { activeLocale, t } from "@/lib/i18n";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { Card } from "../SettingsPrimitives";

export interface InterimPerson {
  principalId: string;
  email: string;
  bots: number;
  rooms: number;
  routines: number;
  suggested: { principalId: string; name: string; login: string } | null;
}

/** The people an interim person may be attached to: active, by name. */
export function attachCandidates(people: readonly OrgDirectoryPerson[]): OrgDirectoryPerson[] {
  return people.filter((person) => !person.disabled).sort((a, b) => a.name.localeCompare(b.name) || a.login.localeCompare(b.login));
}

export function InterimPeople({ until, onChanged }: { until: number; onChanged: () => void | Promise<void> }) {
  const [people, setPeople] = useState<InterimPerson[] | null>(null);
  const [directory, setDirectory] = useState<OrgDirectoryPerson[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [interim, dir] = await Promise.all([
        api<{ people: InterimPerson[] }>("/api/org/interim-people"),
        api<{ people?: OrgDirectoryPerson[] }>("/api/org/directory"),
      ]);
      setPeople(interim.people ?? []);
      setDirectory(attachCandidates(dir.people ?? []));
    } catch {
      setPeople([]);
    }
  };
  useEffect(() => { void load(); }, []);

  const targetOf = (person: InterimPerson) => picked[person.principalId] ?? person.suggested?.principalId ?? "";
  const nameOf = (principalId: string) => directory.find((entry) => entry.principalId === principalId)?.name ?? principalId;
  const attach = async (person: InterimPerson) => {
    const to = targetOf(person);
    setBusy(true);
    setError("");
    try {
      await api("/api/org/interim-people/attach", { method: "POST", body: JSON.stringify({ interimPrincipalId: person.principalId, principalId: to }) });
      setNotice(t("interim.attached", { name: nameOf(to) }));
      setConfirming(null);
      await load();
      await onChanged();
    } catch {
      setError(t("interim.failed"));
    } finally {
      setBusy(false);
    }
  };
  const closeNow = async () => {
    setBusy(true);
    try {
      await api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ interimAttachDays: 0 }) });
      await onChanged();
    } catch {
      setError(t("interim.failed"));
    } finally {
      setBusy(false);
    }
  };

  const date = new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium" }).format(new Date(until));
  return (
    <Card cardId="organization.interimPeople" title={t("interim.title")} summary={people ? String(people.length) : ""}>
      <div className="flex flex-col gap-3 text-[13px]" data-interim-people>
        <p className="leading-relaxed text-ink-secondary">{t("interim.intro")}</p>
        <p className="text-ink-secondary">{t("interim.until", { date })}</p>
        <ul className="flex flex-col divide-y divide-hairline/40">
          {(people ?? []).map((person) => {
            const target = targetOf(person);
            return (
              <li key={person.principalId} className="flex min-w-0 flex-col gap-2 py-2">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 break-all text-ink">{person.email}</span>
                  <span className="text-[12px] text-ink-secondary">{t("interim.counts", { bots: person.bots, rooms: person.rooms, routines: person.routines })}</span>
                </div>
                {confirming === person.principalId ? (
                  <div role="group" aria-label={t("interim.attach")} className="flex flex-col gap-2 rounded-lg border border-hairline/40 p-3">
                    <p className="text-ink">{t("interim.confirm", { from: person.email, to: nameOf(target) })}</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="ui-button" autoFocus disabled={busy} onClick={() => setConfirming(null)}>{t("interim.cancel")}</button>
                      <button type="button" className="ui-button text-danger" disabled={busy} onClick={() => void attach(person)}>{t("interim.attach")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-ink-secondary">
                      <span className="shrink-0">{t("interim.pick")}</span>
                      <select className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-ink" value={target} disabled={busy}
                        onChange={(event) => setPicked((current) => ({ ...current, [person.principalId]: event.target.value }))}>
                        <option value="">{t("interim.choose")}</option>
                        {directory.map((entry) => <option key={entry.principalId} value={entry.principalId}>{entry.name} ({entry.login})</option>)}
                      </select>
                    </label>
                    <button type="button" className="ui-button" disabled={busy || !target} onClick={() => setConfirming(person.principalId)}>{t("interim.attach")}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {notice && <p role="status" className="text-ink">{notice}</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        <button type="button" className="ui-button w-fit" disabled={busy} onClick={() => void closeNow()}>{t("interim.closeNow")}</button>
      </div>
    </Card>
  );
}
