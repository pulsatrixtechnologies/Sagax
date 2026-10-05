import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, ApiError, useStore } from "@/state/store";
import { ConnectedWorkspacesSettings } from "./ConnectedWorkspacesSettings";
import { RemoteComputerSection } from "./RemoteComputerSection";
import { CustomDomainSettings } from "./CustomDomainSettings";
import { PerspicaxOrgSettings } from "./PerspicaxOrgSettings";
import { JoinPerspicaxCard } from "./JoinPerspicaxCard";
import { OrgDirectory, type OrgPersonView, type PendingInviteView } from "./OrgDirectory";
import type { OrgRole } from "../../server/org-directory.ts";
import { isPerspicaxOrg, type PerspicaxOrg } from "@/lib/perspicax-org";
import { ServerModeComputerAccess } from "./ServerModeSettings";

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

/** Settings → Organization is Perspicax (or a solo server's own invitations).
 * The hosted OpenMausBot Admin portal is not offered here. */
export function OrganizationSettings() {
  const { state: store } = useStore();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  const [orgReady, setOrgReady] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [servers, setServers] = useState<{ activeId: string; count: number } | null>(null);
  // A server signed in with Perspicax: its own organization view.
  const [perspicaxOrg, setPerspicaxOrg] = useState<PerspicaxOrg | null>(null);

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
  return <>
    {joinOrConnect}
    {directory}
  </>;
}
