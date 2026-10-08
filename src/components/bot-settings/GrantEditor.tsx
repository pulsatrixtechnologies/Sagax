// A bot's grants on a server signed in with Perspicax (slice 4): people and
// teams, a level each (Talk, Run routines, Edit, Manage sharing), remove,
// and a picker to add. Levels above what the caller may give are omitted;
// the server decides (GET/PUT/DELETE /api/bots/:id/grants).
import { useEffect, useMemo, useState } from "react";
import { Loader2, UserMinus, UserPlus, Users } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import {
  GRANT_LEVELS,
  grantCandidates,
  levelAllowed,
  type GrantAdministration,
  type GrantLevel,
  type OrgDirectory,
  type WireGrant,
} from "@/lib/perspicax-org";
import { PresenceDot } from "../PresenceDot";

const LEVEL_KEY = {
  use: "botSettings.sharing.level.use",
  run: "botSettings.sharing.level.run",
  edit: "botSettings.sharing.level.edit",
  manage: "botSettings.sharing.level.manage",
} as const satisfies Record<GrantLevel, string>;

export function levelLabel(level: GrantLevel): string {
  return t(LEVEL_KEY[level]);
}

/** Whether this row may be changed by the caller (a manage grant only by
 * those who may give manage). */
export function grantEditable(grant: { level: GrantLevel }, administer: GrantAdministration | null): boolean {
  if (!administer) return false;
  return levelAllowed(grant.level, administer.maxLevel);
}

export function GrantEditor({ botId, ownerId, initialGrants, initialAdminister, directory }: {
  botId: string;
  ownerId?: string;
  initialGrants: WireGrant[];
  initialAdminister: GrantAdministration | null;
  directory: OrgDirectory | null;
}) {
  const [grants, setGrants] = useState<WireGrant[]>(initialGrants);
  const [administer, setAdminister] = useState<GrantAdministration | null>(initialAdminister);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ grants: WireGrant[]; administer: GrantAdministration }>(`/api/bots/${botId}/grants`)
      .then((body) => {
        if (!alive) return;
        setGrants(body.grants ?? []);
        setAdminister(body.administer ?? null);
      })
      .catch(() => { if (alive) setAdminister((current) => current?.any ? current : null); });
    return () => { alive = false; };
  }, [botId]);

  const candidates = useMemo(
    () => (query.trim() ? grantCandidates(directory, { ownerId, taken: grants.map((grant) => grant.target), query, administer }).slice(0, 20) : []),
    [directory, ownerId, grants, query, administer],
  );
  const canAdd = Boolean(administer && (administer.any || administer.canAdd !== false));

  const run = async (key: string, request: () => Promise<{ grants: WireGrant[] }>) => {
    setBusy(key);
    setError(null);
    try {
      const body = await request();
      setGrants(body.grants ?? []);
      setQuery("");
    } catch {
      setError(t("botSettings.sharing.failed"));
    } finally {
      setBusy(null);
    }
  };
  const put = (target: string, level: GrantLevel) => run(target, () => api(`/api/bots/${botId}/grants`, { method: "PUT", body: JSON.stringify({ target, level }) }));
  const remove = (target: string) => run(target, () => api(`/api/bots/${botId}/grants/${encodeURIComponent(target)}`, { method: "DELETE" }));
  const firstLevel: GrantLevel = "use";

  return (
    <div className="flex flex-col gap-3" data-grant-editor>
      {grants.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">{t("botSettings.sharing.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline/40" aria-label={t("botSettings.sharing.title")}>
          {grants.map((grant) => {
            const editable = grantEditable(grant, administer);
            return (
              <li key={grant.target} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2" data-grant={grant.target}>
                <div className="flex min-w-0 items-center gap-2">
                  {grant.kind === "team" && <Users size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
                  <span className="truncate text-[13px] text-ink">{grant.label}</span>
                  {grant.disabled && <span className="shrink-0 text-[11px] text-ink-secondary">{t("botSettings.sharing.disabled")}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {editable ? (
                    <select
                      value={grant.level}
                      aria-label={`${t("botSettings.sharing.level")} · ${grant.label}`}
                      disabled={busy !== null}
                      onChange={(event) => void put(grant.target, event.target.value as GrantLevel)}
                      className="rounded-md border border-hairline/40 bg-inset px-2 py-1 text-[12px] text-ink"
                    >
                      {GRANT_LEVELS.filter((level) => administer && levelAllowed(level, administer.maxLevel)).map((level) => (
                        <option key={level} value={level}>{levelLabel(level)}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[12px] text-ink-secondary">{levelLabel(grant.level)}</span>
                  )}
                  {editable && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void remove(grant.target)}
                      className="flex items-center gap-1 rounded-md bg-control px-2 py-1 text-[12px] text-ink hover:bg-control/70 disabled:opacity-50"
                    >
                      {busy === grant.target ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                      {t("botSettings.sharing.remove")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!administer ? (
        <p className="text-[12px] text-ink-secondary">{t("botSettings.sharing.ownerOnly")}</p>
      ) : !canAdd ? (
        <p className="text-[12px] text-ink-secondary">{t("botSettings.sharing.noAnchor")}</p>
      ) : directory !== null && directory.people.length === 0 && !(directory.teams ?? []).length ? (
        <p className="text-[12px] text-ink-secondary">{t("botSettings.sharing.noDirectory")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {!administer.any && <p className="text-[12px] text-ink-secondary">{t("botSettings.sharing.manager")}</p>}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("botSettings.sharing.search")}
            aria-label={t("botSettings.sharing.searchPeopleTeams")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          {query.trim() && candidates.length === 0 && <p className="text-[12px] text-ink-secondary">{t("botSettings.sharing.noMatch")}</p>}
          {candidates.length > 0 && (
            <ul className="flex flex-col divide-y divide-hairline/40">
              {candidates.map((candidate) => (
                <li key={candidate.target} className="flex min-w-0 items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {candidate.kind === "team"
                      ? <Users size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                      : <PresenceDot principalId={candidate.target.slice("user:".length)} className="shrink-0" ringClassName="border-card" sizeClassName="size-2.5" />}
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink">{candidate.label}</div>
                      <div className="truncate text-[12px] text-ink-secondary">
                        {candidate.kind === "team" ? `${t("botSettings.sharing.teams")} · ${t("botSettings.sharing.teamMembers", { count: candidate.count ?? 0 })}` : candidate.detail}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void put(candidate.target, firstLevel)}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50"
                  >
                    {busy === candidate.target ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                    {t("botSettings.sharing.add")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
