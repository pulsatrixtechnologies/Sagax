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
 * Measured by `pnpm check:contrast`: the accent track against the surfaces it
 * sits on (3:1, through its ring) and every pill tint against the card (4.5:1).
 */
export const SWITCH_ON = "bg-accent ring-1 ring-inset ring-accent-border";
export const SWITCH_OFF = "bg-ink/10";
/** The thumb takes the ink paired with the track, so it reads on every skin. */
export const SWITCH_THUMB_ON = "bg-[var(--color-accent-ink)]";
export const SWITCH_THUMB_OFF = "bg-ink";

/** A status chip for a state: on, active, connected, ready, paused, waiting,
 * queued or scheduled. Off, idle or stopped states use `bg-control text-ink-secondary`. */
export const PILL_INFO = "bg-accent/15 text-accent-text";
