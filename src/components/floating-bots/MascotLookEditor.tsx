// The Bot tab of the bot's avatar popover: the bot's character and its look,
// stored with the bot (bot.mascotLook, bot.color, bot.mascotSkin), so the
// change shows everywhere the bot appears and on its desktop mascot.
//
//   Character: Owl, Shapes, Trombi (the registry, mascots.tsx), full width:
//   the bot's avatar above the popover (the bot panel's header) is the
//   preview, and plays the moves and the equip animation. Then that
//   character's own options:
//     Owl: color, skin, style 2D / 3D (preview)
//     Shapes: shape, color, shape skin
//     Trombi: Trombi skin
//   Colors show one palette at a time (Vivid, Pastel, Deep, Neon, Neutral),
//   skins one rarity at a time (Common, Rare, Epic, Legendary), each tab
//   opening on the current choice (editor-tabs.ts). Skin cards preview the
//   skin animated; the Shape grid previews the current color and skin still.
//   Section titles stay on top while their options scroll (sticky).
//   Moves: that character's moves only, each with its skin's effect
//
// Each character keeps its own skin, so switching and back finds it again.
// Loaded lazily with the popover.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MAUS_COLORS, MAUS_WING_MOTIONS, swatchStyle, type MausColor, type MausMotion } from "@/lib/mascot";
import { MausAvatar } from "@/components/Avatar";
import { MASCOT_SKIN_IDS, OWL_SKIN_TIER, botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import type { MascotColorGroup } from "../../../shared/mascot-colors";
import { completeMascotLook, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS, type MascotCharacter, type MascotLook, type MascotShape, type ShapeSkin, type SkinTier } from "../../../shared/mascot-look";
import { ShapeMascot } from "@/components/ShapeMascot";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import "@/components/skin-fx/skin-fx.css";
import type { MascotActivity } from "./behavior";
import { colorTabFor, colorTabs, nextTab, skinTabFor, skinTierTabs } from "./editor-tabs";
import { MASCOTS, mascotFor, SHAPE_CHOICES } from "./mascots";

export interface MascotLookPatch {
  color?: MausColor;
  mascotSkin?: MascotSkinId;
  mascotLook?: MascotLook;
}

export interface MascotLookEditorProps {
  bot: { color: MausColor; mascotSkin?: MascotSkinId | null; mascotLook?: MascotLook | null };
  disabled?: boolean;
  onPatch: (patch: MascotLookPatch) => void;
  /** The owl's wing moves also play on the bot's avatars across the app. */
  onOwlMove?: (move: Exclude<MausMotion, "none">) => void;
  /** A shape's or Trombi's move, played by the bot's avatar above (the preview). */
  onMove?: (clip: MascotActivity) => void;
}

export const CHARACTER_LABEL = {
  owl: "floatingBots.mascot.owl",
  shape: "floatingBots.mascot.body",
  trombi: "floatingBots.mascot.trombi",
} satisfies Record<MascotCharacter, LocaleKey>;

export const SHAPE_LABEL = {
  circle: "mascot.shape.circle",
  cloud: "mascot.shape.cloud",
  squircle: "mascot.shape.squircle",
  sparkle: "mascot.shape.sparkle",
  clover: "mascot.shape.clover",
  bean: "mascot.shape.bean",
  flower: "mascot.shape.flower",
  drop: "mascot.shape.drop",
  pill: "mascot.shape.pill",
  pick: "mascot.shape.pick",
  house: "mascot.shape.house",
  star: "mascot.shape.star",
  hexagon: "mascot.shape.hexagon",
} satisfies Record<MascotShape, LocaleKey>;

export const SHAPE_SKIN_LABEL = {
  plain: "mascot.shapeSkin.plain",
  pastel: "mascot.shapeSkin.pastel",
  glossy: "mascot.shapeSkin.glossy",
  night: "mascot.shapeSkin.night",
  outline: "mascot.shapeSkin.outline",
  gold: "mascot.shapeSkin.gold",
  neon: "mascot.shapeSkin.neon",
  chrome: "mascot.shapeSkin.chrome",
  crystal: "mascot.shapeSkin.crystal",
  circuit: "mascot.shapeSkin.circuit",
  holo: "mascot.shapeSkin.holo",
  molten: "mascot.shapeSkin.molten",
  galaxy: "mascot.shapeSkin.galaxy",
} satisfies Record<(typeof SHAPE_SKINS)[number], LocaleKey>;

export const TROMBI_SKIN_LABEL = {
  classic: "mascot.trombiSkin.classic",
  retro98: "mascot.trombiSkin.retro98",
  gold: "mascot.trombiSkin.gold",
  neon: "mascot.trombiSkin.neon",
  chrome: "mascot.trombiSkin.chrome",
  glitch: "mascot.trombiSkin.glitch",
  holo: "mascot.trombiSkin.holo",
  molten: "mascot.trombiSkin.molten",
} satisfies Record<(typeof TROMBI_SKINS)[number], LocaleKey>;

export const SKIN_TIER_LABEL = {
  common: "mascot.tier.common",
  rare: "mascot.tier.rare",
  epic: "mascot.tier.epic",
  legendary: "mascot.tier.legendary",
} satisfies Record<SkinTier, LocaleKey>;

export const OWL_SKIN_LABEL = {
  none: "mascot.skin.classic",
  snowy: "mascot.skin.snowy",
  barn: "mascot.skin.barn",
  carbon: "mascot.skin.carbon",
  gold: "mascot.skin.gold",
  frost: "mascot.skin.frost",
  neon: "mascot.skin.neon",
  lightning: "mascot.skin.lightning",
  chrome: "mascot.skin.chrome",
  inferno: "mascot.skin.inferno",
  holo: "mascot.skin.holo",
  galaxy: "mascot.skin.galaxy",
  spirit: "mascot.skin.spirit",
} satisfies Record<MascotSkinId, LocaleKey>;

export const COLOR_GROUP_LABEL = {
  vivid: "mascot.color.group.vivid",
  pastel: "mascot.color.group.pastel",
  deep: "mascot.color.group.deep",
  neon: "mascot.color.group.neon",
  neutral: "mascot.color.group.neutral",
} satisfies Record<MascotColorGroup, LocaleKey>;

const OWL_MOVE_LABEL = {
  "spread-wings": "mascot.motion.spreadWings",
  flap: "mascot.motion.flap",
  "take-off": "mascot.motion.takeOff",
  shake: "mascot.motion.shake",
  hoot: "mascot.motion.hoot",
} satisfies Record<(typeof MAUS_WING_MOTIONS)[number], LocaleKey>;

/** The skin effect each of the owl's wing moves plays on the preview (SkinFx.tsx MoveFx). */
const OWL_MOVE_FX: Record<(typeof MAUS_WING_MOTIONS)[number], MascotActivity> = {
  "spread-wings": "wave",
  flap: "hop",
  "take-off": "jump",
  shake: "dance",
  hoot: "hoot",
};

const MOVE_LABEL: Partial<Record<MascotActivity, LocaleKey>> = {
  wave: "floatingBots.move.wave",
  dance: "floatingBots.move.dance",
  jump: "floatingBots.move.jump",
  hop: "floatingBots.move.hop",
  love: "floatingBots.move.love",
  hoot: "floatingBots.move.hoot",
};

// A section's title row stays on top while its options scroll under it, so a
// long popover keeps its bearings; it spans the popover's padding (p-3.5, so it
// sticks 14px up, flush with the popover's edge) and covers what scrolls under it.
const sectionHead = "sticky top-[-14px] z-10 -mx-3.5 mb-1 mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-card px-3.5 pb-1 pt-2";
const heading = "text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary";
const card = "flex flex-col items-center justify-center gap-0.5 rounded-lg bg-inset p-1 transition-colors hover:bg-control disabled:opacity-50";
const on = "ring-2 ring-accent-border";

function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={sectionHead} data-section-head="">
      <span className={heading}>{title}</span>
      {children}
    </div>
  );
}

interface SegmentItem<T extends string> {
  id: T;
  label: string;
  /** A count badge (skins in a rarity). */
  count?: number;
  /** A small dot in a color (the palette holding the current color). */
  dot?: string;
  tier?: SkinTier;
}

/**
 * A segmented control: one tab per group, the arrow keys move between them.
 * The panel it controls follows it (role tabpanel, aria-labelledby).
 */
function SegmentedTabs<T extends string>({ label, items, value, onChange, idPrefix, data }: { label: string; items: SegmentItem<T>[]; value: T; onChange: (id: T) => void; idPrefix: string; data: string }) {
  const ids = items.map((item) => item.id);
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-0.5 rounded-lg bg-inset p-0.5" {...{ [data]: "" }}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            aria-label={item.count != null ? t("mascot.tier.tab", { tier: item.label, count: item.count }) : undefined}
            tabIndex={selected ? 0 : -1}
            data-tab={item.id}
            data-tier={item.tier}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              const next = nextTab(ids, value, event.key);
              if (next == null) return;
              event.preventDefault();
              onChange(next);
              const sibling = event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tab="${next}"]`);
              sibling?.focus();
            }}
            className={cn(
              "segment-tab inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4 transition-colors",
              selected ? "bg-control text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
            )}
          >
            {item.dot && <span className="size-2 rounded-full ring-1 ring-white/40" style={{ backgroundColor: item.dot }} aria-hidden="true" />}
            <span>{item.label}</span>
            {item.count != null && (
              <span className="segment-count rounded-full bg-panel/70 px-1 text-[10px] leading-[14px] tabular-nums text-ink-secondary" aria-hidden="true">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A skin's card: its animated preview, its name and its rarity, shimmering above Common. */
function SkinCard({ tier, label, checked, disabled, onSelect, data, children }: { tier: SkinTier; label: string; checked: boolean; disabled?: boolean; onSelect: () => void; data: Record<string, string>; children: ReactNode }) {
  const tierLabel = t(SKIN_TIER_LABEL[tier]);
  return (
    <button
      type="button"
      role="radio"
      disabled={disabled}
      aria-checked={checked}
      aria-label={`${label}, ${tierLabel}`}
      title={`${label} (${tierLabel})`}
      data-tier={tier}
      {...data}
      onClick={onSelect}
      className={cn(card, "skin-card h-[70px] gap-0 pt-1", checked && on)}
    >
      <span className="grid size-[40px] place-items-center" aria-hidden="true">
        {children}
      </span>
      <span className="w-full truncate text-center text-[10.5px] leading-[13px] text-ink">{label}</span>
      <span className="skin-tier" data-tier={tier} aria-hidden="true">
        {tierLabel}
      </span>
    </button>
  );
}

/**
 * The skins of one character, one rarity at a time. Opens on the current
 * skin's rarity and follows it when it changes elsewhere (Reset); only the
 * open tab's cards are drawn, so the popover animates a handful at most.
 */
function SkinPicker<S extends string>({ skins, tierOf, selected, labelOf, idPrefix, dataKey, disabled, onSelect, preview }: { skins: readonly S[]; tierOf: Readonly<Record<S, SkinTier>>; selected: S; labelOf: (skin: S) => string; idPrefix: string; dataKey: string; disabled?: boolean; onSelect: (skin: S) => void; preview: (skin: S) => ReactNode }) {
  const tabs = skinTierTabs(skins, tierOf);
  const [tab, setTab] = useState<SkinTier>(() => skinTabFor(selected, skins, tierOf));
  const followed = useRef(selected);
  useEffect(() => {
    if (followed.current === selected) return;
    followed.current = selected;
    setTab(skinTabFor(selected, skins, tierOf));
  }, [selected, skins, tierOf]);
  const open = tabs.find((item) => item.tier === tab) ?? tabs[0];
  return (
    <>
      <SectionHead title={t("mascot.skin.title")}>
        <SegmentedTabs
          label={t("mascot.tier.tabs")}
          idPrefix={idPrefix}
          data="data-skin-tabs"
          value={open.tier}
          onChange={setTab}
          items={tabs.map((item) => ({ id: item.tier, label: t(SKIN_TIER_LABEL[item.tier]), count: item.count, tier: item.tier }))}
        />
      </SectionHead>
      <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${open.tier}`} data-skin-panel={open.tier}>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t("mascot.skin.title")}>
          {open.skins.map((skin) => (
            <SkinCard key={skin} tier={tierOf[skin]} label={labelOf(skin)} checked={selected === skin} disabled={disabled} data={{ [dataKey]: skin }} onSelect={() => onSelect(skin)}>
              {preview(skin)}
            </SkinCard>
          ))}
        </div>
      </div>
    </>
  );
}

/** The bot colors, one palette at a time; opens on the current color's palette. */
function ColorPicker({ color, disabled, onSelect }: { color: MausColor; disabled?: boolean; onSelect: (color: MausColor) => void }) {
  const tabs = colorTabs();
  const [tab, setTab] = useState<MascotColorGroup>(() => colorTabFor(color));
  const followed = useRef(color);
  useEffect(() => {
    if (followed.current === color) return;
    followed.current = color;
    setTab(colorTabFor(color));
  }, [color]);
  const current = colorTabFor(color);
  const open = tabs.find((item) => item.group === tab) ?? tabs[0];
  return (
    <>
      <SectionHead title={t("mascot.color.title")}>
        <SegmentedTabs
          label={t("mascot.color.groups")}
          idPrefix="mascot-color"
          data="data-color-tabs"
          value={open.group}
          onChange={setTab}
          items={tabs.map((item) => ({ id: item.group, label: t(COLOR_GROUP_LABEL[item.group]), dot: item.group === current ? MAUS_COLORS[color] : undefined }))}
        />
      </SectionHead>
      <div id="mascot-color-panel" role="tabpanel" aria-labelledby={`mascot-color-tab-${open.group}`} data-color-panel={open.group}>
        <div className="flex flex-wrap gap-1.5 px-0.5 py-0.5" role="radiogroup" aria-label={t("mascot.color.title")}>
          {open.colors.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              disabled={disabled}
              aria-checked={color === name}
              data-mascot-color={name}
              onClick={() => onSelect(name)}
              className={cn("size-6 rounded-full disabled:opacity-50", color === name && "ring-2 ring-white/80 ring-offset-2 ring-offset-card")}
              style={swatchStyle(name)}
              title={name}
              aria-label={t("mascot.color.use", { color: name })}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export default function MascotLookEditor({ bot, disabled, onPatch, onOwlMove, onMove }: MascotLookEditorProps) {
  const look = completeMascotLook(bot.mascotLook);
  const owlSkin = botMascotSkin(bot.mascotSkin);
  const setLook = (next: Partial<MascotLook>) => onPatch({ mascotLook: { ...look, ...next, skins: { ...look.skins, ...next.skins } } });

  const colors = <ColorPicker color={bot.color} disabled={disabled} onSelect={(color) => onPatch({ color })} />;

  const moves: { id: string; label: string; clip: MascotActivity; owl?: (typeof MAUS_WING_MOTIONS)[number] }[] =
    look.character === "owl"
      ? MAUS_WING_MOTIONS.map((owlMove) => ({ id: owlMove, label: t(OWL_MOVE_LABEL[owlMove]), clip: OWL_MOVE_FX[owlMove], owl: owlMove }))
      : mascotFor(look).moves.map((clip) => ({ id: clip, label: t(MOVE_LABEL[clip] ?? "floatingBots.move.hop"), clip }));

  return (
    <div data-mascot-look-editor="">
      {/* the character row, full width: the bot's avatar above is the preview */}
      <SectionHead title={t("mascot.character.title")} />
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("mascot.character.title")} data-character-row="">
        {MASCOTS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            disabled={disabled}
            aria-checked={look.character === option.id}
            data-character-option={option.id}
            onClick={() => setLook({ character: option.id })}
            className={cn(card, "h-[46px] flex-row gap-2 px-2", look.character === option.id && on)}
          >
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden" aria-hidden="true">
              <option.Thumb color={bot.color} skin={owlSkin} look={{ ...look, character: option.id }} size={30} />
            </span>
            <span className="truncate text-[11.5px] leading-4 text-ink">{t(CHARACTER_LABEL[option.id])}</span>
          </button>
        ))}
      </div>

      {look.character === "owl" && (
        <div data-character-options="owl">
          {colors}
          <SkinPicker
            key="owl"
            skins={MASCOT_SKIN_IDS}
            tierOf={OWL_SKIN_TIER}
            selected={owlSkin}
            labelOf={(skin) => t(OWL_SKIN_LABEL[skin])}
            idPrefix="owl-skin"
            dataKey="data-mascot-skin-option"
            disabled={disabled}
            onSelect={(skin) => onPatch({ mascotSkin: skin })}
            preview={(skin) => <MausAvatar color={bot.color} skin={skin} state="idle" size={38} animated={false} skinAnimated trackPointer={false} />}
          />
          <SectionHead title={t("floatingBots.mascot.style")} />
          <div className="flex gap-1.5" role="radiogroup" aria-label={t("floatingBots.mascot.style")}>
            {(["2d", "3d"] as const).map((style) => (
              <button
                key={style}
                type="button"
                role="radio"
                disabled={disabled}
                aria-checked={look.style === style}
                data-character-style={style}
                onClick={() => setLook({ style })}
                className={cn("rounded-lg px-3 py-1 text-[12px]", look.style === style ? "bg-control text-ink" : "bg-inset text-ink-secondary hover:text-ink")}
              >
                {t(style === "2d" ? "floatingBots.mascot.flat" : "floatingBots.mascot.threeD")}
              </button>
            ))}
          </div>
        </div>
      )}

      {look.character === "shape" && (
        <div data-character-options="shape">
          <SectionHead title={t("floatingBots.mascot.shape")} />
          {/* 13 shapes on two rows; each previews the current color and skin, still and cheap */}
          <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label={t("floatingBots.mascot.shape")}>
            {SHAPE_CHOICES.map((shape) => (
              <button
                key={shape}
                type="button"
                role="radio"
                disabled={disabled}
                aria-checked={look.shape === shape}
                data-character-shape={shape}
                aria-label={t(SHAPE_LABEL[shape])}
                title={t(SHAPE_LABEL[shape])}
                onClick={() => setLook({ shape })}
                className={cn(card, "h-[40px]", look.shape === shape && on)}
              >
                <ShapeThumbnail shape={shape} skin={look.skins.shape} color={bot.color} size={28} />
              </button>
            ))}
          </div>
          {colors}
          <SkinPicker
            key="shape"
            skins={SHAPE_SKINS}
            tierOf={SHAPE_SKIN_TIER}
            selected={look.skins.shape}
            labelOf={(skin) => t(SHAPE_SKIN_LABEL[skin])}
            idPrefix="shape-skin"
            dataKey="data-shape-skin-option"
            disabled={disabled}
            onSelect={(skin) => setLook({ skins: { ...look.skins, shape: skin } })}
            preview={(skin) => <ShapeMascot shape={look.shape} skin={skin} color={bot.color} size={38} detail="full" label={null} />}
          />
        </div>
      )}

      {look.character === "trombi" && (
        <div data-character-options="trombi">
          <SkinPicker
            key="trombi"
            skins={TROMBI_SKINS}
            tierOf={TROMBI_SKIN_TIER}
            selected={look.skins.trombi}
            labelOf={(skin) => t(TROMBI_SKIN_LABEL[skin])}
            idPrefix="trombi-skin"
            dataKey="data-trombi-skin-option"
            disabled={disabled}
            onSelect={(skin) => setLook({ skins: { ...look.skins, trombi: skin } })}
            preview={(skin) => <SkinnedTrombi skin={skin} pose="idle" size={40} width={30} detail="full" label={null} />}
          />
        </div>
      )}

      <SectionHead title={t("mascot.moves.title")} />
      <div className="flex flex-wrap gap-1">
        {moves.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            data-character-move={item.id}
            aria-label={t("mascot.moves.play", { move: item.label })}
            onClick={() => {
              if (item.owl) onOwlMove?.(item.owl);
              // every move also plays its skin's effect on the preview above
              onMove?.(item.clip);
            }}
            className="rounded-lg bg-control px-2.5 py-1 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A shape's thumbnail in the Shape grid: that shape in the bot's current
 * color and skin, in the skin's still look (no filter, nothing animated), so
 * every thumbnail matches the preview above and costs nothing.
 */
export function ShapeThumbnail({ shape, skin, color, size }: { shape: MascotShape; skin: ShapeSkin; color: string; size: number }) {
  return <ShapeMascot shape={shape} skin={skin} color={color} size={size} animated={false} detail="static" label={null} />;
}
