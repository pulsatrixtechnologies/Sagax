// Hover-to-open timing for the sidebar footer menus, kept out of React.
//
// Why native listeners and not React's onPointerEnter/onPointerLeave: React
// derives enter/leave from pairs of pointerout/pointerover events. When the
// element under a resting pointer is removed (a modal the Tools menu opened
// closes, a toast or tour layer goes away), Blink's next move sends only a
// pointerover on the new target, with relatedTarget set to the removed node's
// still-connected React parent, and no pointerout at all. React ignores an
// over event whose relatedTarget it manages, waiting for an out event that
// never comes, so onPointerEnter is simply never called. The native
// pointerenter is dispatched correctly in that case, so the footer listens to
// that instead.

export interface HoverIntentTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface HoverIntent {
  /** the pointer entered the menu's root (trigger or open menu) */
  enter(): void;
  /** the pointer left the root; closing waits so a diagonal path is forgiven */
  leave(): void;
  /** drop any pending open or close */
  cancel(): void;
}

const defaultTimers: HoverIntentTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  // SAFETY: the handle only ever comes from `set` above
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createHoverIntent({
  openDelayMs,
  closeDelayMs,
  active,
  setOpen,
  timers = defaultTimers,
}: {
  openDelayMs: number;
  closeDelayMs: number;
  /** read at event time: hover opens only when enabled and not pinned by a click */
  active: () => boolean;
  setOpen: (open: boolean) => void;
  timers?: HoverIntentTimers;
}): HoverIntent {
  let pending: unknown = null;
  const cancel = () => {
    if (pending !== null) timers.clear(pending);
    pending = null;
  };
  const later = (open: boolean, ms: number) => {
    cancel();
    pending = timers.set(() => {
      pending = null;
      setOpen(open);
    }, ms);
  };
  return {
    enter: () => {
      if (active()) later(true, openDelayMs);
    },
    leave: () => {
      if (active()) later(false, closeDelayMs);
    },
    cancel,
  };
}

/** Wire the intent to an element's native pointerenter/pointerleave. Returns
 * the unbind function, so it can be a React effect's cleanup directly. */
export function bindHoverIntent(target: EventTarget, intent: HoverIntent): () => void {
  const enter = () => intent.enter();
  const leave = () => intent.leave();
  target.addEventListener("pointerenter", enter);
  target.addEventListener("pointerleave", leave);
  return () => {
    target.removeEventListener("pointerenter", enter);
    target.removeEventListener("pointerleave", leave);
    intent.cancel();
  };
}
