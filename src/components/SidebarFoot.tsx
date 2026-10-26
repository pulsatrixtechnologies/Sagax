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
// The row measures its own name: when it is cut, it stacks, and it goes back
// to inline only once the width it measured is there again.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import { connectedAppItems, FOOT_APP_LOGOS } from "@/lib/connected-apps";
import type { PluginItem } from "@/lib/plugins-model";
import { PluginIcon } from "./plugins/PluginParts";
import { SidebarProfileMenu, SidebarRoutinesBadge } from "./SidebarProfileMenu";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";
import { SidebarUpdatePill, updatePillView } from "./SidebarUpdatePill";
import { useUpdaterState } from "@/lib/updater";

/** The connected apps, read from the same routes as the Connect apps panel;
 * read again each time that panel closes (what was just connected shows). */
export function useConnectedApps(): PluginItem[] {
  const { state } = useStore();
  const [apps, setApps] = useState<PluginItem[]>([]);
  const panelOpen = state.pluginsOpen;
  useEffect(() => {
    if (panelOpen) return;
    let cancelled = false;
    void Promise.all([
      api("/api/mcp/servers").catch(() => null),
      api("/api/plugins/search").catch(() => null),
    ]).then(([servers, search]) => {
      if (cancelled) return;
      setApps(connectedAppItems({ servers: servers?.servers ?? [], featured: search?.featured ?? [] }));
    });
    return () => { cancelled = true; };
  }, [panelOpen]);
  return apps;
}

/** The logos, overlapping. Brand marks sit on white whatever the theme. */
export function ConnectedAppsStack({ apps }: { apps: readonly PluginItem[] }) {
  return (
    <span data-connected-apps-stack="" className="flex shrink-0 items-center -space-x-[9px]" aria-hidden="true">
      {apps.slice(0, FOOT_APP_LOGOS).map((app) => (
        <span key={app.key} data-connected-app={app.key} className="flex size-[15px] items-center justify-center overflow-hidden rounded-full bg-white ring-[1.5px] ring-sidebar-card">
          <PluginIcon item={app} className="size-[11px] rounded-full" />
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

/** inline while the name fits; stacked once it is cut. */
function useFootMode(rowRef: React.RefObject<HTMLDivElement | null>, resetKey: string): FootMode {
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
  }, [mode, rowRef, resetKey]);
  return mode;
}

/** The Connect apps button of the foot: inline, only the logos (the generic
 * puzzle when none is connected); stacked, its words then the logos. */
export function FootConnectApps({ apps, mode, onOpen }: { apps: readonly PluginItem[]; mode: FootMode; onOpen: () => void }) {
  const label = t("chat.connectApps.pill");
  const stacked = mode === "stacked";
  return (
    <button
      type="button"
      data-tour="nav-apps"
      data-sidebar-connect-apps=""
      data-connect-apps-layout={mode}
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-[var(--foot-tile-h,2.25rem)] items-center rounded-full border border-sidebar-hairline-weak bg-sidebar-card text-sidebar-ink-secondary transition-colors hover:bg-sidebar-elevated-hover hover:text-sidebar-ink",
        stacked ? "min-w-max flex-1 gap-2 px-3 text-[13px] font-medium" : "shrink-0 px-1.5",
      )}
    >
      {apps.length === 0 && <Puzzle size={16} aria-hidden="true" className="shrink-0" />}
      {stacked && <span data-connect-apps-label="" className="shrink-0 whitespace-nowrap">{label}</span>}
      {apps.length > 0 && <ConnectedAppsStack apps={apps} />}
    </button>
  );
}

export function SidebarFoot({ places, onOpenApps }: { places?: SidebarMenuItem[]; onOpenApps: () => void }) {
  const { state } = useStore();
  const apps = useConnectedApps();
  const rowRef = useRef<HTMLDivElement>(null);
  const name = state.config?.profile?.name ?? "";
  const hasUpdate = updatePillView(useUpdaterState()) !== null;
  const mode = useFootMode(rowRef, `${name}|${apps.map((app) => app.key).join(",")}|${hasUpdate}`);
  const stacked = mode === "stacked";
  return (
    <div
      ref={rowRef}
      data-sidebar-account-row
      className={cn("flex items-center gap-1.5 [container-type:inline-size]", stacked && "flex-wrap")}
      data-foot-mode={mode}
    >
      {stacked ? <SidebarProfileMenu avatarOnly places={places} /> : <SidebarProfileMenu avatarOnly withName places={places} />}
      {/* with the wide update button in the row, the apps pill keeps to its
          logos (the update takes the room, in the same row) */}
      <FootConnectApps apps={apps} mode={stacked && hasUpdate ? "inline" : mode} onOpen={onOpenApps} />
      {/* a waiting update: the compact circle beside the profile, the wide
          one with its word once the profile is the avatar alone */}
      <SidebarUpdatePill layout={stacked ? "wide" : "compact"} />
      <SidebarRoutinesBadge />
    </div>
  );
}
