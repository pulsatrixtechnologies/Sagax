// The sidebar's places, always in view at its foot: Team map, Automations,
// Connected apps and Templates, directly above the account row.
//
// They used to fold into the account row's menu. Four pages you go to every
// day are not account settings, and a menu hides the one thing a place has to
// say (a failed automation), so they are rows again, laid out like
// Perspicax's nav items: a line icon, the label, a rounded hover pill, the
// active page lit. No section title, no collapse: four rows are cheaper than
// the gesture it takes to reveal them. The collapsed rail shows the same
// places as icon buttons with tooltips.
//
// The stack carries the tour's `tools` anchor; Connected apps and
// Automations keep `nav-apps` and `nav-automations`.
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

export interface SidebarPlace {
  key: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  /** something here needs the person (a failed automation run) */
  attention?: boolean;
  /** at the trailing edge of a full row (the Connected apps marks) */
  trailing?: React.ReactNode;
  /** `data-tour` id for the row */
  tourId?: string;
  onSelect: () => void;
}

export function SidebarPlaces({ places, iconOnly = false }: { places: SidebarPlace[]; iconOnly?: boolean }) {
  if (places.length === 0) return null;
  return (
    <div data-tour="tools" data-sidebar-places className={cn("flex flex-col", iconOnly ? "gap-1 pb-1" : "gap-0.5 pb-1.5")}>
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
              iconOnly ? "min-h-10 justify-center px-2 py-2" : "h-8 gap-2.5 px-2",
              place.active
                ? "bg-sidebar-selected font-medium text-sidebar-ink"
                : "text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink",
            )}
          >
            <Icon size={20} strokeWidth={1.75} aria-hidden="true" className={cn("shrink-0", place.active && "text-accent")} />
            {!iconOnly && <span className="min-w-0 flex-1 truncate text-[13px] leading-5">{place.label}</span>}
            {!iconOnly && place.trailing}
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
  );
}
