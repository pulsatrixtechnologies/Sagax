// The sidebar's foot (reference design, 2026-10-26). Two states, picked by
// the room the row has:
//   - inline: a rounded pill with the avatar and the FULL name, then a small
//     rounded pill with only the logos of the connected apps, overlapping
//     (the generic puzzle when none is connected). The update button is a
//     compact circle beside them.
//   - stacked: the name no longer fits, so the profile is the avatar alone,
//     followed by a wide "Connect apps" pill and the same logos; the update
//     button is the wide one, with its word. It wraps under rather than
//     cutting the name or covering a neighbour (#1039).
// Hovering (or focusing) the apps pill, or the update button, folds the
// profile to the avatar alone and lets that pill take the row, animated over
// 200 ms; leaving puts everything back. Reduced motion: no animation.
// The row measures its own name: when it is cut, it stacks, and it goes back
// to inline only once the width it measured is there again.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import { connectedAppItems, FOOT_APP_LOGOS, type AccountConnector } from "@/lib/connected-apps";
import type { PluginItem } from "@/lib/plugins-model";
import { PluginIcon } from "./plugins/PluginParts";
import { SidebarProfileMenu, SidebarRoutinesBadge } from "./SidebarProfileMenu";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";
import { SidebarUpdatePill, updatePillView } from "./SidebarUpdatePill";
import { useUpdaterState } from "@/lib/updater";

/** The connected apps, read from the same routes as the Connect apps panel
 * (its MCP servers, its catalog, and the Providers list's connectors of the
 * person's own Claude account); read again each time that panel closes
 * (what was just connected shows). The account's connectors can take a while
 * (the engine is asked): the servers show first, the connectors join them. */
export function useConnectedApps(): PluginItem[] {
  const { state } = useStore();
  const [apps, setApps] = useState<PluginItem[]>([]);
  const panelOpen = state.pluginsOpen;
  useEffect(() => {
    if (panelOpen) return;
    let cancelled = false;
    let servers: { servers?: unknown; featured?: unknown } = {};
    let account: AccountConnector[] = [];
    const publish = () => {
      if (cancelled) return;
      setApps(connectedAppItems({
        servers: (servers.servers as Parameters<typeof connectedAppItems>[0]["servers"]) ?? [],
        featured: (servers.featured as Parameters<typeof connectedAppItems>[0]["featured"]) ?? [],
        account,
      }));
    };
    void Promise.all([
      api("/api/mcp/servers").catch(() => null),
      api("/api/plugins/search").catch(() => null),
    ]).then(([mcp, search]) => {
      servers = { servers: mcp?.servers ?? [], featured: search?.featured ?? [] };
      publish();
    });
    void api(HARNESS_CONNECTORS_ROUTE, { timeoutMs: 90_000 }).then((answer) => {
      account = answer?.claude?.available && Array.isArray(answer.claude.connectors) ? answer.claude.connectors : [];
      publish();
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [panelOpen]);
  return apps;
}

/** The connectors of the person's own Claude account (server/harness-connectors.ts). */
const HARNESS_CONNECTORS_ROUTE = "/api/me/harness-connectors";

/** The logos, overlapping. Brand marks sit on white whatever the theme. */
export function ConnectedAppsStack({ apps }: { apps: readonly PluginItem[] }) {
  return (
    <span data-connected-apps-stack="" className="flex shrink-0 items-center -space-x-[8px]" aria-hidden="true">
      {apps.slice(0, FOOT_APP_LOGOS).map((app) => (
        <span key={app.key} data-connected-app={app.key} className="flex size-[16px] items-center justify-center overflow-hidden rounded-full bg-white ring-[1.5px] ring-sidebar-card">
          <PluginIcon item={app} className="size-[12px] rounded-full" />
        </span>
      ))}
    </span>
  );
}

export type FootMode = "inline" | "stacked";

/** The next mode for what was measured: `cut` is how many px of the name the
 * row clips (0: it shows whole), `need` the row width that was missing when
 * it last stacked. Stacks only when the name is cut; goes back to inline once
 * the row is as wide as it measured it needed. */
export function nextFootMode(mode: FootMode, m: { width: number; cut: number; need: number | null }): { mode: FootMode; need: number | null } {
  if (mode === "inline") {
    return m.cut >= 1 ? { mode: "stacked", need: m.width + m.cut } : { mode, need: m.need };
  }
  return m.need !== null && m.width >= m.need ? { mode: "inline", need: m.need } : { mode, need: m.need };
}

/** Which control of the foot the pointer or the keyboard is on. */
export type FootHot = "apps" | "update" | null;

/** The foot is "expanded" (profile folded to the avatar, the hot control
 * taking the room) only in its inline state: stacked already is that. */
export const footExpanded = (hot: FootHot, mode: FootMode): boolean => hot !== null && mode === "inline";

/** Milliseconds the foot's expand and fold animations take. */
export const FOOT_EXPAND_MS = 200;

/** true while hot, and for the length of the fold-back animation after it,
 * so the name is not measured while it is still coming back. */
function useSettling(hot: boolean): boolean {
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (hot) { setSettling(true); return; }
    const timer = setTimeout(() => setSettling(false), FOOT_EXPAND_MS + 60);
    return () => clearTimeout(timer);
  }, [hot]);
  return hot || settling;
}

/** inline while the name fits; stacked once it is cut. */
function useFootMode(rowRef: React.RefObject<HTMLDivElement | null>, resetKey: string, paused: boolean): FootMode {
  const [mode, setMode] = useState<FootMode>("inline");
  const need = useRef<number | null>(null);
  // what the row holds changed (name, apps, update): measure again from inline
  useLayoutEffect(() => {
    need.current = null;
    setMode("inline");
  }, [resetKey]);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const check = () => {
      // the name folds away while the foot is hovered: that is not "cut"
      if (paused) return;
      const name = mode === "inline" ? row.querySelector<HTMLElement>("[data-account-pill-name]") : null;
      const next = nextFootMode(mode, { width: row.clientWidth, cut: name ? name.scrollWidth - name.clientWidth : 0, need: need.current });
      need.current = next.need;
      if (next.mode !== mode) setMode(next.mode);
    };
    check();
    // the web font arriving widens the name without resizing the row
    void document.fonts?.ready.then(check);
    document.fonts?.addEventListener?.("loadingdone", check);
    if (typeof ResizeObserver === "undefined") return () => document.fonts?.removeEventListener?.("loadingdone", check);
    const observer = new ResizeObserver(check);
    observer.observe(row);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", check);
    };
  }, [mode, rowRef, resetKey, paused]);
  return mode;
}

/** The Connect apps button of the foot: inline, only the logos (the generic
 * puzzle when none is connected); stacked or expanded (hovered), its words
 * then the logos, taking the room the row leaves it. */
export function FootConnectApps({ apps, mode, expanded = false, onOpen, onHot }: {
  apps: readonly PluginItem[];
  mode: FootMode;
  expanded?: boolean;
  onOpen: () => void;
  onHot?: (hot: boolean) => void;
}) {
  const label = t("chat.connectApps.pill");
  const stacked = mode === "stacked";
  const wide = stacked || expanded;
  // the words stay mounted while the pill folds back, so they leave smoothly
  const [leaving, setLeaving] = useState(false);
  const wasWide = useRef(wide);
  useEffect(() => {
    if (wasWide.current && !wide) {
      setLeaving(true);
      const timer = setTimeout(() => setLeaving(false), FOOT_EXPAND_MS);
      wasWide.current = wide;
      return () => clearTimeout(timer);
    }
    wasWide.current = wide;
  }, [wide]);
  const showLabel = wide || leaving;
  return (
    <button
      type="button"
      data-tour="nav-apps"
      data-sidebar-connect-apps=""
      data-connect-apps-layout={mode}
      data-expanded={expanded ? "" : undefined}
      onClick={onOpen}
      onMouseEnter={onHot && !stacked ? () => onHot(true) : undefined}
      onMouseLeave={onHot && !stacked ? () => onHot(false) : undefined}
      onFocus={onHot && !stacked ? (event) => { if (event.currentTarget.matches(":focus-visible")) onHot(true); } : undefined}
      onBlur={onHot && !stacked ? () => onHot(false) : undefined}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-[var(--foot-tile-h,2.25rem)] items-center rounded-full border border-sidebar-hairline-weak bg-sidebar-card text-sidebar-ink-secondary transition-colors hover:bg-sidebar-elevated-hover hover:text-sidebar-ink",
        stacked ? "min-w-max flex-1 gap-2 px-3 text-[13px] font-medium" : "shrink-0 px-1",
      )}
    >
      {apps.length === 0 && <Puzzle size={16} aria-hidden="true" className="shrink-0" />}
      {showLabel && (
        <span data-connect-apps-label="" className="shrink-0 whitespace-nowrap" data-leaving={!wide ? "" : undefined}>{label}</span>
      )}
      {apps.length > 0 && <ConnectedAppsStack apps={apps} />}
    </button>
  );
}

export function SidebarFoot({ places, onOpenApps, defaultHot = null }: { places?: SidebarMenuItem[]; onOpenApps: () => void; defaultHot?: FootHot }) {
  const { state } = useStore();
  const apps = useConnectedApps();
  const rowRef = useRef<HTMLDivElement>(null);
  const name = state.config?.profile?.name ?? "";
  const hasUpdate = updatePillView(useUpdaterState()) !== null;
  const [hot, setHot] = useState<FootHot>(defaultHot);
  const paused = useSettling(hot !== null);
  const mode = useFootMode(rowRef, `${name}|${apps.map((app) => app.key).join(",")}|${hasUpdate}`, paused);
  const stacked = mode === "stacked";
  const expanded = footExpanded(hot, mode);
  // one control at a time: leaving another one must not clear this one
  const hotOn = (which: Exclude<FootHot, null>) => (on: boolean) => setHot((current) => (on ? which : current === which ? null : current));
  return (
    <div
      ref={rowRef}
      data-sidebar-account-row
      className={cn("-mx-1.5 flex items-center gap-1.5 [container-type:inline-size]", stacked && "flex-wrap")}
      data-foot-mode={mode}
      data-foot-hot={expanded ? hot : undefined}
    >
      {stacked ? <SidebarProfileMenu avatarOnly places={places} /> : <SidebarProfileMenu avatarOnly withName places={places} />}
      {/* with the wide update button in the row, the apps pill keeps to its
          logos (the update takes the room, in the same row); hovered, it
          takes the whole row instead and the profile folds to the avatar */}
      <FootConnectApps apps={apps}
        mode={stacked && hasUpdate ? "inline" : mode}
        expanded={expanded && hot === "apps"}
        onOpen={onOpenApps}
        onHot={hotOn("apps")}
      />
      {/* a waiting update: the compact circle beside the profile; hovered,
          or once the profile is the avatar alone, the wide one with its word */}
      <SidebarUpdatePill layout={stacked || (expanded && hot === "update") ? "wide" : "compact"} onHot={stacked ? undefined : hotOn("update")} />
      <SidebarRoutinesBadge />
    </div>
  );
}
