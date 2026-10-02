// When the controls drawn over a live screen (Play / Pause / Stop, Take
// control) show. They stay out of the way of what the screen shows and come
// in only on intent:
//
// - a mouse or pen resting on the screen for HOVER_INTENT_MS (passing over
//   it does nothing), hidden again when it leaves;
// - keyboard focus inside the screen, at once (accessibility), until focus
//   leaves it;
// - a tap on a touch screen, at once, hidden again TAP_REVEAL_MS later
//   unless focus is inside.
//
// Framework-free so its timing is tested with fake timers; the screen
// component (src/components/computer/ComputerScreen.tsx) feeds it events.

export const HOVER_INTENT_MS = 2_000;
export const TAP_REVEAL_MS = 4_000;

type Timer = ReturnType<typeof setTimeout>;

export class HoverIntent {
  private shown = false;
  private hovered = false;
  private focused = false;
  private hoverTimer: Timer | null = null;
  private tapTimer: Timer | null = null;

  constructor(
    private readonly onChange: (shown: boolean) => void,
    private readonly hoverMs = HOVER_INTENT_MS,
    private readonly tapMs = TAP_REVEAL_MS,
  ) {}

  get revealed(): boolean { return this.shown; }

  pointerEnter(pointerType: string): void {
    if (pointerType === "touch") return;
    this.hovered = true;
    this.clearHover();
    this.hoverTimer = setTimeout(() => { this.hoverTimer = null; this.set(true); }, this.hoverMs);
  }

  pointerLeave(pointerType: string): void {
    if (pointerType === "touch") return;
    this.hovered = false;
    this.clearHover();
    if (!this.focused && !this.tapTimer) this.set(false);
  }

  /** A tap shows the controls at once, for a few seconds. */
  pointerDown(pointerType: string): void {
    if (pointerType !== "touch") return;
    this.set(true);
    this.clearTap();
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      if (!this.focused && !this.hovered) this.set(false);
    }, this.tapMs);
  }

  focusIn(): void {
    this.focused = true;
    this.set(true);
  }

  focusOut(): void {
    this.focused = false;
    if (!this.tapTimer && !(this.hovered && this.hoverTimer === null && this.shown)) this.set(false);
  }

  dispose(): void {
    this.clearHover();
    this.clearTap();
  }

  private set(shown: boolean): void {
    if (this.shown === shown) return;
    this.shown = shown;
    this.onChange(shown);
  }

  private clearHover(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
  }

  private clearTap(): void {
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = null;
  }
}
