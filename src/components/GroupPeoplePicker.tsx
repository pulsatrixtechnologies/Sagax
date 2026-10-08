// The people picker of a group chat's "Gens" panel on an organization server:
// anyone active in the Perspicax directory, added by principal id. Joining a
// group lets a person read and post in its threads and talk to its bots
// there, never to those bots outside it.
import { useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { OrgDirectory } from "@/lib/perspicax-org";
import { groupPeopleCandidates } from "@/lib/private-threads";
import { PersonLabelTag } from "./LabelTag";

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

export function GroupPeoplePicker({ directory, taken, onAdd, onDone }: {
  directory: OrgDirectory | null;
  taken: readonly string[];
  onAdd: (principalId: string) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => groupPeopleCandidates(directory?.people ?? [], { taken, query }), [directory, taken, query]);
  return (
    <div data-group-people-picker className="mt-2 flex flex-col gap-2">
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onDone(); } }}
        placeholder={t("room.people.search")}
        aria-label={t("room.people.search")}
        maxLength={200}
        className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] placeholder:text-ink-secondary focus:outline-none"
      />
      {directory && candidates.length === 0 && <p className="px-1 text-[12px] text-ink-secondary">{t("room.people.none")}</p>}
      {candidates.length > 0 && (
        <ul className="flex flex-col divide-y divide-hairline/40 overflow-hidden rounded-xl bg-card">
          {candidates.map((person) => (
            <li key={person.principalId} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink"><span className="min-w-0 truncate">{person.name || person.login}</span><PersonLabelTag principalId={person.principalId} tone="surface" className="max-w-[46%] shrink" /></span>
                {person.name && person.login && <span className="block truncate text-[11.5px] text-ink-secondary">{person.login}</span>}
              </span>
              <button
                type="button"
                onClick={() => { onAdd(person.principalId.toLowerCase()); setQuery(""); }}
                className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-accent-ink hover:brightness-110"
              >
                <UserPlus size={12} />{t("room.people.add")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onDone} className="self-end rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
        {t("room.people.done")}
      </button>
    </div>
  );
}
