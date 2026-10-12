// One pointer listener on the sidebar and one requestAnimationFrame loop for
// every registered mascot avatar. Controllers write transforms or gaze
// imperatively so React does not repaint at display rate.

import { animationsPaused } from "../animation-pause";
import {
  gazeNormForAvatar,
  hoverLean,
  leanTransform,
  pointerInRect,
  smoothGaze,
} from "./interaction";

export type SidebarMascotDriver = {
  /** Root element whose getBoundingClientRect is the avatar box. */
  getBox: () => DOMRect | null;
  /** Pointer left the sidebar or reduced motion: rest. */
  onRest: () => void;
  /** Smoothed gaze -1..1 and hover intensity 0..1. */
  onGaze: (gaze: { x: number; y: number }, intensity: number) => void;
  /** Optional wrapper to apply lean transform on. */
  leanTarget?: HTMLElement | null;
};

type Entry = {
  driver: SidebarMascotDriver;
  gaze: { x: number; y: number };
};

let sidebarEl: HTMLElement | null = null;
let pointer: { x: number; y: number } | null = null;
let pointerInside = false;
let reduced = false;
let raf = 0;
const entries = new Map<symbol, Entry>();
let lastTs = 0;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function tick(now: number) {
  raf = 0;
  if (animationsPaused() || !sidebarEl || entries.size === 0) return;
  const dt = lastTs ? Math.min(0.1, (now - lastTs) / 1000) : 0;
  lastTs = now;

  const sidebarRect = sidebarEl.getBoundingClientRect();
  const active = !reduced && pointerInside && pointer !== null;

  for (const entry of entries.values()) {
    const box = entry.driver.getBox();
    if (!box) {
      entry.driver.onRest();
      continue;
    }
    if (!active || !pointer) {
      entry.gaze = smoothGaze(entry.gaze, { x: 0, y: 0 }, dt, 10);
      if (Math.abs(entry.gaze.x) < 0.002 && Math.abs(entry.gaze.y) < 0.002) {
        entry.driver.onRest();
        entry.gaze = { x: 0, y: 0 };
      } else {
        entry.driver.onGaze(entry.gaze, 0);
      }
      if (entry.driver.leanTarget) entry.driver.leanTarget.style.transform = "";
      continue;
    }

    const norm = gazeNormForAvatar(box, pointer.x, pointer.y, sidebarRect);
    const overRow = pointerInRect(pointer.x, pointer.y, box, 10);
    const intensity = overRow ? 1 : pointerInRect(pointer.x, pointer.y, sidebarRect, 0) ? 0.55 : 0;
    entry.gaze = smoothGaze(entry.gaze, norm, dt);
    entry.driver.onGaze(entry.gaze, intensity);
    const lean = entry.driver.leanTarget && intensity > 0 ? hoverLean(norm, intensity) : null;
    if (entry.driver.leanTarget) {
      entry.driver.leanTarget.style.transform = lean ? leanTransform(lean) : "";
    }
  }

  schedule();
}

function schedule() {
  if (raf || entries.size === 0) return;
  if (typeof requestAnimationFrame !== "function") return;
  raf = requestAnimationFrame(tick);
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === "touch") return;
  if (!sidebarEl) return;
  pointer = { x: event.clientX, y: event.clientY };
  pointerInside = pointerInRect(event.clientX, event.clientY, sidebarEl.getBoundingClientRect(), 4);
  lastTs = 0;
  schedule();
}

function onPointerLeave() {
  pointerInside = false;
  schedule();
}

let bound = false;
function ensureListeners() {
  if (bound || !sidebarEl) return;
  bound = true;
  sidebarEl.addEventListener("pointermove", onPointerMove, { passive: true });
  sidebarEl.addEventListener("pointerleave", onPointerLeave);
  if (typeof window !== "undefined") {
    window.addEventListener("blur", onPointerLeave);
  }
}

export function attachSidebarMascotRoot(el: HTMLElement | null) {
  if (sidebarEl === el) return;
  if (sidebarEl && bound) {
    sidebarEl.removeEventListener("pointermove", onPointerMove);
    sidebarEl.removeEventListener("pointerleave", onPointerLeave);
    window.removeEventListener("blur", onPointerLeave);
    bound = false;
  }
  sidebarEl = el;
  if (el) ensureListeners();
}

export function registerSidebarMascot(driver: SidebarMascotDriver): () => void {
  const id = Symbol("sidebar-mascot");
  entries.set(id, { driver, gaze: { x: 0, y: 0 } });
  schedule();
  return () => {
    entries.delete(id);
    driver.onRest();
    if (driver.leanTarget) driver.leanTarget.style.transform = "";
  };
}

export function resetSidebarMascotLoopForTests() {
  if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
  raf = 0;
  entries.clear();
  pointer = null;
  pointerInside = false;
  lastTs = 0;
}

export function setSidebarMascotReducedMotion(value: boolean) {
  reduced = value;
}

export function refreshSidebarMascotReducedMotion() {
  reduced = prefersReducedMotion();
}
