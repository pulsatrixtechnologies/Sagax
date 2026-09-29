import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ManagedDesktopState } from "../../electron/managed-desktop.mjs";
import type { OrgRole } from "../../server/org-directory.ts";
import type { OrgRecord } from "../../server/org-record.ts";
import { activeLocale, t } from "@/lib/i18n";
import { api, ApiError } from "@/state/store";
import { Card } from "./SettingsPrimitives";
import { CompanyModels } from "./CompanyModels";
import { OrgDirectory } from "./OrgDirectory";
import { notifyOrgColumn } from "./org-column";

const providerNames: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter" };
const DEFAULT_PORTAL_ORIGIN = "https://admin.openmausbot.com";

/** Consistent with `serverAddressOk` in server/org-record.ts: https for any
 * host, http only for a Tailscale name or a local Docker server. */
export function orgHostFromInput(value: string): { kind: "server"; url: string } | null {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    const localOrTailnet = parsed.hostname.endsWith(".ts.net") || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && localOrTailnet)) return { kind: "server", url };
  } catch { /* not a URL */ }
  return null;
}

/** Everyone in the organization signs in to this server; ask for its address
 * up front rather than defaulting to a computer that may go offline. */
export function OrgCreateForm({
  initialAddress,
  onCreate,
}: {
  initialAddress: string;
  onCreate: (name: string, host: { kind: "server"; url: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState(initialAddress);
  const host = orgHostFromInput(address);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const value = name.trim();
        if (value && host) void onCreate(value, host);
      }}
    >
      <label className="flex flex-col gap-1.5 text-[13px] text-ink">
        Nom
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink">
        {t("org.serverAddress")}
        <input
          name="org-server-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="https://…"
          autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50"
        />
        <span className="text-[12px] text-ink-secondary">{t("org.serverAddressHelp")}</span>
      </label>
      <button type="submit" disabled={!host} className="w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50">
        Créer l'organisation
      </button>
    </form>
  );
}

/** Only the trusted desktop bridge can enroll this computer or hold its token. */
export function OrganizationSettings() {
  const bridge = window.ogb?.remoteClient?.active ? undefined : window.ogb?.organization;
  const [connection, setConnection] = useState<ManagedDesktopState | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const revision = useRef(0);
  const status = useRef<ManagedDesktopState["status"] | undefined>(undefined);
  const [org, setOrg] = useState<{ name: string; host?: OrgRecord["host"] } | null>(null);
  const [people, setPeople] = useState<{ id: string; role: OrgRole }[]>([]);
  const [pendingInvites, setPendingInvites] = useState<{ email: string }[]>([]);
  const [orgReady, setOrgReady] = useState(false);
  const [directoryError, setDirectoryError] = useState("");

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

  const loadOrg = async (alive = () => true) => {
    try {
      const body = await api<{ org: { name: string; host?: OrgRecord["host"] }; people?: { id: string; role: OrgRole }[]; pendingInvites?: { email: string }[] }>("/api/org");
      if (!alive()) return;
      setOrg({ name: body.org.name, host: body.org.host });
      setPeople(body.people ?? []);
      setPendingInvites(body.pendingInvites ?? []);
      setOrgReady(true);
      setDirectoryError("");
    } catch (error) {
      if (!alive()) return;
      if (error instanceof ApiError && error.status === 404) {
        setOrg(null);
        setPeople([]);
        setPendingInvites([]);
        setOrgReady(true);
        setDirectoryError("");
        return;
      }
      setDirectoryError("Impossible de charger l'organisation.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadOrg(() => !cancelled);
    return () => {
      cancelled = true;
    };
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

  const directory = (
    <>
      {orgReady && (
        <OrgDirectory
          org={org}
          people={people}
          pendingInvites={pendingInvites}
          initialAddress=""
          onCreate={async (name, host) => {
            try {
              const created = await api<{ org?: { name?: string } }>("/api/org", { method: "POST", body: JSON.stringify({ name, host }) });
              const createdName = typeof created.org?.name === "string" ? created.org.name : name;
              notifyOrgColumn(createdName);
              await loadOrg();
            } catch {
              setDirectoryError("Impossible de créer l'organisation.");
            }
          }}
          onInvite={async (email) => {
            try {
              await api("/api/org/invites", { method: "POST", body: JSON.stringify({ email }) });
              await loadOrg();
            } catch (error) {
              setDirectoryError("Impossible d'envoyer l'invitation.");
              throw error;
            }
          }}
        />
      )}
      {org?.host?.kind === "this-computer" && (
        <p role="status" className="text-[13px] text-ink-secondary">{t("org.needsServerAddress")}</p>
      )}
      {directoryError && <p role="alert" className="text-[13px] text-danger">{directoryError}</p>}
    </>
  );

  if (!bridge) return <>
    {directory}
    <p className="text-[13px] text-ink-secondary">{t("organization.desktopOnly")}</p>
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
    {directory}
    <p className="text-[13px] leading-relaxed text-ink-secondary">{t("organization.additive")}</p>
    <Card title={t("settings.section.organization")} subtitle={t("organization.privacy")}>
      {!connection && <p role="status" className="text-[13px] text-ink-secondary">{error || t("organization.loading")}</p>}
      {connection?.message && <p role="status" className="mb-3 text-[13px] text-ink-secondary">{connection.message}</p>}
      {licenseExpired && <p role="alert" className="mb-3 text-[13px] text-ink">{t("organization.licenseExpired")}</p>}
      {connection?.status === "signed-out" && <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-secondary">{t("organization.signInHelp")}</p>
        <button type="button" disabled={busy} onClick={() => void perform(() => bridge.begin({ portalOrigin: DEFAULT_PORTAL_ORIGIN }))}
          className="w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50">{busy ? t("organization.working") : t("organization.signIn")}</button>
        <details className="text-[12px] text-ink-secondary">
          <summary className="w-fit cursor-pointer hover:text-ink">{t("organization.advanced")}</summary>
          <form className="mt-2 flex flex-col gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (address.trim()) void perform(() => bridge.begin({ portalOrigin: address.trim() }));
          }}>
            <p>{t("organization.advancedHelp")}</p>
            <label className="flex flex-col gap-1.5">{t("organization.address")}
              <input type="url" required value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)}
                placeholder={DEFAULT_PORTAL_ORIGIN} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} maxLength={2048}
                className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
            </label>
            <button type="submit" disabled={busy || !address.trim()} className="ui-button w-fit">{t("organization.customSignIn")}</button>
          </form>
        </details>
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
