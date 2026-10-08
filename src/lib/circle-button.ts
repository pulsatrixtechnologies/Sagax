// The round 36px control Grok Bot uses for every top-bar action (search, new,
// share, panel): an elevated surface with a hairline, primary-colored icon.
export const CIRCLE_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline-weak bg-elevated text-ink transition-colors hover:bg-elevated-hover";

// The same 36px circle for a control that sits on the sidebar rail (the
// head's search and New buttons). It paints from the rail's own tokens
// (bg-sidebar-elevated, border-sidebar-hairline-weak, sidebar ink), never the
// content frame's: on Pulsatrix Light the rail is navy while the frame is
// light, and CIRCLE_BUTTON there draws a light grey disc with a dark glyph.
// Every other skin's rail tokens equal its panel/ink, so the result is the
// same pixels as CIRCLE_BUTTON. The geometry (size-9, rounded-full, a 1px
// border) stays CIRCLE_BUTTON's so the two rows line up.
export const SIDEBAR_CIRCLE_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-sidebar-hairline-weak bg-sidebar-elevated text-sidebar-ink-secondary transition-colors hover:bg-sidebar-elevated-hover hover:text-sidebar-ink";
