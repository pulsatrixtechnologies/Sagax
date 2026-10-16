// The compact sidebar (icons density, the collapsed rail): Grok Bot's
// "compact sidebar". Its avatars are one column, so the arrow keys move
// between them like a list (Up, Down, Home, End), on top of Tab.

/** The item to focus after `key` from `index` among `count` items; null
 * when the key is not a rail key or there is nothing to move to. From
 * outside the items (index -1), Down and Home go to the first one, Up and
 * End to the last one. The ends do not wrap. */
export function railFocusIndex(count: number, index: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return index < 0 ? 0 : Math.min(count - 1, index + 1);
    case "ArrowUp":
      return index < 0 ? count - 1 : Math.max(0, index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** What the rail's arrow keys move between: its avatar buttons and section
 * headers, in screen order, skipping anything disabled or not drawn. */
export const RAIL_ITEM_SELECTOR = 'button:not([disabled]), [role="button"][tabindex="0"]';

/** Arrow keys on the rail's list: focus the next or previous item. */
export function moveRailFocus(event: { key: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean; currentTarget: HTMLElement; target: EventTarget | null; preventDefault: () => void }): void {
  if (event.altKey || event.metaKey || event.ctrlKey) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(RAIL_ITEM_SELECTOR)]
    .filter((item) => item.getClientRects().length > 0);
  const index = items.findIndex((item) => item === event.target || item.contains(event.target as Node | null));
  const next = railFocusIndex(items.length, index, event.key);
  if (next === null || next === index) return;
  event.preventDefault();
  items[next]?.focus();
}
