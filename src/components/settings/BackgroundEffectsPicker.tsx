// Settings > Appearance > Background effects, presented as the skins are: a
// live preview of the chosen effect (move the pointer and click in it), a
// gallery of animated miniatures, then the effect's colour and the
// intensity. Choosing applies at once, to the preview and the conversation.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { BACKGROUND_EFFECTS, effectPalette, INTENSITIES, paletteSwatch, type BackgroundEffectId, type Intensity, type PaletteId } from "@/lib/background-effects";
import { setBackgroundEffect, setBackgroundIntensity, setBackgroundPalette, useBackgroundEffectPrefs } from "@/lib/background-effect-preferences";
import { animatedScene, drawPreview, PREVIEW_HEIGHT, PREVIEW_WIDTH, stillScene, webgl2Available } from "@/lib/background-preview";
import { readGlyphColors } from "@/lib/glyph-ripple";
import { prefersReducedMotion } from "@/lib/motion";
import { useColorScheme } from "@/lib/color-scheme";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { BackgroundEffectLayer } from "../BackgroundEffectLayer";
import { CompactRow, PillSelect } from "../SettingsPrimitives";

const effectName = (id: BackgroundEffectId) => t(`settings.backgroundEffects.effect.${id}.name`);
const effectDescription = (id: BackgroundEffectId) => t(`settings.backgroundEffects.effect.${id}.description`);
const paletteName = (id: PaletteId) => t(`settings.backgroundEffects.palette.${id}`);

/** The swatch of a palette: its three colours, or the skin's for Theme and
 * Mono. */
function swatchBackground(id: PaletteId, scheme: "light" | "dark"): string {
  const colors = paletteSwatch(id, scheme);
  if (colors) return `conic-gradient(from 210deg, ${colors[0]}, ${colors[1]}, ${colors[2]}, ${colors[0]})`;
  if (id === "theme") return "conic-gradient(from 210deg, var(--glyph-ripple-tint, var(--color-accent)), var(--color-accent-text, var(--color-accent)), var(--glyph-ripple-tint, var(--color-accent)))";
  return "conic-gradient(from 210deg, var(--color-ink), var(--color-ink-secondary), var(--color-ink))";
}

/** A tile's miniature: a still frame, animated while hovered (never with
 * reduced motion). The skin shows through: the app's background, two
 * message bars over the effect. */
/** The active skin, following the picker (it stamps data-skin on the root):
 * a miniature redraws in the new skin's colours. */
function useSkinId(): string {
  const read = () => (typeof document === "undefined" ? "" : document.documentElement.dataset.skin ?? "");
  const [skin, setSkin] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setSkin(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
    return () => observer.disconnect();
  }, []);
  return skin;
}

function Thumb({ effect, palette, hovered, index, onUnavailable }: { effect: BackgroundEffectId; palette: PaletteId; hovered: boolean; index: number; onUnavailable: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scheme = useColorScheme();
  const skin = useSkinId();
  const [drawn, setDrawn] = useState(false);
  // the first frame of each tile waits its turn: the shaders compile one
  // per idle slot, not eleven at once when Settings opens
  useEffect(() => {
    if (drawn) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      if (!drawPreview(canvas, effect, palette, readGlyphColors(canvas), stillScene(index))) onUnavailable();
      setDrawn(true);
    };
    const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    const timer = setTimeout(() => (idle ? idle(draw, { timeout: 400 }) : draw()), index * 45);
    return () => clearTimeout(timer);
  }, [drawn, effect, palette, index, onUnavailable]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !drawn) return;
    const colors = readGlyphColors(canvas);
    if (!drawPreview(canvas, effect, palette, colors, stillScene(index))) {
      onUnavailable();
      return;
    }
    if (!hovered || prefersReducedMotion()) return;
    let frame = 0;
    let last = 0;
    const start = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      drawPreview(canvas, effect, palette, colors, animatedScene((now - start) / 1000 + 0.4));
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      drawPreview(canvas, effect, palette, colors, stillScene(index));
    };
  }, [drawn, effect, palette, hovered, index, scheme, skin, onUnavailable]);
  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      style={{ color: "var(--color-ink)", borderColor: "var(--glyph-ripple-tint, var(--color-accent))" }}
    />
  );
}

function EffectTile({ effect, palette, selected, index, onPick }: { effect: BackgroundEffectId; palette: PaletteId; selected: boolean; index: number; onPick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const markUnavailable = useCallback(() => setUnavailable(true), []);
  const scheme = useColorScheme();
  const description = effectDescription(effect);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-description={description}
      title={description}
      data-effect-tile={effect}
      onClick={onPick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-[10px] p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none",
        selected ? "bg-selected" : "hover:bg-hover",
      )}
    >
      <div
        aria-hidden="true"
        className={cn("relative h-[78px] w-full overflow-hidden rounded-lg bg-app", selected ? "ring-2 ring-accent-border" : "ring-1 ring-hairline/60")}
      >
        {effect === "none" ? null : unavailable ? (
          <span className="absolute inset-0 opacity-30" style={{ background: swatchBackground(palette, scheme) }} />
        ) : (
          <Thumb effect={effect} palette={palette} hovered={hovered} index={index} onUnavailable={markUnavailable} />
        )}
        {/* the conversation over the effect, as the miniature skins show it */}
        <span className="absolute right-[8px] top-[9px] h-[11px] w-[42%] rounded-md bg-bubble-user/90" />
        <span className="absolute left-[8px] top-[28px] flex w-[62%] flex-col gap-[3px]">
          <span className="h-[2px] w-full rounded-full bg-ink/45" />
          <span className="h-[2px] w-[82%] rounded-full bg-ink/45" />
          <span className="h-[2px] w-[58%] rounded-full bg-ink-secondary/40" />
        </span>
      </div>
      <span className="flex min-w-0 items-center gap-1.5 px-0.5 text-[13px] leading-[18px] text-ink">
        <span className="min-w-0 truncate">{effectName(effect)}</span>
        {selected && <Check size={13} aria-hidden="true" className="ml-auto shrink-0 text-accent-text" />}
      </span>
    </button>
  );
}

/** The chosen effect, live, behind two sample messages. Clicks and pointer
 * moves inside it drive it exactly as in the conversation. */
function LivePreview({ effect }: { effect: BackgroundEffectId }) {
  const pane = useRef<HTMLDivElement>(null);
  return (
    <div data-background-preview="" className="relative mx-2 h-[168px] overflow-hidden rounded-lg bg-app ring-1 ring-hairline/60">
      <BackgroundEffectLayer paneRef={pane} effect={effect === "none" ? null : effect} />
      <div ref={pane} className="relative flex h-full cursor-crosshair flex-col gap-2 px-4 py-3.5" data-background-preview-pane="">
        <p className="max-w-[70%] self-end rounded-[16px] bg-bubble-user px-3 py-1.5 text-[13px] leading-[18px] text-ink">{t("settings.backgroundEffects.sampleUser")}</p>
        <p className="max-w-[78%] self-start text-[13px] leading-[19px] text-ink">{t("settings.backgroundEffects.sampleBot")}</p>
        <p className="mt-auto text-[12px] leading-4 text-ink-tertiary">
          {effect === "none" ? t("settings.backgroundEffects.previewNone") : t("settings.backgroundEffects.previewHint")}
        </p>
      </div>
    </div>
  );
}

function PaletteRow({ effect, palette }: { effect: BackgroundEffectId; palette: PaletteId }) {
  const scheme = useColorScheme();
  const options = BACKGROUND_EFFECTS.find((entry) => entry.id === effect)?.palettes ?? [];
  if (options.length === 0) return null;
  return (
    <CompactRow label={t("settings.backgroundEffects.color")} rowId="backgroundPalette">
      <div role="radiogroup" aria-label={t("settings.backgroundEffects.color")} className="flex flex-wrap items-center justify-end gap-1.5">
        {options.map((id) => {
          const selected = id === palette;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={paletteName(id)}
              title={paletteName(id)}
              data-palette-swatch={id}
              onClick={() => setBackgroundPalette(effect, id)}
              className={cn(
                "size-[22px] cursor-pointer rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none",
                selected ? "ring-2 ring-accent-border ring-offset-2 ring-offset-elevated" : "ring-1 ring-hairline hover:ring-ink-secondary/60",
              )}
              style={{ background: swatchBackground(id, scheme) }}
            />
          );
        })}
      </div>
    </CompactRow>
  );
}

export function BackgroundEffectsPicker() {
  const prefs = useBackgroundEffectPrefs();
  const [webgl] = useState(() => webgl2Available());
  const effect = prefs.effect;
  const palette = effectPalette(effect, prefs.palettes[effect]);
  return (
    <div data-background-effects="" className="flex flex-col gap-1">
      <LivePreview effect={effect} />
      <p className="px-3.5 pt-1 text-[12px] leading-4 text-ink-secondary">{t("settings.backgroundEffects.hint")}</p>
      {!webgl && <p role="note" className="px-3.5 text-[12px] leading-4 text-ink-secondary">{t("settings.backgroundEffects.noWebgl")}</p>}
      <div role="group" aria-label={t("settings.backgroundEffects.title")} data-effect-grid="" className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2 px-2 py-1">
        {BACKGROUND_EFFECTS.map((entry, index) => (
          <EffectTile
            key={entry.id}
            effect={entry.id}
            palette={effectPalette(entry.id, prefs.palettes[entry.id])}
            selected={entry.id === effect}
            index={index}
            onPick={() => setBackgroundEffect(entry.id)}
          />
        ))}
      </div>
      {effect !== "none" && (
        <>
          <PaletteRow effect={effect} palette={palette} />
          <CompactRow label={t("settings.backgroundEffects.intensity")} rowId="backgroundIntensity">
            <PillSelect<Intensity>
              value={prefs.intensity}
              ariaLabel={t("settings.backgroundEffects.intensity")}
              onChange={setBackgroundIntensity}
              options={INTENSITIES.map((level) => ({ value: level, label: t(`settings.backgroundEffects.intensity.${level}`) }))}
            />
          </CompactRow>
        </>
      )}
    </div>
  );
}
