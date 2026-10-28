// The people picker of a group chat's People section: an inline search, an
// Add on each row, then Done (#1260). On an organization server the rows are
// active Perspicax people, added by principal id. Off that server the same
// gesture takes an email address. Joining a group lets a person read and
// post in its threads and talk to its bots there, never to those bots outside it.
import { useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { OrgDirectory } from "@/lib/perspicax-org";
import { groupPeopleCandidates } from "@/lib/private-threads";
import { PersonLabelTag } from "./LabelTag";
import { PresenceDot } from "./PresenceDot";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The organization directory, once `enabled`; null until it answers. */
export function useOrgDirectory(enabled: boolean): OrgDirectory | null {
  const [directory, setDirectory] = useState<OrgDirectory | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void api<OrgDirectory>("/api/org/directory").then(
      (body) => { if (alive) setDirectory({ people: body.people ?? [], teams: body.teams ?? [] }); },
      () => { if (alive) setDirectory({ people: [], teams: [] }); },
    );
    return () => { alive = false; };
  }, [enabled]);
  return directory;
}

export function GroupPeoplePicker({ directory, taken, onAdd, onDone, organization = true, showDone = true, autoFocus = true }: {
  directory: OrgDirectory | null;
  taken: readonly string[];
  onAdd: (principalId: string) => void;
  onDone: () => void;
  /** False off an organization server: add by email instead of the directory. */
  organization?: boolean;
  /** Hidden when one Done below covers people and bots together. */
  showDone?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const takenNorm = useMemo(() => taken.map((id) => id.trim().toLowerCase()), [taken]);
  const candidates = useMemo(
    () => (organization ? groupPeopleCandidates(directory?.people ?? [], { taken, query }) : []),
    [organization, directory, taken, query],
  );
  const email = query.trim().toLowerCase();
  const emailAddable = !organization && EMAIL.test(email) && !takenNorm.includes(email);
  const finish = () => onDone();
  return (
    <div data-group-people-picker className="mt-2 flex flex-col gap-2">
      <input
        type="search"
        autoFocus={autoFocus}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); finish(); }
          if (event.key === "Enter" && emailAddable) { event.preventDefault(); onAdd(email); setQuery(""); }
        }}
        placeholder={organization ? t("room.people.search") : t("manageMembers.emailPlaceholder")}
        aria-label={organization ? t("room.people.search") : t("manageMembers.emailPlaceholder")}
        maxLength={200}
        className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] placeholder:text-ink-secondary focus:outline-none"
      />
      {organization && directory && candidates.length === 0 && <p className="px-1 text-[12px] text-ink-secondary">{t("room.people.none")}</p>}
      {(candidates.length > 0 || emailAddable) && (
        <ul className="flex flex-col divide-y divide-hairline/40 overflow-hidden rounded-xl bg-card">
          {candidates.map((person) => (
            <li key={person.principalId} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
              <PresenceDot principalId={person.principalId} className="shrink-0" ringClassName="border-card" sizeClassName="size-2.5" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink"><span className="min-w-0 truncate">{person.name || person.login}</span><PersonLabelTag principalId={person.principalId} tone="surface" className="max-w-[46%] shrink" /></span>
                {person.name && person.login && <span className="block truncate text-[11.5px] text-ink-secondary">{person.login}</span>}
              </span>
              <button
                type="button"
                data-add-person={person.principalId}
                onClick={() => { onAdd(person.principalId.toLowerCase()); setQuery(""); }}
                className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-accent-ink hover:brightness-110"
              >
                <UserPlus size={12} />{t("room.people.add")}
              </button>
            </li>
          ))}
          {emailAddable && (
            <li className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{email}</span>
              <button
                type="button"
                data-add-person={email}
                onClick={() => { onAdd(email); setQuery(""); }}
                className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-accent-ink hover:brightness-110"
              >
                <UserPlus size={12} />{t("room.people.add")}
              </button>
            </li>
          )}
        </ul>
      )}
      {showDone && (
        <button type="button" data-roster-done="" onClick={finish} className="self-end rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
          {t("room.people.done")}
        </button>
      )}
    </div>
  );
}
