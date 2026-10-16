// Arrow keys inside a small menu (role="menu"): Up/Down move between its own
// enabled items, Home/End jump to the ends. Items of a nested menu are left to
// that menu. Used by the composer's + menu and the menus it opens beside it.

const ITEM = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

/** The menu's own enabled items, in order (not those of a nested menu). */
export function ownMenuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(ITEM)].filter(
    (item) => item.closest('[role="menu"]') === menu && !(item as HTMLButtonElement).disabled,
  );
}

/** Moves focus for an arrow key; true when the key was used. */
export function moveMenuFocus(menu: HTMLElement, key: string, active: Element | null): boolean {
  const items = ownMenuItems(menu);
  if (!items.length) return false;
  const at = items.findIndex((item) => item === active);
  let next = -1;
  if (key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
  else if (key === "ArrowUp") next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
  else if (key === "Home") next = 0;
  else if (key === "End") next = items.length - 1;
  else return false;
  items[next]?.focus();
  return true;
}

/** Focuses the menu's first item once it is on screen. */
export function focusFirstMenuItem(menu: HTMLElement | null): void {
  if (!menu) return;
  ownMenuItems(menu)[0]?.focus();
}
