// Sidebar mascot hover: gaze toward the pointer and a rigid lean on the
// whole sprite (no separate limbs — see #340). Pure math for tests.

/** Pointer in client coordinates inside `rect`, optionally inflated by `pad` px. */
export function pointerInRect(clientX: number, clientY: number, rect: DOMRect, pad = 0): boolean {
  return (
    clientX >= rect.left - pad &&
    clientX <= rect.right + pad &&
    clientY >= rect.top - pad &&
    clientY <= rect.bottom + pad
  );
}

/**
 * Normalized gaze (-1..1, y down) from a pointer toward an avatar. When the
 * pointer sits in the sidebar, `reach` stretches so eyes can follow across the
 * column, not only over the face.
 */
export function gazeNormForAvatar(
  avatar: DOMRect,
  clientX: number,
  clientY: number,
  sidebar: DOMRect,
): { x: number; y: number } {
  const inSidebar = pointerInRect(clientX, clientY, sidebar, 8);
  const reach = inSidebar
    ? Math.max(sidebar.height * 0.55, avatar.width * 3.2, 300)
    : Math.max(avatar.width * 2.4, 200);
  const x = (clientX - (avatar.left + avatar.width / 2)) / reach;
  const y = (clientY - (avatar.top + avatar.height / 2)) / reach;
  return {
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
  };
}

const GAZE_SMOOTH = 14;

/** Exponential smoothing toward a gaze target (seconds-based). */
export function smoothGaze(
  current: { x: number; y: number },
  target: { x: number; y: number },
  dt: number,
  rate = GAZE_SMOOTH,
): { x: number; y: number } {
  const k = 1 - Math.exp(-Math.max(0, dt) * rate);
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
  };
}

/** Rigid lean: scale and rotate the whole mascot toward the pointer. */
export function hoverLean(norm: { x: number; y: number }, intensity: number): { sx: number; sy: number; rot: number; ty: number } {
  const t = Math.max(0, Math.min(1, intensity));
  const lean = 0.055 * t;
  return {
    sx: 1 + lean * norm.x,
    sy: 1 - lean * 0.35 * Math.abs(norm.x) + lean * 0.08,
    rot: norm.x * 4.5 * t,
    ty: -norm.y * 1.2 * t,
  };
}

export type SidebarMascotReactionKind = "blink" | "squish" | "hop" | "wiggle" | "wink";

const REACTIONS: SidebarMascotReactionKind[] = ["blink", "squish", "hop", "wiggle", "wink"];

/** Stable reaction pick from bot id (varied per row, deterministic). */
export function pickSidebarReaction(botId: string): SidebarMascotReactionKind {
  let h = 0;
  for (let i = 0; i < botId.length; i++) h = (h * 31 + botId.charCodeAt(i)) | 0;
  return REACTIONS[Math.abs(h) % REACTIONS.length];
}

/** CSS transform for a rigid sprite wrapper (origin center). */
export function leanTransform(lean: { sx: number; sy: number; rot: number; ty: number }): string {
  return `translateY(${lean.ty.toFixed(2)}px) rotate(${lean.rot.toFixed(2)}deg) scale(${lean.sx.toFixed(4)}, ${lean.sy.toFixed(4)})`;
}

/** One-shot click squash (returns keyframe at t 0..1). */
export function clickSquish(t: number): { sx: number; sy: number } {
  const u = Math.max(0, Math.min(1, t));
  const s = Math.sin(u * Math.PI);
  return { sx: 1 + s * 0.14, sy: 1 - s * 0.18 };
}
