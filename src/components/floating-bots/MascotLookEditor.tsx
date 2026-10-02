// The Bot tab of the bot's avatar popover: the bot's character and its look,
// stored with the bot (bot.mascotLook, bot.color, bot.mascotSkin), so the
// change shows everywhere the bot appears and on its desktop mascot.
//
//   Character: Owl, Original shapes, Trombi (the registry, mascots.tsx), beside
//   a small live preview that plays the move picked below
//   that character's own options:
//     Owl: color, skin, style 2D / 3D (preview)
//     Original shapes: shape, color, shape skin
//     Trombi: Trombi skin
//   Moves: that character's moves only
//
// Each character keeps its own skin, so switching and back finds it again.
// Loaded lazily with the popover.
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MAUS_COLOR_NAMES, MAUS_WING_MOTIONS, swatchStyle, type MausColor, type MausMotion } from "@/lib/mascot";
import { MausAvatar } from "@/components/Avatar";
import { MASCOT_SKIN_IDS, botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import { completeMascotLook, SHAPE_SKINS, TROMBI_SKINS, type MascotCharacter, type MascotLook, type MascotShape } from "../../../shared/mascot-look";
import { mascotMotion, type MascotActivity } from "./behavior";
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
  glossy: "mascot.shapeSkin.glossy",
  outline: "mascot.shapeSkin.outline",
  neon: "mascot.shapeSkin.neon",
  pastel: "mascot.shapeSkin.pastel",
  night: "mascot.shapeSkin.night",
} satisfies Record<(typeof SHAPE_SKINS)[number], LocaleKey>;

export const TROMBI_SKIN_LABEL = {
  classic: "mascot.trombiSkin.classic",
  gold: "mascot.trombiSkin.gold",
  neon: "mascot.trombiSkin.neon",
  retro98: "mascot.trombiSkin.retro98",
} satisfies Record<(typeof TROMBI_SKINS)[number], LocaleKey>;

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

const PREVIEW = 60;
const heading = "mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary";
const card = "flex flex-col items-center justify-center gap-0.5 rounded-lg bg-inset p-1 transition-colors hover:bg-control disabled:opacity-50";
const on = "ring-2 ring-accent-border";

export default function MascotLookEditor({ bot, disabled, onPatch, onOwlMove }: MascotLookEditorProps) {
  const look = completeMascotLook(bot.mascotLook);
  const entry = mascotFor(look);
  const owlSkin = botMascotSkin(bot.mascotSkin);
  const [move, setMove] = useState<{ clip: MascotActivity; at: number } | null>(null);
  const moveRef = useRef(move);
  moveRef.current = move;
  const setLook = (next: Partial<MascotLook>) => onPatch({ mascotLook: { ...look, ...next, skins: { ...look.skins, ...next.skins } } });
  const play = (clip: MascotActivity) => setMove({ clip, at: performance.now() });

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
      {/* the character row, with a small live preview of the chosen one (it plays the moves below) */}
      <div className="flex items-center gap-3">
        <span className="grid size-[64px] shrink-0 place-items-end overflow-visible rounded-xl bg-inset" aria-hidden="true">
          <entry.Render
            key={`${entry.id}-${move?.at ?? 0}`}
            color={bot.color}
            skin={owlSkin}
            look={look}
            size={PREVIEW}
            activity={move?.clip ?? "idle"}
            pose="idle"
            frame={(now) => mascotMotion({ activity: moveRef.current?.clip ?? "idle", since: moveRef.current?.at ?? 0, facing: 1, moveMs: 1600 }, { now, pose: "idle", reduced: false, gaze: null })}
            fps={() => 30}
            onHitTest={() => undefined}
          />
        </span>
        <div className="min-w-0 flex-1">
      <div className={cn(heading, "mt-0")}>{t("mascot.character.title")}</div>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("mascot.character.title")}>
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
        </div>
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
          <div className="grid grid-cols-6 gap-1" role="radiogroup" aria-label={t("mascot.skin.title")}>
            {SHAPE_SKINS.map((skin) => (
              <button
                key={skin}
                type="button"
                role="radio"
                disabled={disabled}
                aria-checked={look.skins.shape === skin}
                data-shape-skin-option={skin}
                onClick={() => setLook({ skins: { ...look.skins, shape: skin } })}
                className={cn(card, "h-[58px]", look.skins.shape === skin && on)}
              >
                <entry.Thumb color={bot.color} skin={owlSkin} look={{ ...look, skins: { ...look.skins, shape: skin } }} size={30} />
                <span className="w-full truncate text-center text-[10px] leading-3 text-ink-secondary">{t(SHAPE_SKIN_LABEL[skin])}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {look.character === "trombi" && (
        <div data-character-options="trombi">
          <div className={heading}>{t("mascot.skin.title")}</div>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t("mascot.skin.title")}>
            {TROMBI_SKINS.map((skin) => (
              <button
                key={skin}
                type="button"
                role="radio"
                disabled={disabled}
                aria-checked={look.skins.trombi === skin}
                data-trombi-skin-option={skin}
                onClick={() => setLook({ skins: { ...look.skins, trombi: skin } })}
                className={cn(card, "h-[64px]", look.skins.trombi === skin && on)}
              >
                <entry.Thumb color={bot.color} skin={owlSkin} look={{ ...look, skins: { ...look.skins, trombi: skin } }} size={40} />
                <span className="text-[11px] leading-4 text-ink-secondary">{t(TROMBI_SKIN_LABEL[skin])}</span>
              </button>
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
              play(item.clip);
              if (item.owl) onOwlMove?.(item.owl);
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
