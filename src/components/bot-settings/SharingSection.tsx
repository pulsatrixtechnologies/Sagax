// Who this bot is shared with, on a server signed in with Perspicax (slice
// 3): its owner adds people from the organization directory and removes
// them. The grants are the gate there (VisibilitySection is hidden): a
// person added sees the bot, its conversations and can write to it; removing
// them narrows their lists and live updates at once (server side).
import { useEffect, useMemo, useState } from "react";
import { Loader2, UserMinus, UserPlus } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { sharePickerPeople, type OrgDirectoryPerson } from "@/lib/perspicax-org";

export function SharingSection({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const viewerId = state.config?.viewer?.principalId ?? null;
  const isOwner = Boolean(viewerId && bot.ownerUserId && viewerId.toLowerCase() === bot.ownerUserId.toLowerCase());
  const [people, setPeople] = useState<OrgDirectoryPerson[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grants = bot.directGrants ?? [];

  useEffect(() => {
    let alive = true;
    void api<{ people: OrgDirectoryPerson[] }>("/api/org/directory")
      .then((body) => { if (alive) setPeople(body.people ?? []); })
      .catch(() => { if (alive) setPeople([]); });
    return () => { alive = false; };
  }, [bot.id]);

  const byId = useMemo(() => new Map((people ?? []).map((person) => [person.principalId.toLowerCase(), person])), [people]);
  const candidates = useMemo(
    () => sharePickerPeople(people ?? [], { ownerId: bot.ownerUserId, grants, query }).slice(0, 20),
    [people, bot.ownerUserId, grants, query],
  );

  const change = async (method: "POST" | "DELETE", principalId: string) => {
    setBusy(principalId);
    setError(null);
    try {
      if (method === "POST") {
        await api(`/api/bots/${bot.id}/direct-grants`, { method, body: JSON.stringify({ userId: principalId }) });
        setQuery("");
      } else {
        await api(`/api/bots/${bot.id}/direct-grants/${encodeURIComponent(principalId)}`, { method });
      }
    } catch {
      setError(t("botSettings.sharing.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline/40 p-4" data-bot-sharing>
      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("botSettings.sharing.notice")}</p>
      {grants.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">{t("botSettings.sharing.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline/40" aria-label={t("botSettings.sharing.title")}>
          {grants.map((id) => {
            const person = byId.get(id.toLowerCase());
            return (
              <li key={id} className="flex min-w-0 items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-ink">{person?.name ?? id}</div>
                  {person && <div className="truncate text-[12px] text-ink-secondary">{person.login}{person.email ? ` · ${person.email}` : ""}</div>}
                </div>
                {isOwner && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void change("DELETE", id)}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-control px-2 py-1 text-[12px] text-ink hover:bg-control/70 disabled:opacity-50"
                  >
                    {busy === id ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                    {t("botSettings.sharing.remove")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!isOwner ? (
        <p className="text-[12px] text-ink-secondary">{t("botSettings.sharing.ownerOnly")}</p>
      ) : people !== null && people.length === 0 ? (
        <p className="text-[12px] text-ink-secondary">{t("botSettings.sharing.noDirectory")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("botSettings.sharing.search")}
            aria-label={t("botSettings.sharing.search")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />
          {query.trim() && candidates.length === 0 && <p className="text-[12px] text-ink-secondary">{t("botSettings.sharing.noMatch")}</p>}
          {query.trim() && candidates.length > 0 && (
            <ul className="flex flex-col divide-y divide-hairline/40">
              {candidates.map((person) => (
                <li key={person.principalId} className="flex min-w-0 items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-ink">{person.name}</div>
                    <div className="truncate text-[12px] text-ink-secondary">{person.login}{person.email ? ` · ${person.email}` : ""}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void change("POST", person.principalId)}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50"
                  >
                    {busy === person.principalId ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
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
