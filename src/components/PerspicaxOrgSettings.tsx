// Settings > Organization on a server signed in with Perspicax (slice 3):
// the link to Perspicax and its last directory sync, the viewer's role, a
// link to manage people in the Perspicax console, and, for admins, the
// organization key switch and the server commands waiting for an admin.
// Slice 4 adds My engines (for everyone) and Sharing in the organization
// (the bots whose sharing the viewer administers); slice 6 adds Routines in
// my name (the routine delegation).
// People, teams and invitations live in Perspicax, never here.
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";
import { api, useStore } from "@/state/store";
import { Card } from "./SettingsPrimitives";
import { MyEngines } from "./settings/MyEngines";
import { MyRoutineDelegation } from "./settings/MyRoutineDelegation";
import { MyServerEnvironment } from "./settings/MyServerEnvironment";
import { OrgSharing } from "./settings/OrgSharing";
import { OrgImportDialog } from "./OrgImportDialog";
import { InterimPeople } from "./settings/InterimPeople";

interface PendingAdminApproval {
  botId: string;
  botName: string;
  threadId: string;
  requestId: string;
  tool?: string;
  summary?: string;
  at: number;
}

/** `<issuer>/console/`, the Perspicax console. */
export function perspicaxConsoleUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/console/`;
}

export function linkStateLine(link: PerspicaxOrg["link"]): string {
  if (link.state === "ok") return t("organization.link.ok");
  if (link.state === "missing") return t("organization.link.missing");
  return t("organization.link.error", { error: link.error ?? "error" });
}

/** Whether the "People from before Perspicax" card shows: while the window
 * is open and someone is left, and also once the last one is attached in
 * this view, so the admin still sees the "Attached to" notice. */
export function showInterimCard(admin: boolean, interim: PerspicaxOrg["settings"]["interimAttach"], shownBefore: boolean): boolean {
  return admin && Boolean(interim?.until) && ((interim?.people ?? 0) > 0 || shownBefore);
}

export function PerspicaxOrgSettings({ org, onChanged }: { org: PerspicaxOrg; onChanged: () => void | Promise<void> }) {
  const admin = org.viewerRole === "admin";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [approvals, setApprovals] = useState<PendingAdminApproval[] | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const interim = org.settings.interimAttach;
  const [interimShown, setInterimShown] = useState(false);
  const interimVisible = showInterimCard(admin, interim, interimShown);
  useEffect(() => { if (interimVisible) setInterimShown(true); }, [interimVisible]);
  const { state: store } = useStore();
  const canCreateBots = store.config?.viewer?.canCreateBots !== false;

  const loadApprovals = async () => {
    if (!admin) return;
    try {
      setApprovals((await api<{ approvals: PendingAdminApproval[] }>("/api/org/approvals")).approvals ?? []);
    } catch {
      setApprovals([]);
    }
  };
  useEffect(() => { void loadApprovals(); }, [admin]);

  const synced = org.link.syncedAt
    ? new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(org.link.syncedAt))
    : null;

  const toggleOrgKey = async (next: boolean) => {
    setSaving(true);
    setError("");
    try {
      await api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ memberBotsUseOrgKey: next }) });
      await onChanged();
    } catch {
      setError(t("organization.orgKey.failed"));
    } finally {
      setSaving(false);
    }
  };

  const answer = async (approval: PendingAdminApproval, behavior: "allow" | "deny") => {
    setAnswering(approval.requestId);
    try {
      await api(`/api/threads/${approval.threadId}/respond`, {
        method: "POST",
        body: JSON.stringify({ requestId: approval.requestId, behavior, ...(behavior === "deny" ? { message: "Denied by an admin." } : {}) }),
      });
    } catch {
      /* the list below says what is still waiting */
    } finally {
      setAnswering(null);
      await loadApprovals();
    }
  };

  return (
    <>
      <Card cardId="organization.perspicax" title={org.org.name} summary={linkStateLine(org.link)}>
        <div className="flex flex-col gap-3 text-[13px]" data-perspicax-org>
          <p role="status" className={org.link.state === "ok" ? "text-ink" : "text-warning"}>{linkStateLine(org.link)}</p>
          {synced && <p className="text-[12px] text-ink-secondary">{t("organization.link.lastSync", { time: synced })}</p>}
          <p className="text-ink-secondary">{admin ? t("organization.role.admin") : t("organization.role.member")}</p>
          <a
            href={perspicaxConsoleUrl(org.org.identity.issuer)}
            target="_blank"
            rel="noreferrer noopener"
            className="ui-button flex w-fit items-center gap-1.5"
          >
            <ExternalLink size={13} aria-hidden="true" />
            {t("organization.manageInPerspicax")}
          </a>
          {admin && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-hairline/40 p-3">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={org.settings.memberBotsUseOrgKey}
                disabled={saving}
                onChange={(event) => void toggleOrgKey(event.target.checked)}
              />
              <span className="flex flex-col gap-1">
                <span className="text-ink">{t("organization.orgKey.label")}</span>
                <span className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.orgKey.help")}</span>
              </span>
            </label>
          )}
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        </div>
      </Card>
      {canCreateBots && (
        <Card cardId="organization.orgImport" title={t("orgImport.title")} summary={t("orgImport.summary")}>
          <div className="flex flex-col gap-2 text-[13px]">
            <p className="text-ink-secondary">{t("orgImport.intro")}</p>
            <button type="button" className="ui-button w-fit" onClick={() => setImporting(true)}>{t("orgImport.choose")}</button>
          </div>
        </Card>
      )}
      {importing && <OrgImportDialog onClose={() => setImporting(false)} />}
      {interimVisible && interim?.until ? <InterimPeople until={interim.until} onChanged={onChanged} /> : null}
      <MyEngines issuer={org.org.identity.issuer} />
      <MyRoutineDelegation />
      <MyServerEnvironment />
      <OrgSharing />
      {admin && (
        <Card cardId="organization.adminApprovals" title={t("organization.adminApprovals.title")} summary={approvals?.length ? String(approvals.length) : ""}>
          {!approvals?.length ? (
            <p className="text-[13px] text-ink-secondary">{t("organization.adminApprovals.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-hairline/40">
              {approvals.map((approval) => (
                <li key={`${approval.threadId}:${approval.requestId}`} className="flex min-w-0 flex-col gap-2 py-2">
                  <div className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] text-ink">{approval.botName}</span>
                    {approval.tool && <span className="shrink-0 font-mono text-[11px] text-ink-secondary">{approval.tool}</span>}
                  </div>
                  {approval.summary && (
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12px] text-ink">{approval.summary}</pre>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ui-button text-danger" disabled={answering !== null} onClick={() => void answer(approval, "deny")}>
                      {t("organization.adminApprovals.deny")}
                    </button>
                    <button type="button" className="ui-button" disabled={answering !== null} onClick={() => void answer(approval, "allow")}>
                      {t("organization.adminApprovals.allow")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
