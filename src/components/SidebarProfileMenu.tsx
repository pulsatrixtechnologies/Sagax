// The profile row at the very bottom of the sidebar, and the menu it opens.
//
// Everything app-level used to sit in that row as unlabelled icons crowding
// the name: a phone, an update arrow, a gear. Three icons is a guessing game
// and there was nowhere to put a fourth. They are now a menu that the row
// opens, the shape every desktop app uses for "this is about the app, not
// about what you are looking at".
//
// The row is also the sidebar's one door to its places (Team map,
// Automations, Connected apps, Templates), listed first in the same menu,
// so the footer reads like Perspicax's: an avatar and a full name. With
// places the menu opens on hover (click pins it), the way the old apps pill
// did; the collapsed rail keeps its avatar-only trigger.
//
// The update entry is the one item that reports progress in place, so it
// keeps the menu open and re-labels itself as it works.
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  Info,
  HelpCircle,
  Keyboard,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Smartphone,
} from "lucide-react";

import { InitialsAvatar } from "./Avatar";
import { AboutDialog } from "./AboutDialog";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { ShortcutHint } from "./ShortcutHint";
import { phoneSettingsAction, useSidebarPhoneStatus } from "./SidebarPhoneButton";
import { useStore } from "@/state/store";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { HELP_CENTER_URL, openExternalLink } from "@/lib/app-links";

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

/** The footer menu: the sidebar's places first, then a hairline, then the
 * profile items. Without places it is the profile menu alone. */
export function footerMenuItems(places: SidebarMenuItem[], profileItems: SidebarMenuItem[]): SidebarMenuItem[] {
  if (places.length === 0) return profileItems;
  const [first, ...rest] = profileItems;
  return first ? [...places, { ...first, separatorBefore: true }, ...rest] : places;
}

export function SidebarProfileMenu({ avatarOnly = false, places = [] }: {
  /** just the avatar, for the collapsed (icons) rail; the name moves to the
   * tooltip and the menu keeps its width */
  avatarOnly?: boolean;
  /** Team map, Automations, Connected apps and Templates: the places this
   * menu lists before the profile items, the way Perspicax's account footer
   * is the one door at the foot of its sidebar. With places the row opens on
   * hover (click pins it) and carries the tour's `tools` anchor. */
  places?: SidebarMenuItem[];
}) {
  const { state, dispatch } = useStore();
  const phone = useSidebarPhoneStatus();
  const update = useUpdateItem();
  const [aboutOpen, setAboutOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

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

  const profileItems: SidebarMenuItem[] = [
    {
      key: "phone",
      label: phone.pairedCount ? t("sidebar.menu.yourPhone") : t("sidebar.menu.getIos"),
      icon: <Smartphone size={18} />,
      trailing:
        phone.kind === "connected" ? (
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
        ) : undefined,
      onSelect: () => dispatch(phoneSettingsAction()),
    },
    {
      key: "settings",
      label: t("sidebar.menu.settings"),
      icon: <SettingsIcon size={18} />,
      onSelect: () => dispatch({ type: "toggleAppSettings" }),
    },
    {
      key: "shortcuts",
      label: "Keyboard shortcuts",
      icon: <Keyboard size={18} />,
      trailing: <ShortcutHint id="shortcuts-cheat-sheet" />,
      onSelect: () => {
        // The menu item unmounts; let the dialog restore the profile button.
        triggerRef.current?.closest("button")?.focus();
        dispatch({ type: "toggleShortcuts", open: true });
      },
    },
    ...(update ? [update.item] : []),
    {
      key: "about",
      label: t("sidebar.menu.about"),
      icon: <Info size={18} />,
      separatorBefore: true,
      onSelect: () => setAboutOpen(true),
    },
    {
      key: "help",
      label: t("sidebar.menu.help"),
      icon: <HelpCircle size={18} />,
      onSelect: () => void openExternalLink(HELP_CENTER_URL),
    },
  ];
  const items = footerMenuItems(places, profileItems);
  const noteworthy = update && updateNoteworthy(update.phase, update.pending) ? update : null;
  // the dot that used to ride the apps pill: a place asking for attention
  // (a failed automation) while the menu is folded away
  const placeAttention = places.some((item) => item.attention);

  const avatar = (size: number) => (
    // the footer avatar rests tinted and shows its real colours on hover,
    // focus or while its menu is open (.footer-tint)
    <span className="footer-tint flex shrink-0 rounded-full">
      {profile?.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" style={{ width: size, height: size }} className="rounded-full object-cover" />
      ) : (
        <InitialsAvatar initials={initials} size={size} />
      )}
    </span>
  );

  return (
    <>
      <SidebarPopoverMenu
        items={items}
        ariaLabel={name}
        tourId={places.length > 0 ? "tools" : undefined}
        openOnHover={places.length > 0}
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
            className={cn(
              "flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
              open ? "bg-sidebar-hover" : "hover:bg-sidebar-hover",
            )}
          >
            {avatar(28)}
            <span title={name} className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-sidebar-ink">{name}</span>
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
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
