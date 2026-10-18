// The background effect behind the conversation (Settings > Appearance >
// Background effects). "none" (the default): no canvas, no listener, no
// cost. "glyphs": the glyph field of #716 (GlyphRippleLayer.tsx). Any other
// effect: one WebGL2 shader (src/lib/background-engine.ts), with the glyph
// field's 2D ring in the effect's colour when WebGL2 is missing. Desktop only
// (a fine pointer); the main conversation only, never a side chat.
import { useEffect, useRef, useState, type RefObject } from "react";
import { backgroundEffect, effectPalette, INTENSITY_GAIN, paletteSwatch, type BackgroundEffectId, type Intensity, type PaletteId } from "@/lib/background-effects";
import { useBackgroundEffectPrefs } from "@/lib/background-effect-preferences";
import { mountShaderEffect } from "@/lib/background-engine";
import { mountGlyphField } from "@/lib/glyph-ripple";
import { useColorScheme } from "@/lib/color-scheme";
import { GlyphRippleCanvas, hasFinePointer } from "./GlyphRippleLayer";

/** The effect the conversation shows, or null (none, or a coarse pointer). */
export function useBackgroundEffectShown(): BackgroundEffectId | null {
  const prefs = useBackgroundEffectPrefs();
  if (prefs.effect === "none" || !hasFinePointer()) return null;
  return prefs.effect;
}

/** The lit colour of a palette as CSS, for the canvas's border colour (the
 * glyph field's tint, the theme's tint of a shader). */
export function paletteTintCss(palette: PaletteId, scheme: "light" | "dark"): string {
  if (palette === "theme") return "var(--glyph-ripple-tint, var(--color-accent))";
  if (palette === "mono") return "var(--color-ink)";
  return paletteSwatch(palette, scheme)![0];
}

/** One shader effect on its own canvas. Remounted when the effect changes;
 * the colour and the intensity follow the canvas's attributes live. */
export function ShaderEffectCanvas({ paneRef, effect, palette, intensity }: { paneRef: RefObject<HTMLElement | null>; effect: BackgroundEffectId; palette: PaletteId; intensity: Intensity }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scheme = useColorScheme();
  // the shader could not run here: a NEW canvas (one that holds a WebGL
  // context can never give a 2D one) for the glyph field's 2D ring
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const pane = paneRef.current;
    if (!canvas || !pane) return;
    if (fallback) return mountGlyphField(canvas, pane).unmount;
    const mounted = mountShaderEffect(canvas, pane, effect);
    if (mounted) return mounted.unmount;
    setFallback(true);
    return undefined;
  }, [paneRef, effect, fallback]);
  return (
    <canvas
      key={fallback ? "2d" : "webgl"}
      ref={canvasRef}
      data-fallback={fallback ? "2d" : undefined}
      aria-hidden="true"
      data-background-effect={effect}
      data-palette={palette}
      data-gain={String(INTENSITY_GAIN[intensity])}
      className="pointer-events-none absolute inset-0 block h-full w-full select-none"
      style={{ color: "var(--color-ink)", borderColor: paletteTintCss(palette, scheme) }}
    />
  );
}

/** The chosen effect for a pane that is `position: relative`, or nothing. */
export function BackgroundEffectLayer({ paneRef, effect }: { paneRef: RefObject<HTMLElement | null>; effect: BackgroundEffectId | null }) {
  const prefs = useBackgroundEffectPrefs();
  const scheme = useColorScheme();
  if (!effect) return null;
  const kind = backgroundEffect(effect).kind;
  if (kind === "none") return null;
  const palette = effectPalette(effect, prefs.palettes[effect]);
  const gain = INTENSITY_GAIN[prefs.intensity];
  if (kind === "glyphs") return <GlyphRippleCanvas paneRef={paneRef} tint={paletteTintCss(palette, scheme)} gain={gain} />;
  return <ShaderEffectCanvas key={effect} paneRef={paneRef} effect={effect} palette={palette} intensity={prefs.intensity} />;
}
