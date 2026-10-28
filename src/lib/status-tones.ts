/**
 * The semantic tones of the app, in one place.
 *
 * "On", "active", "connected", "paused", "waiting" and "scheduled" are states,
 * not verdicts. They read in the skin's accent (Pulsatrix blue) or in neutral
 * ink, never in the success green or the warning amber. Green is kept for
 * work that finished well (a completed run, a passed test, a saved secret);
 * amber for something that needs a person (a failed run, an expiring key);
 * red for errors. Skins retune the accent, success, warning and danger
 * tokens in styles.css; these constants only pick which token a meaning uses.
 *
 * Measured by `pnpm check:contrast`: every pill tint against the card (4.5:1).
 *
 * The switch (2026-10-28): the on track is the accent and the off track a
 * neutral grey, each at the lightness src/lib/switch-colors.ts derives per
 * skin and variant (src/styles/skin-switch.css), with an edge when a surface
 * needs one; the thumb is white in both states, never dark on a coloured
 * track. src/lib/switch-colors.test.ts holds every pair at 3:1.
 */
export const SWITCH_ON = "bg-[var(--color-switch-on)] shadow-[inset_0_0_0_1.5px_var(--color-switch-on-edge)]";
export const SWITCH_OFF = "bg-[var(--color-switch-off)] shadow-[inset_0_0_0_1.5px_var(--color-switch-off-edge)]";
/** The thumb: white in both states, its position says on or off. */
export const SWITCH_THUMB_ON = "bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)]";
export const SWITCH_THUMB_OFF = SWITCH_THUMB_ON;

/** A status chip for a state: on, active, connected, ready, paused, waiting,
 * queued or scheduled. Off, idle or stopped states use `bg-control text-ink-secondary`. */
export const PILL_INFO = "bg-accent/15 text-accent-text";
