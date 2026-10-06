// Settings > Organization on a server signed in with Perspicax (slice 3):
// the link line, the viewer's role, and one link to the Perspicax console.
// Below that card: interim people, sharing, full access, plugin policy and,
// for admins, the server commands waiting for an admin.
// Slice 4 adds Sharing in the organization (the bots whose sharing the
// viewer administers; an admin can force-stop or force-delete any of them).
// Since 2026-10-01 a person's own engine sign-in (My engines) lives in
// Settings > Model providers, and "Bring bots from a solo Sagax" is hidden
// (the desktop's join flow still copies bots through POST /api/org/import).
// An admin also allows or refuses Full access for every bot (2026-10-01,
// OrgFullAccessPolicy, server/org-full-access.ts).
// People, teams and invitations live in Perspicax, never here.
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { t } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { Card } from "./SettingsPrimitives";
import { OrgSharing } from "./settings/OrgSharing";
import { InterimPeople } from "./settings/InterimPeople";

import { OrgPluginPolicy } from "./settings/OrgPluginPolicy";
import { OrgFullAccessPolicy } from "./settings/OrgFullAccessPolicy";

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
  const [approvals, setApprovals] = useState<PendingAdminApproval[] | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const interim = org.settings.interimAttach;
  const [interimShown, setInterimShown] = useState(false);
  const interimVisible = showInterimCard(admin, interim, interimShown);
  useEffect(() => { if (interimVisible) setInterimShown(true); }, [interimVisible]);

  const loadApprovals = async () => {
    if (!admin) return;
    try {
      setApprovals((await api<{ approvals: PendingAdminApproval[] }>("/api/org/approvals")).approvals ?? []);
    } catch {
      setApprovals([]);
    }
  };
  useEffect(() => { void loadApprovals(); }, [admin]);

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
        </div>
      </Card>
      {interimVisible && interim?.until ? <InterimPeople until={interim.until} onChanged={onChanged} /> : null}
      <OrgSharing admin={admin} />
      {admin && <OrgFullAccessPolicy initial={org.settings.allowFullAccess !== false} onChanged={onChanged} />}
      {admin && (
        <OrgPluginPolicy
          marketplaces={org.settings.pluginMarketplaces ?? { mode: "any" }}
          github={org.settings.github ?? { clientId: null, fromEnvironment: false }}
          tokens={org.settings.githubTokens ?? []}
          tokensUnavailable={org.settings.githubTokensUnavailable === true}
          onChanged={onChanged}
        />
      )}
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
