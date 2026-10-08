import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Same length as `--animate-pop-in` in styles.css. */
export const MENU_MOTION_MS = 200;

/** The reduced-motion rule: the system setting, or the onboarding preview's
 * `data-reduced-motion` switch on the root. */
export function reducedMotion(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined" || !window.matchMedia) return false;
  if (document.documentElement.dataset.reducedMotion === "true") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface MenuMotion {
  /** Render the menu: it is open, or still playing its close. */
  shown: boolean;
  /** Closed, and playing the open pop backwards. */
  closing: boolean;
  className: string;
  /** Spread on the menu element. A closing menu is only a picture of one:
   * inert and aria-hidden keep it out of the tab order, hit-testing and the
   * accessibility tree, so nothing (a person, a screen reader, a test
   * driver) can reach a menu that is already closed. */
  exitProps: { inert?: boolean; "aria-hidden"?: boolean };
}

/** Keep a menu mounted through the same 200ms pop it uses to open, so close
 * is the open motion played backwards. */
export function useMenuMotion(open: boolean): MenuMotion {
  // True from the menu's first open until its close has finished playing.
  const [mounted, setMounted] = useState(open);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), MENU_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // Read `open` itself, not only the state that trails it, so the menu shows
  // on the render its trigger flips and goes inert on the render it closes.
  const closing = !open && mounted;
  return {
    shown: open || mounted,
    closing,
    className: closing ? "animate-pop-out pointer-events-none" : "animate-pop-in",
    exitProps: closing ? { inert: true, "aria-hidden": true } : {},
  };
}

/** Remember the last open payload so a menu can finish closing after its
 * owner has already cleared the state that positioned it. */
export function useHeldMenuMotion<T>(value: T | null): MenuMotion & { value: T | null } {
  const motion = useMenuMotion(value != null);
  const held = useRef<T | null>(value);
  if (value != null) held.current = value;
  return { ...motion, value: value ?? held.current };
}

/** The transition a revealed panel's shell carries: height and opacity, the
 * menus' length and easing, none under the reduced-motion rule. */
export const HEIGHT_MOTION_CLASS = "transition-[height,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

/** A panel that grows out of the edge above it and folds back into it.
 *
 * `shell` clips (overflow hidden, HEIGHT_MOTION_CLASS); `content` is the
 * panel at its natural size inside it. Opening, the content's final height is
 * measured once, before the first paint, and the shell grows from 0 to it
 * with its opacity; then the height is released (auto) so later changes
 * simply follow. Closing plays it backwards from the height it has. When
 * `contentKey` changes while open (another panel in the same place), the
 * shell goes from the old height to the new one without folding to 0.
 * `beforeReveal` runs once the new content is laid out and before anything
 * is painted (a transcript scrolls to its last line there). The content never
 * reflows: only the shell's clip changes. Under the reduced-motion rule the
 * panel simply appears and goes. */
export function useHeightReveal(
  open: boolean,
  shell: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  contentKey?: string | null,
  beforeReveal?: () => void,
): MenuMotion {
  const motion = useMenuMotion(open);
  const was = useRef<{ open: boolean; key: string | null | undefined }>({ open: false, key: contentKey });
  // the content's last settled height: what a switch starts from
  const settled = useRef(0);
  const release = useRef<number | null>(null);
  const before = useRef(beforeReveal);
  before.current = beforeReveal;

  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    settled.current = element.offsetHeight;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => (settled.current = element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [content, motion.shown]);

  useLayoutEffect(() => {
    const box = shell.current;
    const previous = was.current;
    was.current = { open, key: contentKey };
    if (!box) return;
    if (release.current !== null) {
      window.clearTimeout(release.current);
      release.current = null;
    }
    const opening = open && !previous.open;
    const switching = open && previous.open && previous.key !== contentKey;
    const closing = !open && previous.open;
    if (!opening && !switching && !closing) return;
    if (opening || switching) before.current?.();
    if (reducedMotion()) {
      box.style.height = "";
      box.style.opacity = "";
      return;
    }
    // From the height on screen (a close caught halfway, or the old panel)
    const from = opening ? (box.style.height ? box.getBoundingClientRect().height : 0) : switching ? settled.current : box.getBoundingClientRect().height;
    const to = closing ? 0 : (content.current?.offsetHeight ?? 0);
    box.style.transition = "none";
    box.style.height = `${from}px`;
    if (opening && from === 0) box.style.opacity = "0";
    void box.offsetHeight; // the start is laid out before the change
    box.style.transition = "";
    box.style.height = `${to}px`;
    box.style.opacity = closing ? "0" : "1";
    settled.current = to;
    if (!closing) {
      release.current = window.setTimeout(() => {
        release.current = null;
        box.style.height = "";
        box.style.opacity = "";
      }, MENU_MOTION_MS + 20);
    }
  }, [open, contentKey, shell, content]);

  useLayoutEffect(() => () => {
    if (release.current !== null) window.clearTimeout(release.current);
  }, []);

  return motion;
}
