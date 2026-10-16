// The in-chat terminal's fonts. Shell prompts (Powerlevel10k, Oh My Posh,
// Starship) draw OS icons, Powerline separators, clocks and language icons
// from the Nerd Font private-use area, which no system monospace font has:
// without a fallback they show as empty boxes. The bundled Symbols Nerd Font
// Mono (one cell wide, so xterm needs no width addon) leads the stack but is
// limited to the icon ranges, so letters still come from the system monospace
// font. It cannot come last: Monaco maps the private-use area to its own empty
// boxes, so a later fallback would never be reached.
// License: third_party/nerd-fonts-symbols.
import symbolsUrl from "./fonts/SymbolsNerdFontMono-Regular.woff2?url";

export const TERMINAL_SYMBOLS_FAMILY = "Symbols Nerd Font Mono";

export const TERMINAL_FONT_FAMILY = `"${TERMINAL_SYMBOLS_FAMILY}", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

/** The code points of the Nerd Font symbols: the private-use areas (Powerline,
 * Font Awesome, Devicons, Octicons, Codicons, Material Design...) and the few
 * standard ones Nerd Fonts also patches (power symbols, heart, bolt). */
export const TERMINAL_SYMBOLS_RANGE = "U+23FB-23FE, U+2665, U+26A1, U+2B58, U+E000-F8FF, U+F0000-FFFFD";

type FontFaceLike = { load(): Promise<unknown> };
type FontDeps = {
  fonts: { add(face: never): unknown };
  FontFaceCtor: new (family: string, source: string, descriptors?: { unicodeRange?: string }) => FontFaceLike;
  url: string;
  timeoutMs: number;
};

/** Adds the symbols face and waits for it, or for `timeoutMs`: never
 * rejects, so a failed load only costs the icons, not the terminal. */
export function loadSymbolsFace({ fonts, FontFaceCtor, url, timeoutMs }: FontDeps): Promise<void> {
  const face = new FontFaceCtor(TERMINAL_SYMBOLS_FAMILY, `url(${url}) format("woff2")`, { unicodeRange: TERMINAL_SYMBOLS_RANGE });
  fonts.add(face as never);
  return Promise.race([
    face.load().then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

let loading: Promise<void> | null = null;

/** Loads the symbols font once per page, before xterm opens: xterm measures
 * the cell and rasterizes glyphs into its atlas when it opens, so a font that
 * arrived later would leave the boxes there. */
export function loadTerminalFonts(): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  loading ??= loadSymbolsFace({ fonts: document.fonts, FontFaceCtor: FontFace, url: symbolsUrl, timeoutMs: 3000 });
  return loading;
}
