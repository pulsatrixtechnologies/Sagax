// The profile row at the very bottom of the sidebar, and the menu it opens.
//
// The row is an avatar and a full name. Under the name, a quiet line counts
// the viewer's active routines (the routines icon and a number); it opens
// Automations and shares the row's rounded highlight. With no active routine
// the line is gone and the name sits centred beside the avatar. The sidebar
// never shows achievement titles or points: those live in a person's detail
// and on Settings > Achievements. The menu leads with Team map and
// Automations, then a hairline, then settings. Archived bots, when there
// are any, sit above that pair with their own hairline. Your phone and
// Help Center are not in this menu: the phone stays in Settings and on
// the collapsed rail, and docs stay on About. Connected apps and Templates
// stay rows above this one when they are on (SidebarPlaces). It opens on
// click. The collapsed rail keeps its own avatar button.
//
// The update entry is the one item that reports progress in place, so it
// keeps the menu open and re-labels itself as it works. A failed automation
// tints the routines count red while the menu is closed, and keeps its dot
// on the Automations item inside the menu.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  CalendarClock,
  CalendarDays,
  Check,
  Info,
  Keyboard,
  Loader2,
  Network,
  RefreshCw,
  Settings as SettingsIcon,
  Trophy,
} from "lucide-react";

import { InitialsAvatar } from "./Avatar";
import { AboutDialog } from "./AboutDialog";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { ShortcutHint } from "./ShortcutHint";
import { useStore } from "@/state/store";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAchievements } from "@/lib/achievements";
import { isRoutineProblemRun } from "@/lib/routines";
import { activeRoutineCount } from "@/lib/active-routines";
import { viewerActorId } from "@/lib/viewer";

/** "Milind Soni" → "MS", "milind" → "M", "you@x.dev" → "Y", unset → "?" */
export function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

/** The name shown on the row: the profile name, else the email, else "You". */
export function profileLabel(profile?: { name?: string; email?: string }): string {
  return profile?.name?.trim() || profile?.email?.trim() || t("sidebar.profile.you");
}

export type UpdatePhase =
  | UpdaterState["status"]
  /** a check came back with nothing — acknowledged for three seconds so the
   * click is never silent */
  | "up-to-date";

/** One state machine for the update entry, kept pure so the label/verb pairs
 * can be tested without a bridge. `upToDate` is the 3s acknowledgement after
 * a check that found nothing — otherwise a check is silent. */
export function updatePhase(state: UpdaterState | null, upToDate: boolean): UpdatePhase {
  const status = state?.status ?? "idle";
  if (status !== "idle") return status;
  return upToDate ? "up-to-date" : "idle";
}

export function updateLabel(phase: UpdatePhase, state: UpdaterState | null): string {
  switch (phase) {
    case "available":
      // an unknown version leaves a double space behind, in every language
      return t("sidebar.update.available", { version: state?.version ?? "" }).replace("  ", " ");
    case "downloading":
      return state?.percent == null
        ? t("sidebar.update.startingDownload")
        : t("sidebar.update.downloading", { percent: Math.round(state.percent) });
    case "preparing":
      return t("sidebar.update.preparing");
    case "downloaded":
      return (
        state?.installMode === "handoff"
          ? t("sidebar.update.readyInstall", { version: state?.version ?? "" })
          : t("sidebar.update.ready", { version: state?.version ?? "" })
      ).replace("  ", " ");
    case "installing":
      return (
        state?.message ||
        (state?.installMode === "handoff"
          ? t("sidebar.update.openingTerminal")
          : t("sidebar.update.installing"))
      );
    case "checking":
      return t("sidebar.update.checking");
    case "handed-off":
      return t("sidebar.update.handedOff");
    case "error":
      return state?.message?.trim() || t("sidebar.update.failed");
    case "up-to-date":
      return t("sidebar.update.upToDate");
    default:
      return t("sidebar.update.check");
  }
}

/** A phase that is mid-flight takes no further clicks. `pending` covers the
 * gap between the click and the bridge reporting the state it started: both
 * download and install round-trip through main first, and without this the
 * row would sit there looking clickable. */
export function updateBusy(phase: UpdatePhase, pending = false): boolean {
  return pending || phase === "checking" || phase === "downloading" || phase === "preparing" || phase === "installing";
}

function UpdateIcon({ phase, pending, size = 18 }: { phase: UpdatePhase; pending: boolean; size?: number }) {
  if (updateBusy(phase, pending)) return <Loader2 size={size} className="animate-spin" />;
  if (phase === "up-to-date") return <Check size={size} />;
  if (phase === "available" || phase === "downloaded") return <ArrowDownToLine size={size} />;
  return <RefreshCw size={size} />;
}

/** Whether the updater has something the profile row should say out loud.
 * An idle updater, and the three-second "up to date" tick that follows a
 * check the user asked for from inside the menu, both stay in the menu. */
export function updateNoteworthy(phase: UpdatePhase, pending = false): boolean {
  return pending || (phase !== "idle" && phase !== "up-to-date" && phase !== "checking");
}

interface UpdateEntry {
  item: SidebarMenuItem;
  phase: UpdatePhase;
  pending: boolean;
  label: string;
}

/** The updater bridge exists only in the packaged app; in dev the entry is
 * absent rather than dead. */
function useUpdateItem(): UpdateEntry | null {
  const state = useUpdaterState();
  const updater = window.ogb?.updater;
  const [pending, setPending] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const status = state?.status ?? "idle";

  // download and install both round-trip through main before the status
  // changes — spin on the click itself, and let the new status clear it
  useEffect(() => setPending(false), [status]);

  // a check that found nothing lands back on idle — acknowledge it for 3s
  const upToDate = Boolean(checkedAt) && (!state || state.status === "idle") && Date.now() - checkedAt < 3000;
  useEffect(() => {
    if (!upToDate) return;
    const timer = setTimeout(() => setCheckedAt(0), 3000);
    return () => clearTimeout(timer);
  }, [upToDate]);

  if (!updater) return null;

  const phase = updatePhase(state, upToDate);
  const label = updateLabel(phase, state);
  return {
    phase,
    pending,
    label,
    item: {
      key: "update",
      label,
      icon: <UpdateIcon phase={phase} pending={pending} />,
      disabled: updateBusy(phase, pending) || state?.retryable === false,
      // progress is reported on the row itself, so the menu stays put
      keepOpen: true,
      attention: phase === "downloaded" || phase === "error",
      attentionTone: phase === "error" ? "danger" : "accent",
      onSelect: () => {
        if (phase === "downloaded") {
          setPending(true);
          return void updater.install();
        }
        if (phase === "available") {
          setPending(true);
          return void updater.download();
        }
        setCheckedAt(Date.now());
        void updater.check();
      },
    },
  };
}

/** The footer menu: account-level places (Archived bots) first, then a
 * hairline, then the profile items. Without them it is the profile menu
 * alone. */
export function footerMenuItems(places: SidebarMenuItem[], profileItems: SidebarMenuItem[]): SidebarMenuItem[] {
  if (places.length === 0) return profileItems;
  const [first, ...rest] = profileItems;
  return first ? [...places, { ...first, separatorBefore: true }, ...rest] : places;
}

export interface ProfileMenuHandlers {
  onTeamMap: () => void;
  onAutomations: () => void;
  onSettings: () => void;
  onAchievements: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
}

/** Team map, Automations, a hairline, then the account items. Phone and
 * Help Center are not offered here. */
export function profileMenuItems(input: {
  teamMapLabel: string;
  automationsLabel: string;
  settingsLabel: string;
  achievementsLabel: string | null;
  aboutLabel: string;
  teamMapActive: boolean;
  automationsActive: boolean;
  routineAttention: boolean;
  shortcutsTrailing?: ReactNode;
  updateItem: SidebarMenuItem | null;
  handlers: ProfileMenuHandlers;
}): SidebarMenuItem[] {
  return [
    {
      key: "team-map",
      label: input.teamMapLabel,
      icon: <Network size={18} />,
      active: input.teamMapActive,
      onSelect: input.handlers.onTeamMap,
    },
    {
      key: "routines",
      tourId: "nav-automations",
      label: input.automationsLabel,
      icon: <CalendarDays size={18} />,
      active: input.automationsActive,
      attention: input.routineAttention,
      onSelect: input.handlers.onAutomations,
    },
    {
      key: "settings",
      label: input.settingsLabel,
      icon: <SettingsIcon size={18} />,
      separatorBefore: true,
      onSelect: input.handlers.onSettings,
    },
    ...(input.achievementsLabel
      ? [{
          key: "achievements",
          label: input.achievementsLabel,
          icon: <Trophy size={18} />,
          onSelect: input.handlers.onAchievements,
        }]
      : []),
    {
      key: "shortcuts",
      label: "Keyboard shortcuts",
      icon: <Keyboard size={18} />,
      trailing: input.shortcutsTrailing,
      onSelect: input.handlers.onShortcuts,
    },
    ...(input.updateItem ? [input.updateItem] : []),
    {
      key: "about",
      label: input.aboutLabel,
      icon: <Info size={18} />,
      separatorBefore: true,
      onSelect: input.handlers.onAbout,
    },
  ];
}

export function SidebarProfileMenu({ avatarOnly = false, places = [] }: {
  /** just the avatar, for the collapsed (icons) rail; the name moves to the
   * tooltip and the menu keeps its width */
  avatarOnly?: boolean;
  /** Items listed before the profile items (Archived bots). */
  places?: SidebarMenuItem[];
}) {
  const { state, dispatch } = useStore();
  const update = useUpdateItem();
  const [aboutOpen, setAboutOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const achievements = useAchievements();
  const openAchievements = () => dispatch({ type: "toggleAppSettings", open: true, section: "achievements" });
  // No title and no points here, ever: the line under the name counts the
  // viewer's active routines, and is gone at zero.
  const activeRoutines = activeRoutineCount(state.routines, state.bots, viewerActorId(state.config));
  const showLine = activeRoutines > 0;

  const profile = state.config?.profile;
  const viewer = state.config?.viewer;
  // the server fills the profile with whoever is looking; an older server
  // that only names the viewer still gets their name on the row
  const name = profileLabel({
    name: profile?.name?.trim() || viewer?.name?.trim(),
    email: profile?.email?.trim() || viewer?.email?.trim(),
  });
  const initials = profileInitials({
    name: profile?.name?.trim() || viewer?.name?.trim(),
    email: profile?.email?.trim() || viewer?.email?.trim(),
  });

  const routineAttention = state.routineRuns.some((run) => isRoutineProblemRun(run) && !run.seenAt);
  const profileItems = profileMenuItems({
    teamMapLabel: t("sidebar.nav.teamMap"),
    automationsLabel: t("sidebar.nav.automations"),
    settingsLabel: t("sidebar.menu.settings"),
    achievementsLabel: achievements.status === "ready" ? t("achievements.menu") : null,
    aboutLabel: t("sidebar.menu.about"),
    teamMapActive: state.activeView === "team-map",
    automationsActive: state.activeView === "routines",
    routineAttention,
    shortcutsTrailing: <ShortcutHint id="shortcuts-cheat-sheet" />,
    updateItem: update?.item ?? null,
    handlers: {
      onTeamMap: () => dispatch({ type: "showTeamMap" }),
      onAutomations: () => dispatch({ type: "showRoutines" }),
      onSettings: () => dispatch({ type: "toggleAppSettings" }),
      onAchievements: openAchievements,
      onShortcuts: () => {
        // The menu item unmounts; let the dialog restore the profile button.
        triggerRef.current?.closest("button")?.focus();
        dispatch({ type: "toggleShortcuts", open: true });
      },
      onAbout: () => setAboutOpen(true),
    },
  });
  const items = footerMenuItems(places, profileItems);
  const noteworthy = update && updateNoteworthy(update.phase, update.pending) ? update : null;
  // a place in the menu asking for attention while the menu is folded away
  // (a failed automation tints the routines count instead)
  const placeAttention = places.some((item) => item.attention);

  const avatar = (size: number) => (
    // the footer avatar, always in its real colours
    <span className="flex shrink-0 rounded-full">
      {profile?.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" style={{ width: size, height: size }} className="rounded-full object-cover" />
      ) : (
        <InitialsAvatar initials={initials} size={size} />
      )}
    </span>
  );

  // The routines count opens Automations, so it stays outside the menu
  // button. The highlight is the wrapper around both, one rounded block.
  const accountRow = (
    <SidebarPopoverMenu
      items={items}
      ariaLabel={name}
      menuClassName={avatarOnly ? "left-0 w-64" : undefined}
      renderTrigger={({ open }) => avatarOnly ? (
        <span
          ref={triggerRef}
          title={name}
          className={cn(
            "relative flex size-9 items-center justify-center rounded-full transition-[filter]",
            open ? "ring-2 ring-accent/60" : "hover:brightness-90",
          )}
        >
          {avatar(36)}
          {noteworthy && (
            <span
              title={noteworthy.label}
              aria-label={noteworthy.label}
              className={cn(
                "absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-sidebar",
                noteworthy.phase === "error" ? "bg-danger" : "bg-accent",
              )}
            />
          )}
        </span>
      ) : (
        // One row, like Perspicax's account footer: the avatar and the full
        // name, which ellipsizes only when it truly runs out of room.
        <span
          ref={triggerRef}
          data-sidebar-account
          className={cn("flex w-full min-w-0 gap-2.5 text-left", showLine ? "items-start" : "items-center")}
        >
          {avatar(40)}
          <span className={cn("flex min-w-0 flex-1 flex-col", showLine && "pt-0.5")}>
            <span title={name} className="min-w-0 truncate text-[14px] font-medium leading-[18px] text-sidebar-ink">{name}</span>
          </span>
          {/* an update is the one thing worth interrupting the name for, so
            * it sits on the row rather than waiting to be found in the menu */}
          {noteworthy && (
            <span
              title={noteworthy.label}
              aria-label={noteworthy.label}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                noteworthy.phase === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent",
              )}
            >
              <UpdateIcon phase={noteworthy.phase} pending={noteworthy.pending} size={14} />
            </span>
          )}
          {placeAttention && !open && (
            <span data-testid="footer-attention" aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
          )}
        </span>
      )}
    />
  );
  const routinesLabel = t(
    routineAttention
      ? (activeRoutines === 1 ? "sidebar.profile.activeRoutinesOneAttention" : "sidebar.profile.activeRoutinesAttention")
      : (activeRoutines === 1 ? "sidebar.profile.activeRoutinesOne" : "sidebar.profile.activeRoutines"),
    { count: activeRoutines },
  );
  const routinesLine = showLine && !avatarOnly ? (
    // 46px lines the icon up with the name: 40px avatar, 10px gap, minus the
    // button's 4px padding. The pull-up sits the line a few pixels closer to
    // the name, without collapsing it.
    <div className="-mt-[21px] flex min-w-0 items-center pl-[46px]" data-routines-line="">
      <button
        type="button"
        data-active-routines={activeRoutines}
        data-attention={routineAttention ? "" : undefined}
        title={routinesLabel}
        aria-label={routinesLabel}
        onClick={(event) => {
          event.stopPropagation();
          dispatch({ type: "showRoutines" });
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md px-1 text-[13px] leading-[18px] tabular-nums hover:bg-sidebar-hover",
          routineAttention ? "text-danger" : "text-sidebar-ink-secondary hover:text-sidebar-ink",
        )}
      >
        <CalendarClock size={13} strokeWidth={2.2} aria-hidden="true" />
        <span>{activeRoutines}</span>
      </button>
    </div>
  ) : null;

  return (
    <div className="relative">
      {avatarOnly ? accountRow : (
        <div
          data-sidebar-account-row=""
          className="rounded-lg px-2 py-1.5 transition-colors hover:bg-sidebar-hover has-[[aria-expanded=true]]:bg-sidebar-hover"
        >
          {accountRow}
          {routinesLine}
        </div>
      )}
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
