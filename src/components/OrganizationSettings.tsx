import { useEffect, useRef, useState } from "react";
import type { ManagedDesktopState } from "../../electron/managed-desktop.mjs";
import { activeLocale, t } from "@/lib/i18n";
import { enterpriseEntryRequested } from "@/lib/enterprise-entry";
import { api, ApiError, useStore } from "@/state/store";
import { Card } from "./SettingsPrimitives";
import { CompanyModels } from "./CompanyModels";
import { ConnectedWorkspacesSettings } from "./ConnectedWorkspacesSettings";
import { RemoteComputerSection } from "./RemoteComputerSection";
import { CustomDomainSettings } from "./CustomDomainSettings";
import { PerspicaxOrgSettings } from "./PerspicaxOrgSettings";
import { JoinPerspicaxCard } from "./JoinPerspicaxCard";
import { OrgDirectory, type OrgPersonView, type PendingInviteView } from "./OrgDirectory";
import type { OrgRole } from "../../server/org-directory.ts";
import { isPerspicaxOrg, type PerspicaxOrg } from "@/lib/perspicax-org";
import { ServerModeComputerAccess } from "./ServerModeSettings";

const providerNames: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter" };
// No hosted Admin: the original project's hosted Admin portal is never
// offered. An organization enters its own portal's address.
const PORTAL_PLACEHOLDER = "https://admin.example.com";

type ServerInvites = { org: { name: string }; people: OrgPersonView[]; pendingInvites: PendingInviteView[]; viewerRole?: OrgRole | null };

/** A solo server's invitations to its own sign-in list (GET /api/org/invites,
 * admin only): invite by email, the people who may sign in, and the
 * pending links. Not an organization: nothing to create or move. Renders
 * nothing where the route is refused (a member, an organization server). */
function ServerInvitesDirectory() {
  const [data, setData] = useState<ServerInvites | null>(null);
  const [lastInvite, setLastInvite] = useState<{ email: string; link?: string } | null>(null);
  const [error, setError] = useState("");
  const load = async (alive = () => true) => {
    try {
      const body = await api<ServerInvites>("/api/org/invites");
      if (alive()) setData({ org: { name: body.org?.name ?? "" }, people: body.people ?? [], pendingInvites: body.pendingInvites ?? [], viewerRole: body.viewerRole });
    } catch {
      if (alive()) setData(null);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  const canManage = data.viewerRole === undefined || data.viewerRole === "owner" || data.viewerRole === "admin";
  if (!canManage) return null;
  return (
    <>
      <OrgDirectory
        org={{ name: data.org.name }}
        people={data.people}
        pendingInvites={data.pendingInvites}
        canManage
        lastInvite={lastInvite}
        onCreate={() => {}}
        onInvite={async (email) => {
          try {
            const issued = await api<{ invite?: { email?: string }; link?: string }>("/api/org/invites", { method: "POST", body: JSON.stringify({ email }) });
            setLastInvite({ email: issued.invite?.email ?? email, link: issued.link });
            setError("");
            await load();
          } catch (cause) {
            setError(t("org.inviteFailed"));
            throw cause;
          }
        }}
        onRevoke={async (token) => {
          try {
            await api(`/api/org/invites/${encodeURIComponent(token)}/revoke`, { method: "POST", body: "{}" });
            setLastInvite((current) => (current?.link?.endsWith(`token=${encodeURIComponent(token)}`) ? null : current));
            await load();
          } catch {
            setError(t("org.revokeFailed"));
          }
        }}
      />
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </>
  );
}

/** Only the trusted desktop bridge can enroll this computer or hold its token. */
export function OrganizationSettings() {
  const { state: store } = useStore();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  const bridge = remoteActive ? undefined : window.ogb?.organization;
  const [connection, setConnection] = useState<ManagedDesktopState | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const revision = useRef(0);
  const status = useRef<ManagedDesktopState["status"] | undefined>(undefined);
  const [orgReady, setOrgReady] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [servers, setServers] = useState<{ activeId: string; count: number } | null>(null);
  // A server signed in with Perspicax: its own organization view.
  const [perspicaxOrg, setPerspicaxOrg] = useState<PerspicaxOrg | null>(null);

  const acceptConnection = (next: ManagedDesktopState) => {
    const changed = status.current !== next.status;
    status.current = next.status;
    setConnection(next);
    // Heartbeats republish every minute; keep an action error visible until
    // the connection actually changes state. Keep this outside React's state
    // updater: updaters must stay pure and can run during rendering.
    if (changed) setError("");
    if (next.status !== "connected" && next.status !== "reauth-required") setConfirmDisconnect(false);
  };

  useEffect(() => {
    // This acknowledges only the rendered destination, never enrollment.
    // Failure leaves the native restart intent available on the next launch.
    void bridge?.settingsOpened?.().catch(() => {});
    const current = ++generation.current;
    const initialRevision = revision.current;
    const receive = (next: ManagedDesktopState) => {
      if (generation.current !== current) return;
      revision.current++;
      acceptConnection(next);
    };
    const unsubscribe = bridge?.onState(receive);
    void bridge?.state().then((next) => {
      // A push can arrive while the initial snapshot is in flight.
      if (revision.current === initialRevision) receive(next);
    }).catch(() => {
      if (generation.current === current && revision.current === initialRevision) setError(t("organization.loadFailed"));
    });
    return () => { generation.current++; unsubscribe?.(); };
  }, [bridge]);

  // GET /api/org answers the Perspicax organization on an organization
  // server; a solo server has none (404).
  const loadOrg = async (alive = () => true) => {
    try {
      const body = await api<unknown>("/api/org");
      if (!alive()) return;
      if (isPerspicaxOrg(body)) setPerspicaxOrg(body);
      setOrgReady(true);
      setDirectoryError("");
    } catch (error) {
      if (!alive()) return;
      if (error instanceof ApiError && error.status === 404) {
        setOrgReady(true);
        setDirectoryError("");
        return;
      }
      setDirectoryError(t("org.loadFailed"));
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadOrg(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Whether this desktop has already joined (or is currently active on)
    // another server decides whether Organization shows a bare join card or
    // the connected server list next to it.
    let cancelled = false;
    void Promise.resolve(window.ogb?.environments?.state()).then((next) => {
      if (next && !cancelled) setServers({ activeId: next.activeId, count: next.environments.length });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const perform = async (action: () => Promise<ManagedDesktopState>) => {
    if (!bridge || pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    const current = generation.current;
    const startedRevision = revision.current;
    try {
      const next = await action();
      if (generation.current === current && revision.current === startedRevision) {
        acceptConnection(next);
      }
    } catch {
      // IPC exceptions can contain internal paths; display only product copy.
      if (generation.current === current && revision.current === startedRevision) setError(t("organization.actionFailed"));
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  };

  // Already active on (or saved) another server: show the connected/joined
  // server list next to Organization.
  const connectedToAnotherServer = remoteActive || (servers ? servers.activeId !== "local" : false);
  const hasSavedServers = (servers?.count ?? 0) > 0;
  const showJoinOnly = !hasSavedServers && !connectedToAnotherServer;

  // Server mode: this person's own computer for the organization's bots.
  if (perspicaxOrg) return <>
    <PerspicaxOrgSettings org={perspicaxOrg} onChanged={() => loadOrg()} />
    <ServerModeComputerAccess />
  </>;

  const directory = (
    <>
      {orgReady && !remoteActive && <ServerInvitesDirectory />}
      {orgReady && !remoteActive && store.config?.viewer?.operator !== false && <CustomDomainSettings />}
      {directoryError && <p role="alert" className="text-[13px] text-danger">{directoryError}</p>}
    </>
  );

  // No server joined yet: the join card.
  // Otherwise, show the servers this desktop already connects to (switch,
  // leave, or the active remote-client connection and its disconnect action).
  // Waits for the organization load so it settles into one shape instead of
  // swapping components once the load resolves.
  const joinOrConnect = !orgReady ? null : showJoinOnly
    ? <>
        <JoinPerspicaxCard />
        <RemoteComputerSection />
      </>
    : <>
        {!remoteActive && <JoinPerspicaxCard />}
        <ConnectedWorkspacesSettings />
        {remoteActive && <RemoteComputerSection />}
      </>;
  // The enterprise Admin connection is shown only where it is in use: a
  // connection exists (any state but signed out), the app is managed, or the
  // native "Sign in with your organization" entry asked for it.
  const enterpriseInUse = connection !== null && (connection.status !== "signed-out" || connection.notice === "license-expired");
  const showEnterprise = Boolean(bridge) && (enterpriseInUse || Boolean(store.config?.managedPolicy) || enterpriseEntryRequested());
  if (!bridge || !showEnterprise) return <>
    {joinOrConnect}
    {directory}
  </>;
  // Unavailable can still hold a saved grant; let the person clear it before
  // reconnecting even while the Admin portal or local runtime is offline.
  const enrolled = connection?.status === "connected" || connection?.status === "reauth-required" || connection?.status === "unavailable" || connection?.status === "license-expired";
  // A lapsed Admin licence is the organisation's billing matter, not a sign-in
  // problem: say so, keep the connection, and offer no reconnect loop.
  const licenseExpired = connection?.status === "license-expired" || connection?.notice === "license-expired";
  const expiry = connection?.enrollment?.expiresAt ?? connection?.expiresAt;
  const date = typeof expiry === "number" && Number.isFinite(expiry) ? new Date(expiry) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date) : null;
  return <>
    {joinOrConnect}
    {directory}
    <p className="text-[13px] leading-relaxed text-ink-secondary">{t("organization.additive")}</p>
    <Card
      collapsible
      cardId="organization.enterprise"
      title={t("settings.section.organization")}
      subtitle={t("organization.privacy")}
      summary={connection?.status === "connected" || connection?.status === "license-expired"
        ? connection.organization?.name ?? connection.email ?? t("settings.card.connected")
        : t("settings.card.notConnected")}
    >
      {!connection && <p role="status" className="text-[13px] text-ink-secondary">{error || t("organization.loading")}</p>}
      {connection?.message && <p role="status" className="mb-3 text-[13px] text-ink-secondary">{connection.message}</p>}
      {licenseExpired && <p role="alert" className="mb-3 text-[13px] text-ink">{t("organization.licenseExpired")}</p>}
      {connection?.status === "signed-out" && <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-secondary">{t("organization.signInHelp")}</p>
        <form className="flex flex-col gap-2 text-[12px] text-ink-secondary" onSubmit={(event) => {
          event.preventDefault();
          if (address.trim()) void perform(() => bridge.begin({ portalOrigin: address.trim() }));
        }}>
          <p>{t("organization.advancedHelp")}</p>
          <label className="flex flex-col gap-1.5">{t("organization.address")}
            <input type="url" required value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)}
              placeholder={PORTAL_PLACEHOLDER} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} maxLength={2048}
              className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
          </label>
          <button type="submit" disabled={busy || !address.trim()}
            className="w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50">{busy ? t("organization.working") : t("organization.signIn")}</button>
        </form>
      </div>}
      {connection?.status === "connecting" && <div className="flex flex-col items-start gap-3">
        <p role="status" className="text-[13px] text-ink-secondary">{t("organization.browserConsent")}</p>
        {connection.enrollment && <details className="w-full text-[12px] text-ink-secondary">
          <summary className="w-fit cursor-pointer hover:text-ink">{t("organization.securityDetails")}</summary>
          <p className="mt-2">{t("organization.securityDetailsHelp")}</p>
          <div className="mt-3">{t("organization.code")}</div>
          <code dir="ltr" className="mt-1 block w-fit select-all rounded-lg bg-inset px-3 py-2 text-base tracking-widest text-ink">{connection.enrollment.userCode}</code>
        </details>}
        <div className="flex flex-wrap gap-2">
          {/* A closed browser tab: reopen this attempt's own page, nothing else. */}
          {connection.enrollment && bridge.reopen && <button type="button" disabled={busy} className="ui-button" onClick={() => void perform(() => bridge.reopen!())}>{t("organization.reopen")}</button>}
          <button type="button" disabled={busy} className="ui-button" onClick={() => void perform(() => bridge.cancelEnrollment())}>{t("organization.cancel")}</button>
        </div>
      </div>}
      {enrolled && <div className="flex flex-col gap-3">
        <div>{connection.branding?.logo && <img src={connection.branding.logo} alt="Organization logo" className="mb-2 size-12 rounded-lg object-contain" />}<div className="break-words text-[15px] font-medium text-ink">{connection.organization?.name}</div>
          <div className="break-all text-[13px] text-ink-secondary">{connection.email}</div></div>
        {connection.status === "reauth-required" ? <p role="alert" className="text-[13px] text-ink-secondary">{t("organization.reauth")}</p> : connection.status === "license-expired" ? <>
          {connection.providers?.some((provider) => provider.configured && provider.models.length > 0) && <ul className="divide-y divide-hairline/40">{connection.providers.filter((provider) => provider.configured && provider.models.length > 0).map((provider) => <li key={provider.id} className="flex flex-wrap justify-between gap-2 py-2 text-[13px]">
            <span className="text-ink">{providerNames[provider.id] ?? provider.id}</span>
            <span className="text-ink-secondary">{t("organization.companyModelsUnavailable")}</span>
          </li>)}</ul>}
        </> : connection.status === "connected" ? <>
          <p className="text-[13px] text-ink-secondary">{t("organization.modelHelp")}</p>
          {connection.providers?.some((provider) => provider.configured && provider.models.length > 0) ?
            <CompanyModels providers={connection.providers} /> : <p className="text-[13px] text-ink-secondary">{t("organization.noModels")}</p>}
        </> : null}
        {confirmDisconnect ? <div role="group" aria-label={t("organization.disconnectTitle")} className="rounded-lg border border-hairline/40 p-3">
          <p className="text-[13px] text-ink">{t("organization.disconnectWarning")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" autoFocus disabled={busy} className="ui-button" onClick={() => setConfirmDisconnect(false)}>{t("organization.keepConnection")}</button>
            <button type="button" disabled={busy} className="ui-button text-danger" onClick={() => void perform(() => bridge.disconnect())}>{t("organization.disconnectConfirm")}</button>
          </div>
        </div> : <div className="flex flex-wrap gap-2">
          {connection.status !== "reauth-required" && <button type="button" disabled={busy} className="ui-button" onClick={() => void perform(() => bridge.refresh())}>{t("organization.refresh")}</button>}
          <button type="button" disabled={busy} className="ui-button" onClick={() => setConfirmDisconnect(true)}>{t("organization.disconnect")}</button>
        </div>}
      </div>}
      {connection?.status === "unavailable" && <p role="status" className="text-[13px] text-ink-secondary">{t("organization.unavailable")}</p>}
      {dateLabel && <p className="mt-3 text-[12px] text-ink-secondary">{t("organization.expires", { date: dateLabel })}</p>}
      {error && connection && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      {!connection && <button type="button" disabled={busy} className="ui-button mt-3" onClick={() => void perform(() => bridge.refresh())}>{t("organization.refresh")}</button>}
    </Card>
  </>;
}
