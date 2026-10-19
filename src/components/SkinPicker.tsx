// Settings > Appearance > Skin (2026-10-19): a grid of skin FAMILIES, then
// the chosen family's variant (swatches, as Background effects' Colour) and
// its mode (Light, Dark or Auto, as Background effects' Intensity). The
// families and their variants live in src/lib/skin-families.ts; a variant in
// a mode is one of the skins of src/lib/skins.ts, worn as before.
//
// Choosing a skin is a visual decision, so the options are shown visually: each
// card carries a working miniature of the app rendered in that skin, not a row
// of paint chips. That works because the skin blocks in styles.css are keyed on
// `[data-skin]` rather than `:root[data-skin]` — any element can open a skin
// context for its own subtree, so the miniature styles itself and can never
// drift from what picking it actually does.
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { chooseSkin, prefersDarkScheme, readSkin, type SkinId } from "@/lib/skins";
import {
  canFollowSystem,
  carryMode,
  defaultVariant,
  placeOfSkin,
  readRememberedVariants,
  readSkinAuto,
  rememberVariant,
  resolveSkin,
  schemesOf,
  variantSkin,
  visibleFamilies,
  type SkinFamily,
  type SkinModeChoice,
  type SkinVariant,
} from "@/lib/skin-families";
import { readRetroUnlocked } from "@/lib/retro98";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CompactRow, PillSelect } from "./SettingsPrimitives";

/**
 * The app's own layout at roughly 1/14 scale: rail, sidebar with a selected
 * row, thread, composer. The selected row and the send button are drawn in the
 * accent on purpose — a skin is mostly judged by where its colour lands, and a
 * single dot was too small to judge.
 */
function Miniature({ skin, selected }: { skin: SkinId; selected: boolean }) {
  return (
    <div
      data-skin={skin}
      aria-hidden="true"
      className={cn("flex h-[78px] w-full overflow-hidden rounded-lg bg-app", selected ? "ring-2 ring-accent-border" : "ring-1 ring-hairline/60")}
    >
      {/* rail */}
      <div className="flex w-[11px] shrink-0 flex-col items-center gap-[3px] bg-panel pt-[5px]">
        <span className="size-[5px] rounded-full bg-accent" />
        <span className="size-[5px] rounded-full bg-ink-secondary/40" />
        <span className="size-[5px] rounded-full bg-ink-secondary/40" />
      </div>
      {/* sidebar — the top row is the selected conversation */}
      <div className="flex w-[30px] shrink-0 flex-col gap-[3px] border-r border-hairline bg-panel p-[4px]">
        <span className="flex h-[9px] w-full items-center gap-[2px] rounded-sm bg-raised px-[2px]">
          <span className="size-[4px] shrink-0 rounded-full bg-accent" />
          <span className="h-[2px] flex-1 rounded-full bg-ink/50" />
        </span>
        <span className="h-[3px] w-[80%] rounded-full bg-ink-secondary/30" />
        <span className="h-[3px] w-[62%] rounded-full bg-ink-secondary/30" />
        <span className="h-[3px] w-[74%] rounded-full bg-ink-secondary/30" />
      </div>
      {/* thread */}
      <div className="flex min-w-0 flex-1 flex-col gap-[4px] p-[6px]">
        <span className="h-[13px] w-[62%] self-end rounded-md bg-bubble-user" />
        <div className="flex w-[88%] flex-col gap-[3px] rounded-md bg-card p-[4px]">
          <span className="h-[2px] w-full rounded-full bg-ink/45" />
          <span className="h-[2px] w-[85%] rounded-full bg-ink/45" />
          <span className="h-[2px] w-[60%] rounded-full bg-ink-secondary/40" />
        </div>
        <div className="mt-auto flex items-center gap-[4px]">
          <span className="h-[11px] flex-1 rounded-full bg-inset ring-1 ring-hairline" />
          {/* filled accent with its own ink — Foundry's inversion reads right
              here: bright brass carrying a dark mark, where the others carry
              a light one */}
          <span className="flex size-[11px] items-center justify-center rounded-full bg-accent">
            <span
              className="h-[1.5px] w-[5px] rounded-full"
              style={{ background: "var(--color-accent-ink)" }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

const familyTagline = (family: SkinFamily) => t(`settings.skin.family.${family.id}.tagline`);
const variantName = (variant: SkinVariant) => t(`settings.skin.variant.${variant.id}`);
const MODES: readonly SkinModeChoice[] = ["light", "dark", "auto"];

/** The skin the document wears now (main.tsx stamped it before the first paint). */
function wornSkin(): SkinId {
  // SAFETY: main.tsx writes this attribute from applySkin() before the first
  // paint, and readSkin() covers the case where it is absent or unreadable.
  return (document.documentElement.dataset.skin as SkinId) || readSkin();
}

/** The worn skin and the mode, re-read when anything changes the skin
 * (the picker, Auto following the system, Hibou 98, the phone). */
function useSkinState(): { skin: SkinId; auto: boolean } {
  const [state, setState] = useState(() => ({ skin: wornSkin(), auto: readSkinAuto() }));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setState({ skin: wornSkin(), auto: readSkinAuto() }));
    observer.observe(root, { attributes: true, attributeFilter: ["data-skin"] });
    return () => observer.disconnect();
  }, []);
  return state;
}

export function SkinPicker() {
  const { skin: active, auto } = useSkinState();
  const place = placeOfSkin(active);
  const [, rerender] = useState(0);
  // Secret families stay out of the list until this device has found them.
  const [families] = useState(() => visibleFamilies(readRetroUnlocked(), place.family.id));
  const remembered = readRememberedVariants();
  const mode: SkinModeChoice = auto && canFollowSystem(place.variant) ? "auto" : place.scheme;

  const wear = (family: SkinFamily, variant: SkinVariant, next: SkinModeChoice) => {
    rememberVariant(family.id, variant.id);
    chooseSkin(resolveSkin(variant, next, prefersDarkScheme()), next === "auto");
    // the mode key changes without a skin change when Auto lands on the worn skin
    rerender((n) => n + 1);
  };

  return (
    <div data-skin-picker="" className="flex flex-col gap-1">
      {/* 0.5.6 (JC): Grok Bot's tiles inside the Appearance card: the picture,
          the name and a check. The tagline is the tile's tooltip and its
          accessible description, so the grid fits four across. */}
      <div role="group" aria-label={t("settings.skin.title")} data-skin-grid="" className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2 px-2 py-1">
        {families.map((family) => {
          const selected = family.id === place.family.id;
          // the tile shows the family as it would be worn: its current variant in the current scheme
          const variant = selected ? place.variant : defaultVariant(family, place.scheme, remembered[family.id]);
          const shown = selected ? active : variantSkin(variant, place.scheme);
          return (
            <button
              key={family.id}
              type="button"
              aria-pressed={selected}
              aria-description={familyTagline(family)}
              title={familyTagline(family)}
              data-skin-family={family.id}
              onClick={() => {
                if (selected) return;
                wear(family, variant, carryMode(variant, mode, place.scheme));
              }}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-[10px] p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none",
                selected ? "bg-selected" : "hover:bg-hover",
              )}
            >
              <Miniature skin={shown} selected={selected} />
              <span className="flex min-w-0 items-center gap-1.5 px-0.5 text-[13px] leading-[18px] text-ink">
                <span className="min-w-0 truncate">{family.name}</span>
                {family.secret && (
                  <span className="shrink-0 rounded-sm bg-accent px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-accent-ink">
                    {t("retro.skin.unlocked")}
                  </span>
                )}
                {selected && <Check size={13} aria-hidden="true" className="ml-auto shrink-0 text-accent-text" />}
              </span>
            </button>
          );
        })}
      </div>
      {place.family.variants.length > 1 && (
        <CompactRow label={t("settings.skin.variantLabel")} rowId="skinVariant">
          <div role="radiogroup" aria-label={t("settings.skin.variantLabel")} className="flex flex-wrap items-center justify-end gap-1.5">
            {place.family.variants.map((variant) => {
              const selected = variant.id === place.variant.id;
              return (
                <button
                  key={variant.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={variantName(variant)}
                  title={variantName(variant)}
                  data-skin-variant={variant.id}
                  onClick={() => {
                    if (!selected) wear(place.family, variant, carryMode(variant, mode, place.scheme));
                  }}
                  className={cn(
                    "size-[22px] cursor-pointer rounded-full bg-transparent transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none",
                    selected ? "ring-2 ring-accent-border ring-offset-2 ring-offset-elevated" : "ring-1 ring-hairline hover:ring-ink-secondary/60",
                  )}
                >
                  {/* the swatch opens the variant's own skin context: its
                      ground and its colour come from that skin's block */}
                  <span
                    aria-hidden="true"
                    data-skin={variantSkin(variant, place.scheme)}
                    className="block size-full rounded-full"
                    style={{ background: "linear-gradient(135deg, var(--color-app) 0 50%, var(--skin-swatch) 50% 100%)" }}
                  />
                </button>
              );
            })}
          </div>
        </CompactRow>
      )}
      {place.family.id !== "retro98" && (
        <CompactRow label={t("settings.skin.modeLabel")} rowId="skinMode">
          <PillSelect<SkinModeChoice>
            value={mode}
            ariaLabel={t("settings.skin.modeLabel")}
            onChange={(next) => wear(place.family, place.variant, next)}
            options={MODES.map((value) => ({
              value,
              label: t(`settings.skin.mode.${value}`),
              disabled: value === "auto" ? !canFollowSystem(place.variant) : !schemesOf(place.variant).includes(value),
            }))}
          />
        </CompactRow>
      )}
    </div>
  );
}
