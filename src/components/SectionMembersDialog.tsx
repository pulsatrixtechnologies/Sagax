// "Members and sharing" of a sidebar section on a server signed in with
// Perspicax (slice 4, spec section 3): people and teams from the
// organization directory, a channel role each (moderator, participant, read
// only) and the section's default level on its bots (Talk or Run routines,
// never more). Saved in one PUT /api/org/sections/:id/members.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, UserMinus, UserPlus, Users } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { grantCandidates, type OrgDirectory, type OrgSection } from "@/lib/perspicax-org";

type Role = OrgSection["members"][number]["role"];
const ROLES: Role[] = ["moderator", "participant", "readonly"];

/** A member entry's label from the directory. */
export function memberLabel(target: string, directory: OrgDirectory | null): string {
  if (target.startsWith("team:")) return directory?.teams?.find((team) => team.id === target.slice(5))?.name ?? target.slice(5);
  const id = target.slice(5).toLowerCase();
  return directory?.people.find((person) => person.principalId.toLowerCase() === id)?.name ?? target.slice(5);
}

export function SectionMembersDialog({ section, onClose, onSaved }: { section: OrgSection; onClose: () => void; onSaved?: (section: OrgSection) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [directory, setDirectory] = useState<OrgDirectory | null>(null);
  const [members, setMembers] = useState(section.members);
  const [defaultLevel, setDefaultLevel] = useState<"use" | "run">(section.defaultLevel);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api<OrgDirectory>("/api/org/directory").then((body) => { if (alive) setDirectory({ people: body.people ?? [], teams: body.teams ?? [] }); }, () => { if (alive) setDirectory({ people: [], teams: [] }); });
    dialogRef.current?.focus();
    return () => { alive = false; };
  }, []);

  const candidates = useMemo(
    () => (query.trim() ? grantCandidates(directory, { ownerId: section.ownerPrincipalId, taken: members.map((member) => member.target), query }).slice(0, 20) : []),
    [directory, members, query, section.ownerPrincipalId],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = await api<{ section: OrgSection }>(`/api/org/sections/${section.id}/members`, { method: "PUT", body: JSON.stringify({ members, defaultLevel }) });
      onSaved?.(body.section);
      onClose();
    } catch {
      setError(t("sectionMembers.failed"));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="section-members-title" tabIndex={-1} data-section-members
        className="flex max-h-[90vh] w-full max-w-[520px] flex-col gap-3 overflow-y-auto rounded-2xl border border-hairline/50 bg-panel p-4 text-ink shadow-2xl outline-none"
        onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); } }}>
        <h2 id="section-members-title" className="text-[15px] font-semibold">{t("sectionMembers.title")} · {section.name}</h2>
        <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("sectionMembers.notice")}</p>
        {members.length === 0 ? (
          <p className="text-[13px] text-ink-secondary">{t("sectionMembers.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline/40">
            {members.map((member) => (
              <li key={member.target} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  {member.target.startsWith("team:") && <Users size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
                  <span className="truncate text-[13px]">{memberLabel(member.target, directory)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <select
                    value={member.role}
                    aria-label={`${t("sectionMembers.role")} · ${memberLabel(member.target, directory)}`}
                    onChange={(event) => setMembers((current) => current.map((entry) => entry.target === member.target ? { ...entry, role: event.target.value as Role } : entry))}
                    className="rounded-md border border-hairline/40 bg-inset px-2 py-1 text-[12px]"
                  >
                    {ROLES.map((role) => <option key={role} value={role}>{t(`sectionMembers.role.${role}`)}</option>)}
                  </select>
                  <button type="button" onClick={() => setMembers((current) => current.filter((entry) => entry.target !== member.target))}
                    className="flex items-center gap-1 rounded-md bg-control px-2 py-1 text-[12px] hover:bg-control/70">
                    <UserMinus size={12} />{t("botSettings.sharing.remove")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("botSettings.sharing.searchPeopleTeams")}
          aria-label={t("botSettings.sharing.searchPeopleTeams")}
          maxLength={200}
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
        />
        {candidates.length > 0 && (
          <ul className="flex flex-col divide-y divide-hairline/40">
            {candidates.map((candidate) => (
              <li key={candidate.target} className="flex min-w-0 items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  {candidate.kind === "team" && <Users size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
                  <span className="truncate text-[13px]">{candidate.label}</span>
                </span>
                <button type="button" onClick={() => { setMembers((current) => [...current, { target: candidate.target, role: "participant" }]); setQuery(""); }}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-accent-ink hover:brightness-110">
                  <UserPlus size={12} />{t("botSettings.sharing.add")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span>{t("sectionMembers.defaultLevel")}</span>
          <select value={defaultLevel} onChange={(event) => setDefaultLevel(event.target.value as "use" | "run")}
            className="rounded-md border border-hairline/40 bg-inset px-2 py-1 text-[12px]">
            <option value="use">{t("botSettings.sharing.level.use")}</option>
            <option value="run">{t("botSettings.sharing.level.run")}</option>
          </select>
        </label>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="ui-button" disabled={saving} onClick={onClose}>{t("myEngines.cancel")}</button>
          <button type="button" className="ui-button" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}{t("sectionMembers.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
