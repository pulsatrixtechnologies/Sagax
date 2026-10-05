// Rows at the foot of the sidebar, above the account row. Connected apps
// and Templates land here when their experimental flags are on. Team map
// and Automations are in the account menu (SidebarProfileMenu). A failed
// automation dots that row while the menu is closed.
//
// What remains is laid out like Perspicax's nav items: a line icon, the
// label, a rounded hover pill, the active page lit. No section title, no
// collapse. The collapsed rail shows the same rows as icon buttons with
// tooltips.
//
// Collapsing the sidebar must not move them: both layouts share one row
// height, one gap and one hairline under the stack (PLACE_ROW, PLACES_STACK,
// PLACES_DIVIDER), and the footer anchors them to the bottom above an
// account row of the same height, so every icon keeps its exact y. Only the
// horizontal layout differs (a label beside the icon, or the icon centred).
// The hairline sets the places apart from the account zone below, the way a
// group ends in Perspicax's sidebar.
//
// The stack carries the tour's `tools` anchor when it has rows. Connected
// apps keeps `nav-apps`. When the stack is empty the sidebar foot carries
// `tools` instead, so the tour still has a target.
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

export interface SidebarPlace {
  key: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  /** something here needs the person (a failed automation run) */
  attention?: boolean;
  /** `data-tour` id for the row */
  tourId?: string;
  onSelect: () => void;
}

/** The stack, the same in both layouts. */
export const PLACES_STACK = "flex flex-col gap-0.5";
/** One row's vertical metrics, the same in both layouts. */
export const PLACE_ROW = "h-9 py-0";
/** The hairline between the places and the account row, in both layouts. */
export const PLACES_DIVIDER = "mx-2 my-2 h-px shrink-0 bg-sidebar-hairline";

export function SidebarPlaces({ places, iconOnly = false }: { places: SidebarPlace[]; iconOnly?: boolean }) {
  if (places.length === 0) return null;
  return (
    <>
      <div data-tour="tools" data-sidebar-places className={PLACES_STACK}>
        {places.map((place) => {
          const Icon = place.icon;
          return (
            <button
              key={place.key}
              type="button"
              data-tour={place.tourId}
              data-sidebar-place={place.key}
              onClick={place.onSelect}
              aria-current={place.active ? "page" : undefined}
              aria-label={iconOnly ? place.label : undefined}
              title={iconOnly ? place.label : undefined}
              className={cn(
                "group relative flex w-full items-center rounded-lg text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                PLACE_ROW,
                iconOnly ? "justify-center px-2" : "gap-2.5 px-2",
                place.active
                  ? "bg-sidebar-selected font-medium text-sidebar-ink"
                  : "text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink",
              )}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" className={cn("shrink-0", place.active && "text-accent")} />
              {!iconOnly && <span className="min-w-0 flex-1 truncate text-[13px] leading-5">{place.label}</span>}
              {place.attention && (
                <span
                  data-testid={`place-attention-${place.key}`}
                  aria-hidden="true"
                  className={cn("size-2 shrink-0 rounded-full bg-danger", iconOnly && "absolute right-2 top-2")}
                />
              )}
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" data-sidebar-foot-divider className={PLACES_DIVIDER} />
    </>
  );
}
