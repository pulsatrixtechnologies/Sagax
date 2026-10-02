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
//   Skins show as cards with their rarity (Common, Rare, Epic, Legendary),
//   each previewing the skin animated.
//   Moves: that character's moves only
//
// Each character keeps its own skin, so switching and back finds it again.
// Loaded lazily with the popover.
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MAUS_COLOR_NAMES, MAUS_WING_MOTIONS, swatchStyle, type MausColor, type MausMotion } from "@/lib/mascot";
import { MausAvatar } from "@/components/Avatar";
import { MASCOT_SKIN_IDS, botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import { completeMascotLook, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS, type MascotCharacter, type MascotLook, type MascotShape, type SkinTier } from "../../../shared/mascot-look";
import { ShapeMascot } from "@/components/ShapeMascot";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import "@/components/skin-fx/skin-fx.css";
import type { MascotActivity } from "./behavior";
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

const OWL_SKIN_LABEL = {
  none: "mascot.skin.none",
  lightning: "mascot.skin.lightning",
  gold: "mascot.skin.gold",
  neon: "mascot.skin.neon",
  inferno: "mascot.skin.inferno",
  frost: "mascot.skin.frost",
  carbon: "mascot.skin.carbon",
} satisfies Record<MascotSkinId, LocaleKey>;

const OWL_MOVE_LABEL = {
  "spread-wings": "mascot.motion.spreadWings",
  flap: "mascot.motion.flap",
  "take-off": "mascot.motion.takeOff",
  shake: "mascot.motion.shake",
  hoot: "mascot.motion.hoot",
} satisfies Record<(typeof MAUS_WING_MOTIONS)[number], LocaleKey>;

/** The preview's clip for each of the owl's wing moves. */
const OWL_MOVE_CLIP: Record<(typeof MAUS_WING_MOTIONS)[number], MascotActivity> = {
  "spread-wings": "stretch",
  flap: "fly",
  "take-off": "jump",
  shake: "ruffle",
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

const heading = "mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary";
const card = "flex flex-col items-center justify-center gap-0.5 rounded-lg bg-inset p-1 transition-colors hover:bg-control disabled:opacity-50";
const on = "ring-2 ring-accent-border";

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
      className={cn(card, "skin-card h-[78px] gap-0 pt-1.5", checked && on)}
    >
      <span className="grid size-[44px] place-items-center" aria-hidden="true">
        {children}
      </span>
      <span className="w-full truncate text-center text-[10.5px] leading-[13px] text-ink">{label}</span>
      <span className="skin-tier" data-tier={tier} aria-hidden="true">
        {tierLabel}
      </span>
    </button>
  );
}

export default function MascotLookEditor({ bot, disabled, onPatch, onOwlMove, onMove }: MascotLookEditorProps) {
  const look = completeMascotLook(bot.mascotLook);
  const entry = mascotFor(look);
  const owlSkin = botMascotSkin(bot.mascotSkin);
  const setLook = (next: Partial<MascotLook>) => onPatch({ mascotLook: { ...look, ...next, skins: { ...look.skins, ...next.skins } } });

  const colors = (
    <>
      <div className={heading}>{t("mascot.color.title")}</div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("mascot.color.title")}>
        {MAUS_COLOR_NAMES.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            disabled={disabled}
            aria-checked={bot.color === color}
            onClick={() => onPatch({ color })}
            className={cn("size-6 rounded-full disabled:opacity-50", bot.color === color && "ring-2 ring-white/80 ring-offset-2 ring-offset-card")}
            style={swatchStyle(color)}
            title={color}
            aria-label={`Use ${color} mascot color`}
          />
        ))}
      </div>
    </>
  );

  const moves: { id: string; label: string; clip: MascotActivity; owl?: (typeof MAUS_WING_MOTIONS)[number] }[] =
    look.character === "owl"
      ? MAUS_WING_MOTIONS.map((owlMove) => ({ id: owlMove, label: t(OWL_MOVE_LABEL[owlMove]), clip: OWL_MOVE_CLIP[owlMove], owl: owlMove }))
      : entry.moves.map((clip) => ({ id: clip, label: t(MOVE_LABEL[clip] ?? "floatingBots.move.hop"), clip }));

  return (
    <div data-mascot-look-editor="">
      {/* the character row, full width: the bot's avatar above is the preview */}
      <div className={cn(heading, "mt-0")}>{t("mascot.character.title")}</div>
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
            className={cn(card, "h-[64px]", look.character === option.id && on)}
          >
            <span className="grid size-9 place-items-center overflow-hidden" aria-hidden="true">
              <option.Thumb color={bot.color} skin={owlSkin} look={{ ...look, character: option.id }} size={34} />
            </span>
            <span className="truncate text-[11px] leading-4 text-ink">{t(CHARACTER_LABEL[option.id])}</span>
          </button>
        ))}
      </div>

      {look.character === "owl" && (
        <div data-character-options="owl">
          {colors}
          <div className={heading}>{t("mascot.skin.title")}</div>
          <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label={t("mascot.skin.title")}>
            {MASCOT_SKIN_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                disabled={disabled}
                aria-checked={owlSkin === id}
                aria-label={t("mascot.skin.use", { skin: t(OWL_SKIN_LABEL[id]) })}
                data-mascot-skin-option={id}
                onClick={() => onPatch({ mascotSkin: id })}
                className={cn(card, "h-[60px]", owlSkin === id && on)}
              >
                <MausAvatar color={bot.color} skin={id} state="idle" size={36} animated={false} skinAnimated trackPointer={false} />
                <span className="w-full truncate text-center text-[10px] leading-3 text-ink-secondary">{t(OWL_SKIN_LABEL[id])}</span>
              </button>
            ))}
          </div>
          <div className={heading}>{t("floatingBots.mascot.style")}</div>
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
                className={cn("rounded-lg px-3 py-1.5 text-[12px]", look.style === style ? "bg-control text-ink" : "bg-inset text-ink-secondary hover:text-ink")}
              >
                {t(style === "2d" ? "floatingBots.mascot.flat" : "floatingBots.mascot.threeD")}
              </button>
            ))}
          </div>
        </div>
      )}

      {look.character === "shape" && (
        <div data-character-options="shape">
          <div className={heading}>{t("floatingBots.mascot.shape")}</div>
          {/* 13 shapes, 5-5-3 like the reference grid */}
          <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={t("floatingBots.mascot.shape")}>
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
                className={cn(card, "h-[46px]", look.shape === shape && on)}
              >
                <entry.Thumb color={bot.color} skin={owlSkin} look={{ ...look, shape }} size={32} />
              </button>
            ))}
          </div>
          {colors}
          <div className={heading}>{t("mascot.skin.title")}</div>
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t("mascot.skin.title")}>
            {SHAPE_SKINS.map((skin) => (
              <SkinCard
                key={skin}
                tier={SHAPE_SKIN_TIER[skin]}
                label={t(SHAPE_SKIN_LABEL[skin])}
                checked={look.skins.shape === skin}
                disabled={disabled}
                data={{ "data-shape-skin-option": skin }}
                onSelect={() => setLook({ skins: { ...look.skins, shape: skin } })}
              >
                <ShapeMascot shape={look.shape} skin={skin} color={bot.color} size={40} detail="full" label={null} />
              </SkinCard>
            ))}
          </div>
        </div>
      )}

      {look.character === "trombi" && (
        <div data-character-options="trombi">
          <div className={heading}>{t("mascot.skin.title")}</div>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t("mascot.skin.title")}>
            {TROMBI_SKINS.map((skin) => (
              <SkinCard
                key={skin}
                tier={TROMBI_SKIN_TIER[skin]}
                label={t(TROMBI_SKIN_LABEL[skin])}
                checked={look.skins.trombi === skin}
                disabled={disabled}
                data={{ "data-trombi-skin-option": skin }}
                onSelect={() => setLook({ skins: { ...look.skins, trombi: skin } })}
              >
                <SkinnedTrombi skin={skin} pose="idle" size={44} width={34} detail="full" label={null} />
              </SkinCard>
            ))}
          </div>
        </div>
      )}

      <div className={heading}>{t("mascot.moves.title")}</div>
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
              else onMove?.(item.clip);
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
