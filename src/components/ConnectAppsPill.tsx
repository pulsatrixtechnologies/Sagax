// The "Connect apps" pill under the last message (2026-10-15, JC, after
// Grok Bot): a wide rounded pill, then the small icons of the apps the bot
// needed. It opens Connect apps on those apps. When it shows is decided by
// src/lib/connect-apps-signal.ts (the latest turn needed an app that is not
// connected), never here. The icons are Connect apps' own (ServiceIcon:
// the catalog logo, else the site's icon, else a monogram).
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { neededApps, type NeededApp } from "@/lib/connect-apps-signal";
import { api, useStore, type Message } from "@/state/store";
import { preloadConnectedApps, ServiceIcon, type ToolkitCard } from "./plugins/connected-apps";

export interface PillApp {
  slug: string;
  label: string;
  logo: string | null;
  domain: string | null;
}

/** At most three icons, like the model. */
export const PILL_ICONS = 3;

/** The pill itself: a wide rounded button, the label then up to three app
 * icons. The conversation's pill and the sidebar's foot share it. */
export function ConnectAppsButton({ apps, onOpen, ariaLabel, title, className, ...data }: {
  apps: readonly PillApp[];
  onOpen: () => void;
  ariaLabel: string;
  title?: string;
  className?: string;
  [data: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      title={title}
      {...data}
      className={cn("inline-flex h-9 max-w-full items-center gap-2.5 rounded-full border border-hairline/40 bg-panel pl-4 pr-3 text-[13px] font-medium leading-5 text-ink transition-colors hover:bg-raised", className)}
    >
      <span className="min-w-0 truncate">{t("chat.connectApps.pill")}</span>
      {apps.length > 0 && (
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
          {apps.slice(0, PILL_ICONS).map((app) => (
            <ServiceIcon key={app.slug} card={{ logo: app.logo, domain: app.domain, label: app.label }} className="size-[18px] rounded-[5px] text-[10px]" />
          ))}
        </span>
      )}
    </button>
  );
}

export function ConnectAppsPill({ apps, onOpen }: { apps: readonly PillApp[]; onOpen: () => void }) {
  if (!apps.length) return null;
  const names = apps.map((app) => app.label).join(", ");
  return (
    <div className="flex justify-end" data-connect-apps-pill>
      <ConnectAppsButton apps={apps} onOpen={onOpen} ariaLabel={t("chat.connectApps.aria", { apps: names })} title={names} />
    </div>
  );
}

// The catalog is fetched once per window, only when a pill needs a logo.
let catalog: Promise<Map<string, ToolkitCard>> | null = null;
function catalogCards(): Promise<Map<string, ToolkitCard>> {
  catalog ??= api<{ cards?: ToolkitCard[] }>("/api/connectors/catalog")
    .then((response) => new Map((response.cards ?? []).map((card) => [card.slug.toLowerCase(), card])))
    .catch(() => {
      catalog = null;
      return new Map<string, ToolkitCard>();
    });
  return catalog;
}

function titleOf(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** The pill for one conversation: the signal, the inventory, the catalog. */
export function ConversationConnectApps({ botId, messages, busy }: { botId: string; messages: readonly Message[]; busy: boolean }) {
  const { dispatch } = useStore();
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [cards, setCards] = useState<Map<string, ToolkitCard> | null>(null);
  const needed: NeededApp[] = useMemo(
    () => neededApps(messages as Message[], { busy, connected: (slug) => connected[slug] === true }),
    [messages, busy, connected],
  );
  const key = needed.map((app) => app.slug).join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    // Ask again whenever the needed apps change: one may have been connected
    // in the meantime (the panel, another device).
    void preloadConnectedApps(true).then((inventory) => {
      if (!live || !inventory.authoritative) return;
      setConnected(Object.fromEntries(Object.entries(inventory.services).map(([slug, status]) => [slug.toLowerCase(), status.connected === true])));
    });
    void catalogCards().then((map) => { if (live) setCards(map); });
    return () => { live = false; };
  }, [key]);
  if (!needed.length) return null;
  const apps: PillApp[] = needed.map((app) => {
    const card = cards?.get(app.slug);
    return { slug: app.slug, label: card?.label ?? app.label ?? titleOf(app.slug), logo: card?.logo ?? null, domain: card?.domain ?? null };
  });
  return (
    <ConnectAppsPill
      apps={apps}
      onOpen={() => dispatch({ type: "togglePlugins", open: true, surface: "apps", botId, focusApps: apps.map((app) => app.slug) })}
    />
  );
}

/** Shown in the sidebar's foot when nothing is connected yet. */
const SUGGESTED_APPS: readonly PillApp[] = [
  { slug: "gmail", label: "Gmail", logo: null, domain: "gmail.com" },
  { slug: "slack", label: "Slack", logo: null, domain: "slack.com" },
  { slug: "github", label: "GitHub", logo: null, domain: "github.com" },
];

/** The icons of the sidebar's pill: the person's connected apps (three at
 * most, by name), else the usual suggestions. Logos come from the catalog. */
export function sidebarPillApps(connected: readonly string[], cards: ReadonlyMap<string, ToolkitCard> | null): PillApp[] {
  const slugs = [...new Set(connected.map((slug) => slug.toLowerCase()))].sort().slice(0, PILL_ICONS);
  const base: PillApp[] = slugs.length
    ? slugs.map((slug) => ({ slug, label: titleOf(slug), logo: null, domain: null }))
    : [...SUGGESTED_APPS];
  return base.map((app) => {
    const card = cards?.get(app.slug);
    return card ? { slug: app.slug, label: card.label, logo: card.logo, domain: card.domain ?? app.domain } : app;
  });
}

/** The foot of the desktop sidebar (JC, 2026-10-15): the same pill as the
 * conversation's, in place of the Connected apps row. It opens Connect apps
 * the way the row did. The collapsed rail keeps an icon button. */
export function SidebarConnectApps({ onOpen, iconOnly = false, icon }: { onOpen: () => void; iconOnly?: boolean; icon?: ReactNode }) {
  const [connected, setConnected] = useState<string[]>([]);
  const [cards, setCards] = useState<Map<string, ToolkitCard> | null>(null);
  useEffect(() => {
    if (iconOnly) return;
    let live = true;
    void preloadConnectedApps().then((inventory) => {
      if (live) setConnected(Object.entries(inventory.services).filter(([, status]) => status.connected === true).map(([slug]) => slug));
    }).catch(() => {});
    void catalogCards().then((map) => { if (live) setCards(map); });
    return () => { live = false; };
  }, [iconOnly]);
  const label = t("chat.connectApps.pill");
  if (iconOnly) {
    return (
      <button
        type="button"
        data-tour="nav-apps"
        data-sidebar-connect-apps=""
        onClick={onOpen}
        aria-label={label}
        title={label}
        className="flex h-9 w-full items-center justify-center rounded-lg px-2 text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink"
      >
        {icon}
      </button>
    );
  }
  return (
    <div className="mb-1.5 px-0.5">
      <ConnectAppsButton
        apps={sidebarPillApps(connected, cards)}
        onOpen={onOpen}
        ariaLabel={label}
        data-tour="nav-apps"
        data-sidebar-connect-apps=""
        className="w-full justify-between"
      />
    </div>
  );
}
