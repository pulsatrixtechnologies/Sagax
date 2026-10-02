// Settings > Organization > Sharing in the organization (slice 4): the bots
// whose sharing the viewer administers (an admin: every bot; a team
// manager: bots shared with their teams or members; anyone: bots they own or
// manage), their owner and grants, never their messages. Each opens the
// same grant editor as the bot's own Sharing section. An organization admin
// also gets "Forcer l'arrêt" and "Forcer la suppression" on every bot
// (server/org-bot-force.ts decides; the owner is notified).
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Square, Trash2 } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { OrgDirectory, WireGrant } from "@/lib/perspicax-org";
import { GrantEditor, levelLabel } from "../bot-settings/GrantEditor";
import { Card } from "../SettingsPrimitives";
import { ConfirmDialog } from "../ConfirmDialog";

export interface OrgBot {
  id: string;
  name: string;
  ownerPrincipalId: string;
  ownerName: string;
  section?: string;
  engine: { instanceId: string; driver: string };
  grants: WireGrant[];
}

/** One line per grant: "Team T (Talk), Bob (Run routines)". */
export function grantsSummary(grants: WireGrant[]): string {
  return grants.map((grant) => `${grant.label} (${levelLabel(grant.level)})`).join(", ");
}

/** Ask the server to force-stop a bot (organization admin only). */
export function forceStopOrgBot(botId: string): Promise<unknown> {
  return api(`/api/org/bots/${encodeURIComponent(botId)}/force-stop`, { method: "POST", body: "{}" });
}

/** Ask the server to force-delete a bot; it checks the name matches. */
export function forceDeleteOrgBot(bot: Pick<OrgBot, "id" | "name">): Promise<unknown> {
  return api(`/api/org/bots/${encodeURIComponent(bot.id)}/force-delete`, { method: "POST", body: JSON.stringify({ confirm: bot.name }) });
}

export function OrgSharing({ initial = null, admin = false }: { initial?: OrgBot[] | null; admin?: boolean }) {
  const [bots, setBots] = useState<OrgBot[] | null>(initial);
  const [directory, setDirectory] = useState<OrgDirectory | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OrgBot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const stop = async (bot: OrgBot) => {
    setBusy(bot.id);
    setNotice(null);
    try {
      await forceStopOrgBot(bot.id);
      setNotice({ ok: true, text: t("organization.sharing.forceStop.done", { name: bot.name }) });
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : t("organization.sharing.force.failed") });
    } finally {
      setBusy(null);
    }
  };
  const remove = async (bot: OrgBot) => {
    setBusy(bot.id);
    setNotice(null);
    try {
      await forceDeleteOrgBot(bot);
      setBots((current) => current?.filter((entry) => entry.id !== bot.id) ?? current);
      setNotice({ ok: true, text: t("organization.sharing.forceDelete.done", { name: bot.name }) });
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : t("organization.sharing.force.failed") });
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  };

  useEffect(() => {
    let alive = true;
    void api<{ bots: OrgBot[] }>("/api/org/bots").then((body) => { if (alive) setBots(body.bots ?? []); }, () => { if (alive) setBots([]); });
    void api<OrgDirectory>("/api/org/directory").then((body) => { if (alive) setDirectory({ people: body.people ?? [], teams: body.teams ?? [] }); }, () => {});
    return () => { alive = false; };
  }, []);

  if (bots !== null && bots.length === 0) return null;
  return (
    <Card cardId="organization.sharing" title={t("organization.sharing.title")}>
      {bots === null ? null : (
        <ul className="flex flex-col divide-y divide-hairline/40" data-org-sharing>
          {bots.map((bot) => (
            <li key={bot.id} className="flex min-w-0 flex-col gap-2 py-2">
              <button
                type="button"
                aria-expanded={open === bot.id}
                onClick={() => setOpen(open === bot.id ? null : bot.id)}
                className="flex min-w-0 items-start gap-2 text-left"
              >
                {open === bot.id ? <ChevronDown size={14} className="mt-0.5 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" />}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] text-ink">{bot.name}</span>
                  <span className="truncate text-[12px] text-ink-secondary">
                    {t("organization.sharing.owner", { name: bot.ownerName || bot.ownerPrincipalId })}
                    {bot.section ? ` · ${bot.section}` : ""}
                  </span>
                  <span className="break-words text-[12px] text-ink-secondary">{bot.grants.length ? grantsSummary(bot.grants) : t("botSettings.sharing.empty")}</span>
                </span>
              </button>
              {admin && (
                <div className="flex flex-wrap gap-2 pl-5" data-org-bot-force={bot.id}>
                  <button type="button" className="ui-button flex items-center gap-1.5" disabled={busy !== null} onClick={() => void stop(bot)}>
                    <Square size={12} aria-hidden="true" />
                    {t("organization.sharing.forceStop")}
                  </button>
                  <button type="button" className="ui-button flex items-center gap-1.5 text-danger" disabled={busy !== null} onClick={() => setDeleting(bot)}>
                    <Trash2 size={12} aria-hidden="true" />
                    {t("organization.sharing.forceDelete")}
                  </button>
                </div>
              )}
              {open === bot.id && (
                <GrantEditor botId={bot.id} ownerId={bot.ownerPrincipalId} initialGrants={bot.grants} initialAdminister={null} directory={directory} />
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "mt-2 text-[12px] text-ink" : "mt-2 text-[12px] text-danger"}>{notice.text}</p>}
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t("organization.sharing.forceDelete.title", { name: deleting?.name ?? "" })}
        body={t("organization.sharing.forceDelete.body", { name: deleting?.name ?? "", owner: deleting ? deleting.ownerName || deleting.ownerPrincipalId : "" })}
        confirmLabel={t("organization.sharing.forceDelete")}
        pending={deleting !== null && busy === deleting.id}
        onCancel={() => setDeleting(null)}
        onConfirm={() => { if (deleting) void remove(deleting); }}
      />
    </Card>
  );
}
