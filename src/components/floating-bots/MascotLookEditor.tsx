// The Bot tab of the bot's avatar popover: the bot's character and its look,
// stored with the bot (bot.mascotLook, bot.color, bot.mascotSkin), so the
// change shows everywhere the bot appears and on its desktop mascot.
//
//   Character: Owl, Shapes, Trombi, Bunbu, Shiba, Grump, Ogre, Frog (the registry, mascots.tsx), full width:
//   the bot's avatar above the popover (the bot panel's header) is the
//   preview, and plays the moves and the equip animation. Then that
//   character's own options:
//     Owl: color, skin
//     Shapes: shape (8), color (with the Clay palette), shape skin (Clay first)
//     Trombi: Trombi skin
//     Bunbu: color, Bunbu skin
//     Shiba: color, Shiba skin (the breed's coats, then premium editions)
//     Grump: color (the markings), Grump skin (the cat coats, then premium editions)
//     Ogre: color, Ogre skin (the ogre's hides, Lava and Armor, then premium editions)
//     Frog: color (a tint of the skin), Frog skin (real frogs, then premium editions)
//   Colors show one palette at a time (Vivid, Pastel, Deep, Neon, Neutral),
//   skins one rarity at a time (Common, Rare, Epic, Legendary), each tab
//   opening on the current choice (editor-tabs.ts). Skin cards preview the
//   skin animated; the Shape grid previews the current color and skin still.
//   Section titles stay on top while their options scroll (sticky).
//   Moves: that character's moves only (Shapes: its fourteen), each with its skin's effect
//
// Each character keeps its own skin, so switching and back finds it again.
// Loaded lazily with the popover.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { characterLock, characterUnlocked, lockHint, reportAchievement, skinLock, useUnlocks, type LockInfo } from "@/lib/achievements";
import { useGrokAccountLinked } from "@/lib/grok-account";
import "@/components/achievements/achievements.css";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MAUS_COLORS, swatchStyle, type MausColor, type MausMotion } from "@/lib/mascot";
import { MausAvatar } from "@/components/Avatar";
import { MASCOT_SKIN_IDS, OWL_SKIN_TIER, botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import type { MascotColorGroup } from "../../../shared/mascot-colors";
import { BUNBU_SKIN_TIER, BUNBU_SKINS, completeMascotLook, FROG_SKIN_TIER, FROG_SKINS, GRUMP_SKIN_TIER, GRUMP_SKINS, OGRE_SKIN_TIER, OGRE_SKINS, SHIBA_SKIN_TIER, SHIBA_SKINS, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS, type MascotCharacter, type MascotLook, type MascotShape, type ShapeSkin, type SkinTier } from "../../../shared/mascot-look";
import { ShapeMascot } from "@/components/ShapeMascot";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import { BunbuMascot } from "@/components/BunbuMascot";
import { ShibaMascot } from "@/components/ShibaMascot";
import { GrumpMascot } from "@/components/GrumpMascot";
import { OgreMascot } from "@/components/OgreMascot";
import { FrogMascot } from "@/components/FrogMascot";
import "@/components/skin-fx/skin-fx.css";
import { colorGroupsFor, colorTabFor, colorTabs, nextTab, skinTabFor, skinTierTabs } from "./editor-tabs";
import { MASCOTS, SHAPE_CHOICES } from "./mascots";
import { characterMoves, type OwlMove } from "./moves";

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
  /** A character's move (a Shapes move, a Trombi or Bunbu clip), played by the bot's avatar above (the preview). */
  onMove?: (clip: string) => void;
}

export const CHARACTER_LABEL = {
  owl: "floatingBots.mascot.owl",
  shape: "floatingBots.mascot.body",
  trombi: "floatingBots.mascot.trombi",
  bunbu: "floatingBots.mascot.bunbu",
  shiba: "floatingBots.mascot.shiba",
  grump: "floatingBots.mascot.grump",
  ogre: "floatingBots.mascot.ogre",
  frog: "floatingBots.mascot.frog",
} satisfies Record<MascotCharacter, LocaleKey>;

export const SHAPE_LABEL = {
  circle: "mascot.shape.circle",
  bean: "mascot.shape.pebble",
  squircle: "mascot.shape.squircle",
  pill: "mascot.shape.capsule",
  pick: "mascot.shape.triangle",
  hexagon: "mascot.shape.hexagon",
  cloud: "mascot.shape.cloud",
  drop: "mascot.shape.droplet",
} satisfies Record<MascotShape, LocaleKey>;

export { SHAPE_MOVE_LABEL } from "./moves";

export const SHAPE_SKIN_LABEL = {
  plain: "mascot.shapeSkin.clay",
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

export const BUNBU_SKIN_LABEL = {
  plain: "mascot.bunbuSkin.plain",
  pastel: "mascot.bunbuSkin.pastel",
  night: "mascot.bunbuSkin.night",
  plush: "mascot.bunbuSkin.plush",
  velvet: "mascot.bunbuSkin.velvet",
  gold: "mascot.bunbuSkin.gold",
  neon: "mascot.bunbuSkin.neon",
  chrome: "mascot.bunbuSkin.chrome",
  crystal: "mascot.bunbuSkin.crystal",
  holo: "mascot.bunbuSkin.holo",
  galaxy: "mascot.bunbuSkin.galaxy",
  molten: "mascot.bunbuSkin.molten",
} satisfies Record<(typeof BUNBU_SKINS)[number], LocaleKey>;

export const SHIBA_SKIN_LABEL = {
  plain: "mascot.shibaSkin.plain",
  cream: "mascot.shibaSkin.cream",
  blacktan: "mascot.shibaSkin.blacktan",
  red: "mascot.shibaSkin.red",
  sesame: "mascot.shibaSkin.sesame",
  white: "mascot.shibaSkin.white",
  retro98: "mascot.shibaSkin.retro98",
  gold: "mascot.shibaSkin.gold",
  neon: "mascot.shibaSkin.neon",
  chrome: "mascot.shibaSkin.chrome",
  glitch: "mascot.shibaSkin.glitch",
  holo: "mascot.shibaSkin.holo",
  molten: "mascot.shibaSkin.molten",
} satisfies Record<(typeof SHIBA_SKINS)[number], LocaleKey>;

export const GRUMP_SKIN_LABEL = {
  plain: "mascot.grumpSkin.plain",
  tuxedo: "mascot.grumpSkin.tuxedo",
  calico: "mascot.grumpSkin.calico",
  tabby: "mascot.grumpSkin.tabby",
  siamese: "mascot.grumpSkin.siamese",
  retro98: "mascot.grumpSkin.retro98",
  gold: "mascot.grumpSkin.gold",
  void: "mascot.grumpSkin.void",
  neon: "mascot.grumpSkin.neon",
  chrome: "mascot.grumpSkin.chrome",
  glitch: "mascot.grumpSkin.glitch",
  holo: "mascot.grumpSkin.holo",
  molten: "mascot.grumpSkin.molten",
} satisfies Record<(typeof GRUMP_SKINS)[number], LocaleKey>;

export const OGRE_SKIN_LABEL = {
  plain: "mascot.ogreSkin.plain",
  swamp: "mascot.ogreSkin.swamp",
  moss: "mascot.ogreSkin.moss",
  stone: "mascot.ogreSkin.stone",
  lava: "mascot.ogreSkin.lava",
  armor: "mascot.ogreSkin.armor",
  retro98: "mascot.ogreSkin.retro98",
  gold: "mascot.ogreSkin.gold",
  neon: "mascot.ogreSkin.neon",
  chrome: "mascot.ogreSkin.chrome",
  glitch: "mascot.ogreSkin.glitch",
  holo: "mascot.ogreSkin.holo",
  molten: "mascot.ogreSkin.molten",
} satisfies Record<(typeof OGRE_SKINS)[number], LocaleKey>;

export const FROG_SKIN_LABEL = {
  plain: "mascot.frogSkin.plain",
  leaf: "mascot.frogSkin.leaf",
  tree: "mascot.frogSkin.tree",
  poison: "mascot.frogSkin.poison",
  bullfrog: "mascot.frogSkin.bullfrog",
  ghost: "mascot.frogSkin.ghost",
  retro98: "mascot.frogSkin.retro98",
  gold: "mascot.frogSkin.gold",
  neon: "mascot.frogSkin.neon",
  chrome: "mascot.frogSkin.chrome",
  glitch: "mascot.frogSkin.glitch",
  holo: "mascot.frogSkin.holo",
  molten: "mascot.frogSkin.molten",
} satisfies Record<(typeof FROG_SKINS)[number], LocaleKey>;

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
  clay: "mascot.color.group.clay",
} satisfies Record<MascotColorGroup, LocaleKey>;

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

/** A Mastery look's lock on its card: the padlock, and how far its achievement went. */
function LockBadge({ lock }: { lock: LockInfo }) {
  const item = lock.item;
  return (
    <>
      <span className="unlock-lock" aria-hidden="true"><Lock size={10} strokeWidth={2.6} /></span>
      {item && item.target > 0 && (
        <span className="unlock-progress" aria-hidden="true">
          <span style={{ width: `${Math.round((item.current / item.target) * 100)}%` }} />
        </span>
      )}
    </>
  );
}

/**
 * A skin's card: its animated preview, its name and its rarity, shimmering
 * above Common. Locked skins are not offered, except a Mastery skin
 * (shared/mascot-unlocks.ts), shown locked with the achievement that unlocks it.
 */
function SkinCard({ tier, label, checked, disabled, onSelect, data, lock, children }: { tier: SkinTier; label: string; checked: boolean; disabled?: boolean; onSelect: () => void; data: Record<string, string>; lock?: LockInfo; children: ReactNode }) {
  const tierLabel = t(SKIN_TIER_LABEL[tier]);
  const locked = Boolean(lock?.locked);
  const hint = locked && lock ? lockHint(lock) : "";
  return (
    <button
      type="button"
      role="radio"
      disabled={disabled || locked}
      aria-checked={checked}
      aria-label={locked ? `${label}, ${tierLabel}. ${hint}` : `${label}, ${tierLabel}`}
      title={locked ? `${label} (${tierLabel}). ${hint}` : `${label} (${tierLabel})`}
      data-tier={tier}
      data-locked={locked ? "" : undefined}
      data-unlock-achievement={locked ? lock?.achievement?.id : undefined}
      {...data}
      onClick={onSelect}
      className={cn(card, "skin-card relative h-[70px] gap-0 pt-1", checked && on)}
    >
      <span className="grid size-[40px] place-items-center" aria-hidden="true">
        {children}
      </span>
      <span className="w-full truncate text-center text-[10.5px] leading-[13px] text-ink">{label}</span>
      <span className="skin-tier" data-tier={tier} aria-hidden="true">
        {tierLabel}
      </span>
      {locked && lock && <LockBadge lock={lock} />}
    </button>
  );
}

/**
 * The skins of one character, one rarity at a time. Opens on the current
 * skin's rarity and follows it when it changes elsewhere (Reset); only the
 * open tab's cards are drawn, so the popover animates a handful at most.
 */
function SkinPicker<S extends string>({ skins, tierOf, selected, labelOf, idPrefix, dataKey, disabled, onSelect, preview, lockOf }: { skins: readonly S[]; tierOf: Readonly<Record<S, SkinTier>>; selected: S; labelOf: (skin: S) => string; idPrefix: string; dataKey: string; disabled?: boolean; onSelect: (skin: S) => void; preview: (skin: S) => ReactNode; lockOf?: (skin: S) => LockInfo }) {
  // A locked skin stays out of the picker, but a Mastery one shows locked (the goal is to want it). The one this bot wears stays, so the current look never vanishes.
  const offered = skins.filter((skin) => {
    const lock = lockOf?.(skin);
    return skin === selected || !lock?.locked || lock.mastery === true;
  });
  const tabs = skinTierTabs(offered, tierOf);
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
            <SkinCard key={skin} tier={tierOf[skin]} label={labelOf(skin)} checked={selected === skin} disabled={disabled} data={{ [dataKey]: skin }} lock={skin === selected ? undefined : lockOf?.(skin)} onSelect={() => onSelect(skin)}>
              {preview(skin)}
            </SkinCard>
          ))}
        </div>
      </div>
    </>
  );
}

/** The bot colors, one palette at a time; opens on the current color's palette. */
function ColorPicker({ color, groups, disabled, onSelect }: { color: MausColor; groups: readonly MascotColorGroup[]; disabled?: boolean; onSelect: (color: MausColor) => void }) {
  const tabs = colorTabs(groups);
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

export default function MascotLookEditor({ bot, disabled, onPatch: savePatch, onOwlMove, onMove }: MascotLookEditorProps) {
  const look = completeMascotLook(bot.mascotLook);
  const owlSkin = botMascotSkin(bot.mascotSkin);
  // what this person unlocked (src/lib/achievements.ts); what the bot wears now always stays.
  // A linked Grok account shows Shapes at once, before the reward key comes back.
  const stored = useUnlocks();
  const grokLinked = useGrokAccountLinked();
  const unlocks = grokLinked && stored.enforced && !stored.keys.has("character:shape")
    ? { enforced: true as const, keys: new Set([...stored.keys, "character:shape"]) }
    : stored;
  // a Mastery character stays in the row, locked, with the achievement that unlocks it
  const characters = MASCOTS.filter((option) => option.id === look.character || characterUnlocked(unlocks, option.id) || characterLock(unlocks, option.id).mastery === true);
  const onPatch = (patch: MascotLookPatch) => {
    savePatch(patch);
    reportAchievement("bot.customized", { key: patch.mascotLook?.character ?? look.character });
  };
  const setLook = (next: Partial<MascotLook>) => onPatch({ mascotLook: { ...look, ...next, skins: { ...look.skins, ...next.skins } } });

  const colors = <ColorPicker color={bot.color} groups={colorGroupsFor(look.character, bot.color)} disabled={disabled} onSelect={(color) => onPatch({ color })} />;

  // the same moves, with the same names, as the desktop mascot's "Moves" menu (moves.ts)
  const moves: { id: string; label: string; clip: string; owl?: OwlMove }[] = characterMoves(look).map((move) => ({ ...move, label: t(move.label) }));

  return (
    <div data-mascot-look-editor="">
      {/* the character row, full width: the bot's avatar above is the preview */}
      <SectionHead title={t("mascot.character.title")} />
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t("mascot.character.title")} data-character-row="">
        {characters.map((option) => {
          const lock = option.id === look.character ? undefined : characterLock(unlocks, option.id);
          const locked = Boolean(lock?.locked);
          return (
          <button
            key={option.id}
            type="button"
            role="radio"
            disabled={disabled || locked}
            aria-checked={look.character === option.id}
            data-character-option={option.id}
            data-locked={locked ? "" : undefined}
            data-unlock-achievement={locked ? lock?.achievement?.id : undefined}
            title={locked && lock ? lockHint(lock) : undefined}
            onClick={() => setLook({ character: option.id })}
            className={cn(card, "relative h-[46px] flex-row gap-2 px-2", look.character === option.id && on)}
          >
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden" aria-hidden="true">
              <option.Thumb color={bot.color} skin={owlSkin} look={{ ...look, character: option.id }} size={30} />
            </span>
            <span className="truncate text-[11.5px] leading-4 text-ink">{t(CHARACTER_LABEL[option.id])}</span>
            {locked && lock && <LockBadge lock={lock} />}
          </button>
          );
        })}
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
            lockOf={(skin) => (skin === owlSkin ? { locked: false } : skinLock(unlocks, "owl", skin))}
            preview={(skin) => <MausAvatar color={bot.color} skin={skin} state="idle" size={38} animated={false} skinAnimated trackPointer={false} />}
          />
        </div>
      )}

      {look.character === "shape" && (
        <div data-character-options="shape">
          <SectionHead title={t("floatingBots.mascot.shape")} />
          {/* 8 shapes on two rows; each previews the current color and skin, still and cheap */}
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={t("floatingBots.mascot.shape")}>
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
            lockOf={(skin) => skinLock(unlocks, "shape", skin)}
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
            lockOf={(skin) => skinLock(unlocks, "trombi", skin)}
            preview={(skin) => <SkinnedTrombi skin={skin} pose="idle" size={40} width={30} detail="full" label={null} />}
          />
        </div>
      )}

      {look.character === "bunbu" && (
        <div data-character-options="bunbu">
          {colors}
          <SkinPicker
            key="bunbu"
            skins={BUNBU_SKINS}
            tierOf={BUNBU_SKIN_TIER}
            selected={look.skins.bunbu}
            labelOf={(skin) => t(BUNBU_SKIN_LABEL[skin])}
            idPrefix="bunbu-skin"
            dataKey="data-bunbu-skin-option"
            disabled={disabled}
            onSelect={(skin) => setLook({ skins: { ...look.skins, bunbu: skin } })}
            lockOf={(skin) => skinLock(unlocks, "bunbu", skin)}
            preview={(skin) => <BunbuMascot skin={skin} color={bot.color} size={38} detail="full" label={null} />}
          />
        </div>
      )}

      {look.character === "shiba" && (
        <div data-character-options="shiba">
          {colors}
          <SkinPicker
            key="shiba"
            skins={SHIBA_SKINS}
            tierOf={SHIBA_SKIN_TIER}
            selected={look.skins.shiba}
            labelOf={(skin) => t(SHIBA_SKIN_LABEL[skin])}
            idPrefix="shiba-skin"
            dataKey="data-shiba-skin-option"
            disabled={disabled}
            onSelect={(skin) => setLook({ skins: { ...look.skins, shiba: skin } })}
            lockOf={(skin) => skinLock(unlocks, "shiba", skin)}
            preview={(skin) => <ShibaMascot skin={skin} color={bot.color} size={38} detail="full" label={null} />}
          />
        </div>
      )}

      {look.character === "grump" && (
        <div data-character-options="grump">
          {colors}
          <SkinPicker
            key="grump"
            skins={GRUMP_SKINS}
            tierOf={GRUMP_SKIN_TIER}
            selected={look.skins.grump}
            labelOf={(skin) => t(GRUMP_SKIN_LABEL[skin])}
            idPrefix="grump-skin"
            dataKey="data-grump-skin-option"
            disabled={disabled}
            onSelect={(skin) => setLook({ skins: { ...look.skins, grump: skin } })}
            lockOf={(skin) => skinLock(unlocks, "grump", skin)}
            preview={(skin) => <GrumpMascot skin={skin} color={bot.color} size={38} detail="full" label={null} />}
          />
        </div>
      )}

      {look.character === "ogre" && (
        <div data-character-options="ogre">
          {colors}
          <SkinPicker
            key="ogre"
            skins={OGRE_SKINS}
            tierOf={OGRE_SKIN_TIER}
            selected={look.skins.ogre}
            labelOf={(skin) => t(OGRE_SKIN_LABEL[skin])}
            idPrefix="ogre-skin"
            dataKey="data-ogre-skin-option"
            disabled={disabled}
            onSelect={(skin) => setLook({ skins: { ...look.skins, ogre: skin } })}
            lockOf={(skin) => skinLock(unlocks, "ogre", skin)}
            preview={(skin) => <OgreMascot skin={skin} color={bot.color} size={38} detail="full" label={null} />}
          />
        </div>
      )}

      {look.character === "frog" && (
        <div data-character-options="frog">
          {colors}
          <SkinPicker
            key="frog"
            skins={FROG_SKINS}
            tierOf={FROG_SKIN_TIER}
            selected={look.skins.frog}
            labelOf={(skin) => t(FROG_SKIN_LABEL[skin])}
            idPrefix="frog-skin"
            dataKey="data-frog-skin-option"
            disabled={disabled}
            onSelect={(skin) => setLook({ skins: { ...look.skins, frog: skin } })}
            lockOf={(skin) => skinLock(unlocks, "frog", skin)}
            preview={(skin) => <FrogMascot skin={skin} color={bot.color} size={38} detail="full" label={null} />}
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
