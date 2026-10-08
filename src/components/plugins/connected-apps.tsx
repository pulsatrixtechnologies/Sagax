// Connected apps (Composio Sessions): the catalog, the account inventory and
// the connect / disconnect flow, shared by the Plugins views. Catalog comes
// from /api/connectors/catalog: the full toolkit list with logos when a
// Composio API key is configured, a curated set otherwise.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Bot, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { readCachedInventory, writeCachedInventory } from "@/lib/connected-apps-cache";
import { reserveConnectionPage, reusableConnectionUrl, type PendingAuthorization } from "@/lib/connector-oauth";
import { mcpSignInLink } from "@/lib/mcp-sign-in";
import { isConnectorToolGrantShape } from "@/lib/connector-grants";

export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  noAuth?: boolean;
  domain: string | null;
}

export interface ConnectorStatus {
  connected: boolean;
  pending?: boolean;
  status?: string;
  accounts?: Array<{
    id: string;
    alias?: string;
    status: string;
  }>;
}

// The panel is a modal and unmounts whenever it closes. Keep the last known
// account inventory at module scope so reopening never flashes every service
// as disconnected while a fresh secure status check runs in the background.
let cachedConnectorStatus: Record<string, ConnectorStatus> | null = null;
let cachedConnectorStatusAt = 0;
let cachedConnectorStatusAuthoritative = true;
let connectorStatusRequest: Promise<ConnectorInventory> | null = null;
const CONNECTOR_STATUS_CACHE_MS = 30_000;

export interface ConnectorInventory {
  services: Record<string, ConnectorStatus>;
  /** false when the server could not read the credential store: the list is
   * then "we do not know", and nothing may be cleared on the strength of it */
  authoritative: boolean;
}

/** Warm the account inventory once the app server is ready. Concurrent panel
 * opens share the same request, and recent data survives modal unmounts. */
export function preloadConnectedApps(force = false): Promise<ConnectorInventory> {
  if (!force && cachedConnectorStatus !== null && Date.now() - cachedConnectorStatusAt < CONNECTOR_STATUS_CACHE_MS) {
    return Promise.resolve({
      services: cachedConnectorStatus,
      authoritative: cachedConnectorStatusAuthoritative,
    });
  }
  if (connectorStatusRequest) return connectorStatusRequest;
  connectorStatusRequest = api("/api/connectors/connected")
    .then((response) => {
      const services: Record<string, ConnectorStatus> = response.services ?? {};
      // An unreadable credential store tells us nothing about what is
      // connected. Keep the last inventory we were sure about instead.
      if (response.credentialStore === "unavailable") {
        return { services: readCachedInventory()?.services ?? {}, authoritative: false };
      }
      cachedConnectorStatus = services;
      cachedConnectorStatusAt = Date.now();
      cachedConnectorStatusAuthoritative = true;
      writeCachedInventory(services, Date.now());
      return { services, authoritative: true };
    })
    .catch(() => ({ services: readCachedInventory()?.services ?? {}, authoritative: false }))
    .finally(() => {
      connectorStatusRequest = null;
    });
  return connectorStatusRequest;
}

export function disconnectAccountConfirmation(
  service: string,
  account: { id: string; alias?: string },
) {
  const identity = account.alias ? `“${account.alias}” (${account.id})` : `“${account.id}”`;
  return t("connectors.disconnectConfirm", { identity, service });
}

/** Bots that cannot see the workspace's connected apps because their own
 * per-bot grant is off. Connecting an app is only half of it: a bot a Chief
 * of Staff created, a package brought in, or a backup restored starts with
 * that grant off, and until it is on the bot is never told the tools exist
 * and reaches for a browser instead, with nothing on screen saying why.
 * Bots whose engine cannot mount the tools at all are left out, because
 * their switch is disabled: naming them would move the dead end, not end it.
 * Hidden bots are left out for the same reason: the person cannot act on
 * one from here. */
export function botsMissingConnectedApps(bots: Bot[], instances: InstanceInfo[]): Bot[] {
  return bots.filter((bot) =>
    !bot.hidden &&
    bot.composio === false &&
    instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)
      ?.capabilities?.composioMcp === true);
}

/** Bots whose connector tool grants limit this service below every tool:
 * a partial list, no entry at all inside an explicit record, or a grant
 * shape this build cannot read. Legacy bots (no grants record) have every
 * tool and never appear. Engines that cannot mount the tools and hidden
 * bots are left out: their editors are dead ends from here. */
export function botsWithLimitedServiceTools(bots: Bot[], instances: InstanceInfo[], slug: string): Bot[] {
  return bots.filter((bot) => {
    if (bot.hidden || bot.composio === false) return false;
    if (!instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)
      ?.capabilities?.composioMcp) return false;
    const record: unknown = bot.connectorTools;
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    const grant = (record as Record<string, unknown>)[slug];
    if (grant === undefined) return true;
    return !isConnectorToolGrantShape(grant) || grant.tools !== "*";
  });
}

export function hasUsableConnectedApps(configured: boolean, phase: ConnectorInventoryPhase, stale: boolean, status: Record<string, ConnectorStatus>): boolean {
  return configured && phase === "ready" && !stale && Object.values(status).some((service) => service.connected);
}

export function requiresAccountAlias(message: string) {
  return /account alias.*existing connection.*not replaced/i.test(message);
}

export type ConnectorInventoryPhase = "loading" | "ready" | "error";

export function connectorActionLabel(
  phase: ConnectorInventoryPhase,
  state: { busy: boolean; included: boolean; canContinue: boolean; pending?: boolean; hasAccounts: boolean; failed: boolean },
) {
  if (state.busy) return null;
  if (state.included) return t("connectors.action.included");
  if (phase === "loading") return t("connectors.action.checking");
  if (phase === "error") return t("connectors.action.unavailable");
  if (state.canContinue) return t("connectors.action.continue");
  if (state.pending) return t("connectors.action.checkStatus");
  if (state.hasAccounts) return t("connectors.action.addAccount");
  if (state.failed) return t("connectors.action.retry");
  return t("connectors.action.connect");
}

export function connectedInventoryCopy(phase: ConnectorInventoryPhase) {
  if (phase === "loading") return {
    title: t("connectors.empty.loadingTitle"),
    description: t("connectors.empty.loadingDesc"),
  };
  if (phase === "error") return {
    title: t("connectors.empty.errorTitle"),
    description: t("connectors.empty.errorDesc"),
  };
  return {
    title: t("connectors.empty.noneTitle"),
    description: t("connectors.empty.noneDesc"),
  };
}

export function mergeCurrentConnectorStatus(
  current: Record<string, ConnectorStatus>,
  incoming: Record<string, ConnectorStatus>,
  latestGenerations: ReadonlyMap<string, number>,
  requestGenerations: ReadonlyMap<string, number>,
) {
  const next = { ...current };
  for (const [slug, state] of Object.entries(incoming)) {
    if ((latestGenerations.get(slug) ?? 0) !== (requestGenerations.get(slug) ?? 0)) continue;
    next[slug] = state;
  }
  return next;
}

export function mergeCompleteConnectorStatus(
  current: Record<string, ConnectorStatus>,
  incoming: Record<string, ConnectorStatus>,
  latestGenerations: ReadonlyMap<string, number>,
  requestGenerations: ReadonlyMap<string, number>,
  /** Did the server actually KNOW the full picture? A response sent while the
   * credential store was unreadable carries no information about what is
   * connected, so it must not be allowed to clear anything: an empty list
   * from an ignorant server is exactly how a connected app became a Connect
   * button. Disconnection still shows up on the next authoritative answer. */
  authoritative = true,
) {
  const next = { ...current };
  if (!authoritative) return mergeCurrentConnectorStatus(next, incoming, latestGenerations, requestGenerations);
  for (const [slug, state] of Object.entries(current)) {
    if (incoming[slug]) continue;
    if (!state.connected && !state.accounts?.length) continue;
    if ((latestGenerations.get(slug) ?? 0) !== (requestGenerations.get(slug) ?? 0)) continue;
    next[slug] = { connected: false, pending: false, status: "not_connected", accounts: [] };
  }
  return mergeCurrentConnectorStatus(next, incoming, latestGenerations, requestGenerations);
}

export function onlyLatestConnectorResponses(
  incoming: Record<string, ConnectorStatus>,
  latestRequests: ReadonlyMap<string, number>,
  requestIds: ReadonlyMap<string, number>,
) {
  return Object.fromEntries(
    Object.entries(incoming).filter(
      ([slug]) => (latestRequests.get(slug) ?? 0) === (requestIds.get(slug) ?? 0),
    ),
  );
}

/** A toolkit's mark: official logo, else favicon by domain, else monogram.
 * Shared with the onboarding connectors scene so both show the same logos. */
export function ServiceIcon({ card, className = "size-11" }: { card: Pick<ToolkitCard, "logo" | "domain" | "label">; className?: string }) {
  // 0 = official logo, 1 = favicon by domain, 2 = monogram
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  // The full catalog is well over a thousand cards, so let the browser skip
  // the logos that are scrolled out of view instead of fetching every one.
  if (stage === 0 && card.logo) {
    return (
      <img
        src={card.logo}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className={cn("flex items-center justify-center rounded-xl bg-raised text-[15px] font-semibold text-ink-secondary", className)}>
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Catalog completeness, as reported by /api/connectors/catalog. Absent
 * totalItems means upstream never stated a total, so there is nothing to
 * compare the served cards against. */
export interface CatalogPagination {
  items: number;
  totalItems?: number;
  stalled: boolean;
  /** Server-side stop reason, present only when the walk stalled (#1838). */
  reason?: string;
}

export type ConnectedAppsError = string | { key: LocaleKey } | null;

/** The connected-apps state of the Plugins panel: catalog, accounts and the
 * connect flow. The panel is a modal that unmounts when it closes; the
 * module cache above keeps the last inventory across openings. */
export function useConnectedApps() {
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [source, setSource] = useState<"api" | "curated">("curated");
  const [pagination, setPagination] = useState<CatalogPagination | null>(null);
  const [configured, setConfigured] = useState(false);
  const [mode, setMode] = useState<"managed" | "self-hosted" | "unavailable">("unavailable");
  // Paint what we last knew before any request goes out: the module cache if
  // this window already fetched, otherwise the inventory saved on disk. An
  // empty panel is never the first thing a connected user sees.
  const [status, setStatus] = useState<Record<string, ConnectorStatus>>(
    () => cachedConnectorStatus ?? readCachedInventory()?.services ?? {},
  );
  /** true when what is on screen is remembered rather than confirmed */
  const [stale, setStale] = useState(
    cachedConnectorStatus !== null && !cachedConnectorStatusAuthoritative,
  );
  const [pendingUrls, setPendingUrls] = useState<Record<string, PendingAuthorization>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [inventoryPhase, setInventoryPhase] = useState<ConnectorInventoryPhase>(
    cachedConnectorStatus === null ? "loading" : "ready",
  );
  const [error, setError] = useState<ConnectedAppsError>(null);
  /** the app whose "name this account" field is open */
  const [aliasSlug, setAliasSlug] = useState<string | null>(null);

  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const statusGenerations = useRef(new Map<string, number>());
  const latestStatusRequests = useRef(new Map<string, number>());
  const opening = useRef<ReturnType<typeof reserveConnectionPage> | null>(null);

  const clearPendingUrl = (slug: string) => setPendingUrls((current) => {
    if (!current[slug]) return current;
    const next = { ...current };
    delete next[slug];
    return next;
  });

  const refreshStatus = useCallback((slugs: string[]): Promise<Record<string, ConnectorStatus>> => {
    if (!slugs.length) return Promise.resolve({});
    const requestGenerations = new Map(slugs.map((slug) => [slug, statusGenerations.current.get(slug) ?? 0]));
    const requestIds = new Map(slugs.map((slug) => {
      const requestId = (latestStatusRequests.current.get(slug) ?? 0) + 1;
      latestStatusRequests.current.set(slug, requestId);
      return [slug, requestId];
    }));
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => {
        const services = onlyLatestConnectorResponses(r.services ?? {}, latestStatusRequests.current, requestIds);
        // A one-service OAuth poll must not erase every other app's state.
        // A request that began before Connect must also not erase the newer
        // local INITIATED state when its stale not_connected result arrives.
        setStatus((current) => mergeCurrentConnectorStatus(current, services, statusGenerations.current, requestGenerations));
        for (const [slug, state] of Object.entries(services)) {
          const isCurrent = (statusGenerations.current.get(slug) ?? 0) === (requestGenerations.get(slug) ?? 0);
          if (isCurrent && ((state.connected && !state.pending) || /^(expired|failed)$/i.test(state.status ?? ""))) clearPendingUrl(slug);
        }
        return services;
      })
      .catch(() => ({}));
  }, []);

  const refreshConnectedStatus = useCallback((force = false): Promise<Record<string, ConnectorStatus>> => {
    const requestGenerations = new Map(statusGenerations.current);
    setRefreshing(true);
    return preloadConnectedApps(force)
      .then(({ services, authoritative }) => {
        setStale(!authoritative);
        setStatus((current) => mergeCompleteConnectorStatus(current, services, statusGenerations.current, requestGenerations, authoritative));
        for (const [slug, state] of Object.entries(services)) {
          const isCurrent = (statusGenerations.current.get(slug) ?? 0) === (requestGenerations.get(slug) ?? 0);
          if (isCurrent && ((state.connected && !state.pending) || /^(expired|failed)$/i.test(state.status ?? ""))) clearPendingUrl(slug);
        }
        return services;
      })
      .finally(() => setRefreshing(false));
  }, []);

  const loadConnectionInventory = useCallback((force = false) => {
    const hadCachedInventory = cachedConnectorStatus !== null;
    if (!hadCachedInventory) setInventoryPhase("loading");
    setError(null);
    return refreshConnectedStatus(force)
      .then((services) => {
        setInventoryPhase("ready");
        return services;
      })
      .catch((cause) => {
        if (!hadCachedInventory) setInventoryPhase("error");
        setError(cause instanceof Error ? cause.message : String(cause));
        return {};
      });
  }, [refreshConnectedStatus]);

  useEffect(() => () => {
    opening.current?.cancel();
    opening.current = null;
    for (const timer of pollTimers.current.values()) clearInterval(timer);
    pollTimers.current.clear();
  }, []);

  useEffect(() => {
    if (inventoryPhase !== "ready") return;
    cachedConnectorStatus = status;
    cachedConnectorStatusAt = Date.now();
    cachedConnectorStatusAuthoritative = !stale;
  }, [inventoryPhase, stale, status]);

  const catalogGeneration = useRef(0);
  const loadCatalog = useCallback(() => {
    const generation = ++catalogGeneration.current;
    return api("/api/connectors/catalog")
      .then((r) => {
        if (generation !== catalogGeneration.current) return;
        setCards(r.cards ?? []);
        setSource(r.source ?? "curated");
        setPagination(r.pagination ?? null);
        setConfigured(Boolean(r.configured));
        setMode(r.mode ?? "unavailable");
      })
      .catch((e) => {
        if (generation !== catalogGeneration.current) return;
        setCards((current) => current ?? []);
        setError(e.message);
      });
  }, []);

  useEffect(() => {
    void loadConnectionInventory();
    void loadCatalog();
    return () => {
      // an unmounted panel ignores any answer still in flight
      catalogGeneration.current++;
    };
  }, [loadCatalog, loadConnectionInventory]);

  const openConnectUrl = async (url: string) => {
    if (opening.current) return;
    const launch = reserveConnectionPage();
    opening.current = launch;
    try {
      if (!await launch.open(url) && opening.current === launch) {
        setError({ key: "connectors.popupBlockedContinue" });
      }
    } finally {
      launch.cancel();
      if (opening.current === launch) opening.current = null;
    }
  };

  const startPolling = (slug: string) => {
    const old = pollTimers.current.get(slug);
    if (old) clearInterval(old);
    let tries = 0;
    const timer = setInterval(() => {
      void refreshStatus([slug]).then((services) => {
        const state = services[slug];
        if (++tries >= 24 || (state?.connected && !state.pending) || (state?.status && /^(expired|failed)$/i.test(state.status))) {
          clearInterval(timer);
          pollTimers.current.delete(slug);
        }
      });
    }, 5000);
    pollTimers.current.set(slug, timer);
  };

  const connect = async (slug: string, alias?: string) => {
    if (busySlug || opening.current) return;
    // Reserve the tab during the click, before the request uses up the
    // browser's user activation.
    const launch = reserveConnectionPage();
    opening.current = launch;
    statusGenerations.current.set(slug, (statusGenerations.current.get(slug) ?? 0) + 1);
    setBusySlug(slug);
    setError(null);
    try {
      const createdAt = Date.now();
      const request: RequestInit = { method: "POST" };
      if (alias) request.body = JSON.stringify({ alias });
      const result = await api(`/api/connectors/${slug}/authorize`, request);
      if (opening.current !== launch) return;
      const url = mcpSignInLink(typeof result.url === "string" ? result.url : null);
      if (!url) throw new Error(t("connectors.invalidAuthorizationUrl"));
      setPendingUrls((current) => ({ ...current, [slug]: { url, createdAt } }));
      setStatus((current) => ({
        ...current,
        [slug]: { ...current[slug], connected: current[slug]?.connected ?? false, pending: true, status: "INITIATED" },
      }));
      setAliasSlug(null);
      startPolling(slug);
      if (!await launch.open(url) && opening.current === launch) {
        setError({ key: "connectors.popupBlockedContinue" });
      }
    } catch (e) {
      if (opening.current !== launch) return;
      const message = e instanceof Error ? e.message : String(e);
      if (requiresAccountAlias(message)) {
        // Recover gracefully if an existing account was discovered after the
        // button rendered. Show the label field and refresh only this app.
        setAliasSlug(slug);
        setError({ key: "connectors.aliasNeeded" });
        void refreshStatus([slug]);
      } else {
        setError(message);
      }
    } finally {
      launch.cancel();
      if (opening.current === launch) {
        opening.current = null;
        setBusySlug(null);
      }
    }
  };

  /** A sign-in link still usable (Composio links expire after ten minutes). */
  const pendingUrl = (slug: string) => reusableConnectionUrl(pendingUrls[slug]);

  /** The row's button: continue a sign-in in flight, check on one whose
   * address was lost, or open the account-name field that starts one. */
  const primaryAction = (slug: string) => {
    const state = status[slug];
    const failed = /^(expired|failed)$/i.test(state?.status ?? "");
    if (state?.pending && !failed) {
      const url = pendingUrl(slug);
      if (url) {
        setError(null);
        void openConnectUrl(url).catch((e) => setError(e.message));
      } else {
        // A reload or an expired link cannot be resumed. The host safely
        // retries unfinished-only accounts; live accounts still need a new
        // name below.
        void connect(slug);
      }
      return;
    }
    // Every account gets a name the person chooses, the first one included.
    setAliasSlug((current) => current === slug ? null : slug);
  };

  const disconnectAccount = (slug: string, accountId: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]))
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  /** Uninstall: every account of the app. */
  const removeService = (slug: string) => {
    setBusySlug(slug);
    statusGenerations.current.set(slug, (statusGenerations.current.get(slug) ?? 0) + 1);
    return api(`/api/connectors/${slug}`, { method: "DELETE" })
      .then(() => {
        setStatus((current) => ({ ...current, [slug]: { connected: false, pending: false, status: "not_connected", accounts: [] } }));
        return refreshStatus([slug]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  return {
    cards, source, pagination, configured, mode, status, stale, pendingUrls, busySlug, refreshing, inventoryPhase,
    error, setError, aliasSlug, setAliasSlug, loadConnectionInventory, refreshStatus, connect, primaryAction, pendingUrl,
    disconnectAccount, removeService, openConnectUrl,
  };
}

export type ConnectedApps = ReturnType<typeof useConnectedApps>;
