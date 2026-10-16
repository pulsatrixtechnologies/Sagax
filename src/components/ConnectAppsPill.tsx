// The "Connect apps" pill under the last message (2026-10-15, JC, after
// Grok Bot): a wide rounded pill, then the small icons of the apps the bot
// needed. It opens Connect apps on those apps. When it shows is decided by
// src/lib/connect-apps-signal.ts (the latest turn needed an app that is not
// connected), never here. The icons are Connect apps' own (ServiceIcon:
// the catalog logo, else the site's icon, else a monogram).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

// Grok Bot's pill, by its measurements (JC, 2026-10-15): 36px tall, 16px
// side padding (12px after the tiles), the tiles 6px after the label. The
// tiles are 18px rounded squares (6px), each a white 16px tile inside a 1px
// ring the pill's own colour, stacked 6px over the one before (42px for
// three). On hover they fan out (styles.css, [data-pill-tile]).
const PAD = 16;
const PAD_AFTER_TILES = 12;
const PAD_COMPACT = 12;
/** Past Grok's narrow padding, so "Connecter des applications" still fits
 * the default 280px sidebar (JC: the label is never cut). */
const PAD_SNUG = 8;
const TILES_GAP = 6;
const TILE = 18;
const TILE_OVERLAP = 6;
const BORDER = 2;

export type PillFit = "full" | "compact" | "snug" | "tight";

export function tilesWidth(count: number): number {
  return count > 0 ? TILE + (Math.min(count, PILL_ICONS) - 1) * (TILE - TILE_OVERLAP) : 0;
}

/** How the pill fits its width: the label and the tiles ("full"), the label
 * alone with 12px sides ("compact", Grok's narrow sidebar), with 8px sides
 * ("snug"), or not even that ("tight": the label is cut, which only a sidebar
 * dragged near its narrowest does). */
export function pillFit(available: number, labelWidth: number, tiles: number): PillFit {
  const full = PAD + labelWidth + (tiles > 0 ? TILES_GAP + tilesWidth(tiles) + PAD_AFTER_TILES : PAD) + BORDER;
  if (available >= full) return "full";
  if (available >= PAD_COMPACT * 2 + labelWidth + BORDER) return "compact";
  if (available >= PAD_SNUG * 2 + labelWidth + BORDER) return "snug";
  return "tight";
}

/** The pill itself: a wide rounded button, the label then up to three app
 * tiles. The conversation's pill and the sidebar's foot share it; the
 * sidebar's (fit) gives the tiles up before it cuts the label. */
export function ConnectAppsButton({ apps, onOpen, ariaLabel, title, className, fit = false, ...data }: {
  apps: readonly PillApp[];
  onOpen: () => void;
  ariaLabel: string;
  title?: string;
  className?: string;
  /** Measure the width it gets and drop the tiles (then the padding) first. */
  fit?: boolean;
  [data: `data-${string}`]: string | undefined;
}) {
  const shown = apps.slice(0, PILL_ICONS);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<PillFit>("full");
  const label = t("chat.connectApps.pill");
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const text = labelRef.current;
    if (!fit || !button || !text) return;
    const measure = () => setState(pillFit(button.getBoundingClientRect().width, text.scrollWidth, shown.length));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    return () => observer.disconnect();
  }, [fit, shown.length, label]);
  const tiles = shown.length > 0 && state === "full";
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      title={title ?? (state === "tight" ? label : undefined)}
      data-pill-fit={fit ? state : undefined}
      {...data}
      className={cn(
        "connect-apps-pill inline-flex h-9 max-w-full items-center justify-center rounded-full border border-hairline/40 bg-panel text-[13px] font-medium leading-5 text-ink hover:bg-raised",
        state === "full" ? "px-4" : state === "compact" ? "px-3" : "px-2",
        tiles && "pr-3",
        className,
      )}
    >
      <span ref={labelRef} className={cn("block min-w-0 whitespace-nowrap", state === "tight" && "overflow-hidden text-ellipsis")}>{label}</span>
      {shown.length > 0 && (
        <span
          data-pill-tiles=""
          data-hidden={tiles ? undefined : ""}
          aria-hidden="true"
          className="relative inline-flex h-[18px] shrink-0 items-start"
          style={{ width: tilesWidth(shown.length) }}
        >
          {shown.map((app, index) => (
            <span
              key={app.slug}
              data-pill-tile={index === 0 ? "start" : index === shown.length - 1 ? "end" : "middle"}
              className={cn("box-border inline-flex size-[18px] shrink-0 rounded-[6px] p-px", index > 0 && "-ml-1.5")}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <span className="flex size-4 items-center justify-center overflow-hidden rounded-[4px] border-[0.5px] border-black/10 bg-white">
                <ServiceIcon card={{ logo: app.logo, domain: app.domain, label: app.label }} className="size-3 rounded-none text-[9px] text-neutral-600 bg-white" />
              </span>
            </span>
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

/** Shown in the sidebar's foot when nothing is connected yet: Grok Bot's
 * three (Gmail, Notion, Drive). */
const SUGGESTED_APPS: readonly PillApp[] = [
  // Google's own product marks: the favicon service answers both Gmail and
  // Drive with the plain Google "G".
  { slug: "gmail", label: "Gmail", logo: "https://ssl.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png", domain: "gmail.com" },
  { slug: "notion", label: "Notion", logo: null, domain: "notion.so" },
  { slug: "googledrive", label: "Google Drive", logo: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png", domain: "drive.google.com" },
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
    return card ? { slug: app.slug, label: card.label, logo: card.logo ?? app.logo, domain: card.domain ?? app.domain } : app;
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
  // Grok Bot's foot pill: it takes the row's width beside the avatar, 36px
  // tall, the label and the tiles centred together, 14px medium text, on
  // the rail's raised card with a hairline. Narrow, it gives up the tiles
  // before the label.
  return (
    <ConnectAppsButton
      apps={sidebarPillApps(connected, cards)}
      onOpen={onOpen}
      ariaLabel={label}
      fit
      data-tour="nav-apps"
      data-sidebar-connect-apps=""
      className="min-w-0 flex-1 border-sidebar-hairline-weak bg-sidebar-card text-[14px] text-sidebar-ink hover:bg-sidebar-elevated-hover"
    />
  );
}
