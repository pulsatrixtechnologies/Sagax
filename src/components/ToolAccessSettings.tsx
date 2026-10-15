import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { sortGrants, type ToolGrantRow } from "@/lib/tool-grants";
import { api } from "@/state/store";
import { Card } from "./SettingsPrimitives";

const STATE_KEY = {
  active: "settings.toolAccess.state.active",
  expired: "settings.toolAccess.state.expired",
  revoked: "settings.toolAccess.state.revoked",
} as const;

/** Settings > General > Advanced: the tool grants given to people (B3b).
 * A bot's own grants moved to its editor, under Permissions (JC 2026-10-15,
 * bot-settings/BotToolAccess.tsx). Sagax has no form for a person's grant
 * (they come through POST /api/tool-grants), so this card shows only when
 * some exist, for review and Revoke. Admins only; the server refuses
 * anyone else, and the card then stays away. */
export function PeopleToolAccessSettings() {
  const [rows, setRows] = useState<ToolGrantRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api<{ grants: ToolGrantRow[] }>("/api/tool-grants?kind=user");
      setRows(sortGrants(body.grants.filter((row) => row.subject.kind === "user")));
      setError("");
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const revoke = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await api(`/api/tool-grants/${encodeURIComponent(id)}/revoke`, { method: "POST", body: "{}" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolAccess.error"));
    } finally {
      setBusy(null);
    }
  };

  if (!rows?.length) return null;
  return (
    <Card
      collapsible
      cardId="general.peopleToolAccess"
      defaultOpen={false}
      title={t("settings.toolAccess.people.title")}
      subtitle={t("settings.toolAccess.people.subtitle")}
    >
      {error && <p className="mb-2 text-[13px] text-danger">{error}</p>}
      <ul className="flex flex-col gap-2" aria-label={t("settings.toolAccess.people.title")}>
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-hairline/40 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">{row.subject.id} · <code>{row.scope}</code></div>
              <div className="text-[12px] text-ink-secondary">
                {t(STATE_KEY[row.state])}
                {row.expiresAt && row.state === "active" ? ` · ${t("settings.toolAccess.expires", { date: new Date(row.expiresAt).toLocaleDateString() })}` : ""}
              </div>
            </div>
            {row.state === "active" && (
              <button type="button" className="rounded-md border border-hairline/40 px-2 py-1 text-[12px]" disabled={busy !== null} onClick={() => void revoke(row.id)}>
                {t("settings.toolAccess.revoke")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
