// The Mascot view of the persona editor's Appearance category
// (appearance/AppearancePane.tsx): the bot's character and its look, stored
// with the bot (bot.mascotLook, bot.color, bot.mascotSkin), so the change
// shows everywhere the bot appears and on its desktop mascot. Kept compact so
// every option shows at a normal modal size without scrolling.
//
//   Left, the gallery: a search, the filter chips (All, Owned, Premium while
//   one is sold, then one per family) and the shelves (Yours, Premium;
//   wardrobe.ts), one tile per unlocked character of the registry
//   (mascots.tsx) in the bot's color, plus the character the bot already
//   wears. A locked character sits greyed on the To unlock shelf with its
//   padlock and achievement (Trombi excepted: an easter egg, out until
//   found). The arrow keys move across the tiles.
//   Right, the detail: a preview stage of the character picked in the
//   gallery (the real avatar, which plays the moves and the equip
//   animation), its name and family, then that character's own options:
//     Owl: color, skin
//     Shapes: shape (8), color (with the Clay palette), shape skin (Clay first)
//     Trombi: Trombi skin
//     Bunbu: color, Bunbu skin
//     Shiba: color, Shiba skin (the breed's coats, then premium editions)
//     Grump: color (the markings), Grump skin (the cat coats, then premium editions)
//     Ogre: color, Ogre skin (the ogre's hides, Lava and Armor, then premium editions)
//     Frog: color (a tint of the skin), Frog skin (real frogs, then premium editions)
//   then its moves (chips that play on the stage, with the skin's effect) and
//   the action button (In use, Use <name>, or the unlock hint).
//   Colors show one palette at a time (Vivid, Pastel, Deep, Neon, Neutral),
//   skins one rarity at a time (Common, Rare, Epic, Legendary), each tab
//   opening on the current choice (editor-tabs.ts).
//
// An unlocked character saves at once when picked (as the avatar popover
// did). A locked character previews only. Every skin of a character shows
// (JC, 2026-10-14): a locked one greyed with its padlock, not selectable,
// its tooltip naming the achievement that unlocks it. Each character keeps
// its own skin, so switching and back finds it again. Loaded lazily with
// the pane.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, Lock, Search } from "lucide-react";
import { characterLock, lockHint, reportAchievement, skinLock, useUnlocks, type LockInfo } from "@/lib/achievements";
import "@/components/achievements/achievements.css";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MAUS_COLORS, swatchStyle, type MausColor, type MausMotion } from "@/lib/mascot";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { MASCOT_SKIN_IDS, OWL_SKIN_TIER, botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import type { MascotColorGroup } from "../../../shared/mascot-colors";
import { BUNBU_SKIN_TIER, BUNBU_SKINS, completeMascotLook, CRAB_SKIN_TIER, CRAB_SKINS, FROG_SKIN_TIER, FROG_SKINS, GRUMP_SKIN_TIER, GRUMP_SKINS, OGRE_SKIN_TIER, OGRE_SKINS, SHIBA_SKIN_TIER, SHIBA_SKINS, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS, type MascotCharacter, type MascotLook, type MascotShape, type ShapeSkin, type SkinTier } from "../../../shared/mascot-look";
import { ShapeMascot } from "@/components/ShapeMascot";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import { BunbuMascot } from "@/components/BunbuMascot";
import { ShibaMascot } from "@/components/ShibaMascot";
import { GrumpMascot } from "@/components/GrumpMascot";
import { OgreMascot } from "@/components/OgreMascot";
import { FrogMascot } from "@/components/FrogMascot";
import { CrabMascot } from "@/components/CrabMascot";
import type { FxMoveRequest } from "@/components/skin-fx/skin-fx";
import "@/components/skin-fx/skin-fx.css";
import { colorGroupsFor, colorTabFor, colorTabs, nextTab, skinTabFor, skinTierTabs } from "./editor-tabs";
import { MASCOTS, SHAPE_CHOICES, type CompleteLook, type MascotDefinition } from "./mascots";
import { characterMoves, type OwlMove } from "./moves";
import { filterWardrobe, MASCOT_FAMILY_LABEL, wardrobeFilters, wardrobeShelves, wardrobeStep, type WardrobeFilter, type WardrobeShelf } from "./wardrobe";

export interface MascotLookPatch {
  color?: MausColor;
  mascotSkin?: MascotSkinId;
  mascotLook?: MascotLook;
}

export interface MascotLookEditorProps {
  bot: { name?: string; color: MausColor; mascotSkin?: MascotSkinId | null; mascotLook?: MascotLook | null };
  disabled?: boolean;
  onPatch: (patch: MascotLookPatch) => void;
  /** The owl's wing moves also play on the bot's avatars across the app. */
  onOwlMove?: (move: Exclude<MausMotion, "none">) => void;
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
  crab: "floatingBots.mascot.crab",
} satisfies Record<MascotCharacter, LocaleKey>;

export const SHAPE_LABEL = {
  circle: "mascot.shape.circle",
  bean: "mascot.shape.bean",
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

export const CRAB_SKIN_LABEL = {
  plain: "mascot.crabSkin.plain",
  coral: "mascot.crabSkin.coral",
  sand: "mascot.crabSkin.sand",
  ink: "mascot.crabSkin.ink",
  mint: "mascot.crabSkin.mint",
  gold: "mascot.crabSkin.gold",
  pearl: "mascot.crabSkin.pearl",
  neon: "mascot.crabSkin.neon",
  chrome: "mascot.crabSkin.chrome",
  crystal: "mascot.crabSkin.crystal",
  circuit: "mascot.crabSkin.circuit",
  holo: "mascot.crabSkin.holo",
  molten: "mascot.crabSkin.molten",
  galaxy: "mascot.crabSkin.galaxy",
} satisfies Record<(typeof CRAB_SKINS)[number], LocaleKey>;

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


const heading = "text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-secondary";
const card = "flex flex-col items-center justify-center gap-0.5 rounded-lg bg-inset p-1 transition-colors hover:bg-control disabled:opacity-50";
const on = "ring-2 ring-accent-border";
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A title row: its title, and the tabs that go with it (wrapping under it when the column is narrow). */
function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-1 flex min-h-[22px] flex-wrap items-center justify-between gap-x-1.5 gap-y-1" data-section-head="">
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
              "segment-tab inline-flex items-center gap-1 rounded-md px-[5px] py-0.5 text-[10.5px] leading-4 transition-colors",
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

/** A locked look's lock on its card or tile: the padlock, and how far its achievement went. */
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
 * A skin's card: its animated preview and its name, on its rarity's ground,
 * shimmering above Common. A locked skin shows greyed with its padlock and
 * the achievement that unlocks it (tooltip and label); it stays focusable so
 * the tooltip reads, but a click does nothing.
 */
function SkinCard({ tier, label, checked, disabled, onSelect, data, lock, children }: { tier: SkinTier; label: string; checked: boolean; disabled?: boolean; onSelect: () => void; data: Record<string, string>; lock?: LockInfo; children: ReactNode }) {
  const tierLabel = t(SKIN_TIER_LABEL[tier]);
  const locked = Boolean(lock?.locked);
  const hint = locked && lock ? lockHint(lock) : "";
  return (
    <button
      type="button"
      role="radio"
      disabled={disabled}
      aria-disabled={locked || undefined}
      aria-checked={checked}
      aria-label={locked ? t("mascot.skinCard.locked", { name: label, tier: tierLabel, hint }) : `${label}, ${tierLabel}`}
      title={locked ? `${label} (${tierLabel}). ${hint}` : `${label} (${tierLabel})`}
      data-tier={tier}
      data-locked={locked ? "" : undefined}
      data-unlock-achievement={locked ? lock?.achievement?.id : undefined}
      {...data}
      onClick={() => {
        if (!locked) onSelect();
      }}
      className={cn(card, "skin-card relative h-[56px] gap-0 pt-0.5", focusRing, checked && on, locked && "cursor-not-allowed hover:bg-inset")}
    >
      <span className="grid size-[36px] place-items-center" aria-hidden="true">
        {children}
      </span>
      <span className="w-full truncate text-center text-[10px] leading-[12px] text-ink">{label}</span>
      {locked && lock && <LockBadge lock={lock} />}
    </button>
  );
}

/**
 * The skins of one character, one rarity at a time. Opens on the current
 * skin's rarity and follows it when it changes elsewhere (Reset); only the
 * open tab's cards are drawn, so the pane animates a handful at most.
 */
function SkinPicker<S extends string>({ skins, tierOf, selected, labelOf, idPrefix, dataKey, disabled, onSelect, preview, lockOf }: { skins: readonly S[]; tierOf: Readonly<Record<S, SkinTier>>; selected: S; labelOf: (skin: S) => string; idPrefix: string; dataKey: string; disabled?: boolean; onSelect: (skin: S) => void; preview: (skin: S) => ReactNode; lockOf?: (skin: S) => LockInfo }) {
  // Every skin shows, a locked one greyed with its padlock (the goal is to want it).
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
    <div>
      <Head title={t("mascot.skin.title")}>
        <SegmentedTabs
          label={t("mascot.tier.tabs")}
          idPrefix={idPrefix}
          data="data-skin-tabs"
          value={open.tier}
          onChange={setTab}
          items={tabs.map((item) => ({ id: item.tier, label: t(SKIN_TIER_LABEL[item.tier]), count: item.count, tier: item.tier }))}
        />
      </Head>
      <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${open.tier}`} data-skin-panel={open.tier}>
        <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={t("mascot.skin.title")}>
          {open.skins.map((skin) => (
            <SkinCard key={skin} tier={tierOf[skin]} label={labelOf(skin)} checked={selected === skin} disabled={disabled} data={{ [dataKey]: skin }} lock={skin === selected ? undefined : lockOf?.(skin)} onSelect={() => onSelect(skin)}>
              {preview(skin)}
            </SkinCard>
          ))}
        </div>
      </div>
    </div>
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
    <div>
      <Head title={t("mascot.color.title")}>
        <SegmentedTabs
          label={t("mascot.color.groups")}
          idPrefix="mascot-color"
          data="data-color-tabs"
          value={open.group}
          onChange={setTab}
          items={tabs.map((item) => ({ id: item.group, label: t(COLOR_GROUP_LABEL[item.group]), dot: item.group === current ? MAUS_COLORS[color] : undefined }))}
        />
      </Head>
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
              className={cn("size-5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50", color === name && "ring-2 ring-ink/80 ring-offset-2 ring-offset-panel")}
              style={swatchStyle(name)}
              title={name}
              aria-label={t("mascot.color.use", { color: name })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const SHELF_LABEL = {
  yours: "appearance.shelf.yours",
  locked: "appearance.filter.locked",
  premium: "appearance.filter.premium",
} satisfies Record<WardrobeShelf, LocaleKey>;

function filterLabel(filter: WardrobeFilter): string {
  if (filter === "all") return t("appearance.filter.all");
  if (filter === "owned") return t("appearance.filter.owned");
  if (filter === "locked") return t("appearance.filter.locked");
  if (filter === "premium") return t("appearance.filter.premium");
  return t(MASCOT_FAMILY_LABEL[filter.slice("family:".length) as keyof typeof MASCOT_FAMILY_LABEL]);
}

/**
 * A character's tile in the gallery: a still preview in the bot's color and
 * the character's own skin, its name and family. The tile shown in the
 * detail is outlined with the accent; the one the bot wears carries a
 * check. A locked tile is greyed with its padlock and achievement progress;
 * a paid edition shows its price, a new one a NEW badge.
 */
function MascotTile({ option, look, color, owlSkin, selected, inUse, lock, disabled, onSelect, onKeyDown }: {
  option: MascotDefinition;
  look: CompleteLook;
  color: MausColor;
  owlSkin: MascotSkinId;
  selected: boolean;
  inUse: boolean;
  lock: LockInfo;
  disabled?: boolean;
  onSelect: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const name = t(CHARACTER_LABEL[option.id]);
  const family = t(MASCOT_FAMILY_LABEL[option.family]);
  const locked = lock.locked;
  const hint = locked ? lockHint(lock) : "";
  const label = locked
    ? t("appearance.tile.locked", { name, hint })
    : option.premium ? `${name}, ${option.premium.price}`
      : inUse ? t("appearance.tile.inUse", { name }) : name;
  return (
    <button
      type="button"
      data-character-option={option.id}
      data-locked={locked ? "" : undefined}
      data-unlock-achievement={locked ? lock.achievement?.id : undefined}
      data-in-use={inUse ? "" : undefined}
      aria-pressed={selected}
      aria-label={label}
      title={locked ? hint : undefined}
      disabled={disabled}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex h-[88px] min-w-0 flex-col items-center justify-start gap-0.5 rounded-lg bg-inset px-1 pb-2 pt-2 transition-colors hover:bg-control disabled:opacity-50",
        focusRing,
        selected && on,
      )}
    >
      <span className={cn("grid size-10 shrink-0 place-items-center overflow-hidden", locked && "opacity-60 grayscale")} aria-hidden="true">
        <option.Thumb color={color} skin={owlSkin} look={{ ...look, character: option.id }} size={36} />
      </span>
      <span className="w-full truncate text-center text-[11.5px] leading-4 text-ink">{name}</span>
      <span className={cn("h-3 w-full truncate text-center text-[10px] leading-3 text-ink-tertiary", locked && "invisible")}>{option.premium && option.isNew ? option.premium.price : family}</span>
      {inUse && (
        <span className="absolute left-1 top-1 grid size-4 place-items-center rounded-full bg-accent text-accent-ink" aria-hidden="true">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
      {locked ? (
        <LockBadge lock={lock} />
      ) : option.isNew ? (
        <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 text-[9px] font-semibold uppercase leading-[14px] text-accent-ink" aria-hidden="true">{t("appearance.badge.new")}</span>
      ) : option.premium ? (
        <span className="absolute right-1 top-1 rounded-full bg-control px-1.5 text-[9px] font-semibold leading-[14px] text-ink" aria-hidden="true">{option.premium.price}</span>
      ) : null}
    </button>
  );
}

export default function MascotLookEditor({ bot, disabled, onPatch: savePatch, onOwlMove }: MascotLookEditorProps) {
  const look = completeMascotLook(bot.mascotLook);
  const owlSkin = botMascotSkin(bot.mascotSkin);
  // what this person unlocked (src/lib/achievements.ts); what the bot wears now always stays.
  const unlocks = useUnlocks();
  const lockOf = (id: MascotCharacter): LockInfo => (id === look.character ? { locked: false } : characterLock(unlocks, id));
  // Every character shows, a locked one on the To unlock shelf; Trombi only once found (an easter egg).
  const listed = MASCOTS.filter((option) => option.id !== "trombi" || option.id === look.character || !characterLock(unlocks, option.id).locked);
  const onPatch = (patch: MascotLookPatch) => {
    savePatch(patch);
    reportAchievement("bot.customized", { key: patch.mascotLook?.character ?? look.character });
  };
  const setLook = (next: Partial<MascotLook>) => onPatch({ mascotLook: { ...look, ...next, skins: { ...look.skins, ...next.skins } } });

  // The character in the detail: the one the bot wears, or one picked to look at. It follows the bot's (Reset, another window).
  const [shown, setShown] = useState<MascotCharacter>(look.character);
  const followed = useRef(look.character);
  useEffect(() => {
    if (followed.current === look.character) return;
    followed.current = look.character;
    setShown(look.character);
  }, [look.character]);
  const shownOption = MASCOTS.find((option) => option.id === shown) ?? MASCOTS[0];
  const shownLock = lockOf(shown);
  const shownLook: MascotLook = { ...look, character: shown };
  const shownName = t(CHARACTER_LABEL[shown]);
  const inUse = shown === look.character;
  // A locked character previews only: its options show, disabled.
  const optionsOff = disabled || shownLock.locked;

  const pick = (id: MascotCharacter) => {
    setShown(id);
    if (disabled || id === look.character || lockOf(id).locked) return;
    setLook({ character: id });
  };

  // the gallery: a search and a chip narrow it, the shelves split what is left
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WardrobeFilter>("all");
  const filters = wardrobeFilters(listed, (entry) => characterLock(unlocks, entry.id as MascotCharacter).locked && entry.id !== look.character);
  const kept = filterWardrobe(listed, {
    filter,
    query,
    nameOf: (option) => t(CHARACTER_LABEL[option.id]),
    familyNameOf: (family) => t(MASCOT_FAMILY_LABEL[family]),
    lockedOf: (option) => lockOf(option.id).locked,
  });
  const shelves = wardrobeShelves(kept, (option) => lockOf(option.id).locked);
  const owned = listed.filter((option) => !lockOf(option.id).locked).length;
  const browser = useRef<HTMLDivElement>(null);
  const onTileKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const tiles = Array.from(browser.current?.querySelectorAll<HTMLButtonElement>("[data-character-option]") ?? []);
    const index = tiles.indexOf(event.currentTarget);
    const grid = event.currentTarget.parentElement;
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 1;
    const next = wardrobeStep(index, tiles.length, columns, event.key);
    if (next === null || index < 0) return;
    event.preventDefault();
    tiles[next]?.focus();
  };

  // the stage plays a move: the owl's wing motion, and every character's clip with its skin's effect
  const [owlMotion, setOwlMotion] = useState<{ kind: Exclude<MausMotion, "none">; nonce: number } | null>(null);
  const [fxMove, setFxMove] = useState<FxMoveRequest | null>(null);
  const moves: { id: string; label: string; clip: string; owl?: OwlMove }[] = characterMoves(shownLook).map((move) => ({ ...move, label: t(move.label) }));
  const stagePick = useRef(0);
  const play = (move: { clip: string; owl?: OwlMove }) => {
    if (move.owl) {
      const kind = move.owl;
      setOwlMotion((last) => ({ kind, nonce: (last?.nonce ?? 0) + 1 }));
      onOwlMove?.(kind);
    }
    setFxMove((last) => ({ clip: move.clip, key: (last?.key ?? 0) + 1 }));
  };

  const colors = shownOption.paint.colors && <ColorPicker color={bot.color} groups={colorGroupsFor(shown, bot.color)} disabled={optionsOff} onSelect={(color) => onPatch({ color })} />;

  return (
    <div data-mascot-look-editor="" className="grid gap-4 @[34rem]:grid-cols-[minmax(0,1fr)_20rem]">
      <div ref={browser} data-mascot-browser="" className="flex min-w-0 flex-col gap-2">
        <label className="flex h-7 items-center gap-1.5 rounded-lg border border-hairline-weak bg-elevated px-2">
          <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape clears a search first; an empty one leaves Escape to the modal
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={t("appearance.search", { count: listed.length })}
            aria-label={t("appearance.searchLabel")}
            data-mascot-search=""
            className="w-full min-w-0 bg-transparent text-[12px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </label>
        <div role="group" aria-label={t("appearance.filters")} className="flex flex-wrap gap-1" data-mascot-filters="">
          {filters.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              data-mascot-filter={id}
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-full border px-2 py-px text-[11px] leading-4 transition-colors",
                focusRing,
                filter === id ? "border-accent-border bg-selected text-ink" : "border-hairline-weak text-ink-secondary hover:text-ink",
              )}
            >
              {filterLabel(id)}
            </button>
          ))}
        </div>
        {shelves.map(({ shelf, entries }) => (
          <section key={shelf} data-mascot-shelf={shelf} aria-labelledby={`mascot-shelf-${shelf}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 id={`mascot-shelf-${shelf}`} className={heading}>{t(SHELF_LABEL[shelf])}</h3>
              <span className="text-[10.5px] tabular-nums text-ink-tertiary">
                {shelf === "yours" ? t("appearance.shelf.count", { count: owned, total: listed.length }) : entries.length}
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-1.5" data-character-row="">
              {entries.map((option) => (
                <MascotTile
                  key={option.id}
                  option={option}
                  look={look}
                  color={bot.color}
                  owlSkin={owlSkin}
                  selected={shown === option.id}
                  inUse={look.character === option.id}
                  lock={lockOf(option.id)}
                  disabled={disabled}
                  onSelect={() => pick(option.id)}
                  onKeyDown={onTileKey}
                />
              ))}
            </div>
          </section>
        ))}
        {shelves.length === 0 && (
          <p className="py-4 text-center text-[12px] text-ink-secondary" data-mascot-empty="">
            {query.trim() ? t("appearance.noMatch", { query: query.trim() }) : t("appearance.empty")}
          </p>
        )}
      </div>

      <div data-mascot-detail={shown} className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-hairline-weak bg-panel p-2.5">
        {/* the stage: the real avatar, large and centred on its own ground; hovering or clicking it previews a move. The name, family and action sit under it. */}
        <button
          type="button"
          data-mascot-stage=""
          aria-label={t("appearance.preview", { name: shownName })}
          onMouseEnter={() => { if (moves[0]) play(moves[0]); }}
          onClick={() => { if (moves.length) { const next = moves[(stagePick.current++) % moves.length]; play(next); } }}
          className={cn("relative grid h-[176px] w-full place-items-center overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_50%_45%,var(--color-control)_0%,var(--color-inset)_70%)]", focusRing)}
        >
          <span aria-hidden="true" className={cn("pointer-events-none", shownLock.locked && "opacity-60 grayscale")}>
            <BotAvatar
              bot={{ name: bot.name, color: bot.color, mascotSkin: owlSkin, mascotLook: shownLook, avatarCrop: "mascot" }}
              size={128}
              state="idle"
              motion={owlMotion?.kind ?? "none"}
              motionKey={owlMotion?.nonce ?? 0}
              characterMove={fxMove}
              label={t("appearance.preview", { name: shownName })}
            />
          </span>
          {shownLock.locked && (
            <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-control text-ink-secondary" aria-hidden="true"><Lock size={12} strokeWidth={2.4} /></span>
          )}
        </button>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium leading-5 text-ink">{shownName}</div>
            <div className="truncate text-[11px] leading-4 text-ink-tertiary">
              {t(MASCOT_FAMILY_LABEL[shownOption.family])} · {t("appearance.moveCount", { count: moves.length })}
            </div>
          </div>
          {/* the action: what the bot wears, the character to wear, or what unlocks it */}
          <button
            type="button"
            data-mascot-action={shownLock.locked ? "locked" : inUse ? "in-use" : "use"}
            disabled={disabled || inUse || shownLock.locked}
            onClick={() => setLook({ character: shown })}
            className={cn(
              "flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-center text-[12px] leading-4",
              focusRing,
              !inUse && !shownLock.locked ? "bg-accent font-medium text-accent-ink hover:brightness-110" : "bg-control text-ink-secondary",
            )}
          >
            {shownLock.locked ? <Lock size={12} className="shrink-0" aria-hidden="true" /> : inUse ? <Check size={13} className="shrink-0" aria-hidden="true" /> : null}
            <span>{shownLock.locked ? lockHint(shownLock) : inUse ? t("appearance.inUse") : t("appearance.use", { name: shownName })}</span>
          </button>
        </div>

        <div data-character-options={shown} className="flex flex-col gap-2.5">
          {shown === "shape" && (
            <div>
              <Head title={t("floatingBots.mascot.shape")} />
              {/* 8 shapes in one row; each previews the current color and skin, still and cheap */}
              <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label={t("floatingBots.mascot.shape")}>
                {SHAPE_CHOICES.map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    role="radio"
                    disabled={optionsOff}
                    aria-checked={look.shape === shape}
                    data-character-shape={shape}
                    aria-label={t(SHAPE_LABEL[shape])}
                    title={t(SHAPE_LABEL[shape])}
                    onClick={() => setLook({ shape })}
                    className={cn(card, "h-[30px] p-0.5", focusRing, look.shape === shape && on)}
                  >
                    <ShapeThumbnail shape={shape} skin={look.skins.shape} color={bot.color} size={22} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {colors}
          {shown === "owl" && (
            <SkinPicker
              key="owl"
              skins={MASCOT_SKIN_IDS}
              tierOf={OWL_SKIN_TIER}
              selected={owlSkin}
              labelOf={(skin) => t(OWL_SKIN_LABEL[skin])}
              idPrefix="owl-skin"
              dataKey="data-mascot-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => onPatch({ mascotSkin: skin })}
              lockOf={(skin) => (skin === owlSkin ? { locked: false } : skinLock(unlocks, "owl", skin))}
              preview={(skin) => <MausAvatar color={bot.color} skin={skin} state="idle" size={36} animated={false} skinAnimated trackPointer={false} />}
            />
          )}
          {shown === "shape" && (
            <SkinPicker
              key="shape"
              skins={SHAPE_SKINS}
              tierOf={SHAPE_SKIN_TIER}
              selected={look.skins.shape}
              labelOf={(skin) => t(SHAPE_SKIN_LABEL[skin])}
              idPrefix="shape-skin"
              dataKey="data-shape-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => setLook({ skins: { ...look.skins, shape: skin } })}
              lockOf={(skin) => skinLock(unlocks, "shape", skin)}
              preview={(skin) => <ShapeMascot shape={look.shape} skin={skin} color={bot.color} size={32} detail="full" label={null} />}
            />
          )}
          {shown === "trombi" && (
            <SkinPicker
              key="trombi"
              skins={TROMBI_SKINS}
              tierOf={TROMBI_SKIN_TIER}
              selected={look.skins.trombi}
              labelOf={(skin) => t(TROMBI_SKIN_LABEL[skin])}
              idPrefix="trombi-skin"
              dataKey="data-trombi-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => setLook({ skins: { ...look.skins, trombi: skin } })}
              lockOf={(skin) => skinLock(unlocks, "trombi", skin)}
              preview={(skin) => <SkinnedTrombi skin={skin} pose="idle" size={34} width={26} detail="full" label={null} />}
            />
          )}
          {shown === "bunbu" && (
            <SkinPicker
              key="bunbu"
              skins={BUNBU_SKINS}
              tierOf={BUNBU_SKIN_TIER}
              selected={look.skins.bunbu}
              labelOf={(skin) => t(BUNBU_SKIN_LABEL[skin])}
              idPrefix="bunbu-skin"
              dataKey="data-bunbu-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => setLook({ skins: { ...look.skins, bunbu: skin } })}
              lockOf={(skin) => skinLock(unlocks, "bunbu", skin)}
              preview={(skin) => <BunbuMascot skin={skin} color={bot.color} size={32} detail="full" label={null} />}
            />
          )}
          {shown === "shiba" && (
            <SkinPicker
              key="shiba"
              skins={SHIBA_SKINS}
              tierOf={SHIBA_SKIN_TIER}
              selected={look.skins.shiba}
              labelOf={(skin) => t(SHIBA_SKIN_LABEL[skin])}
              idPrefix="shiba-skin"
              dataKey="data-shiba-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => setLook({ skins: { ...look.skins, shiba: skin } })}
              lockOf={(skin) => skinLock(unlocks, "shiba", skin)}
              preview={(skin) => <ShibaMascot skin={skin} color={bot.color} size={32} detail="full" label={null} />}
            />
          )}
          {shown === "grump" && (
            <SkinPicker
              key="grump"
              skins={GRUMP_SKINS}
              tierOf={GRUMP_SKIN_TIER}
              selected={look.skins.grump}
              labelOf={(skin) => t(GRUMP_SKIN_LABEL[skin])}
              idPrefix="grump-skin"
              dataKey="data-grump-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => setLook({ skins: { ...look.skins, grump: skin } })}
              lockOf={(skin) => skinLock(unlocks, "grump", skin)}
              preview={(skin) => <GrumpMascot skin={skin} color={bot.color} size={32} detail="full" label={null} />}
            />
          )}
          {shown === "ogre" && (
            <SkinPicker
              key="ogre"
              skins={OGRE_SKINS}
              tierOf={OGRE_SKIN_TIER}
              selected={look.skins.ogre}
              labelOf={(skin) => t(OGRE_SKIN_LABEL[skin])}
              idPrefix="ogre-skin"
              dataKey="data-ogre-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => setLook({ skins: { ...look.skins, ogre: skin } })}
              lockOf={(skin) => skinLock(unlocks, "ogre", skin)}
              preview={(skin) => <OgreMascot skin={skin} color={bot.color} size={32} detail="full" label={null} />}
            />
          )}
          {shown === "frog" && (
            <SkinPicker
              key="frog"
              skins={FROG_SKINS}
              tierOf={FROG_SKIN_TIER}
              selected={look.skins.frog}
              labelOf={(skin) => t(FROG_SKIN_LABEL[skin])}
              idPrefix="frog-skin"
              dataKey="data-frog-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => setLook({ skins: { ...look.skins, frog: skin } })}
              lockOf={(skin) => skinLock(unlocks, "frog", skin)}
              preview={(skin) => <FrogMascot skin={skin} color={bot.color} size={32} detail="full" label={null} />}
            />
          )}
          {shown === "crab" && (
            <SkinPicker
              key="crab"
              skins={CRAB_SKINS}
              tierOf={CRAB_SKIN_TIER}
              selected={look.skins.crab}
              labelOf={(skin) => t(CRAB_SKIN_LABEL[skin])}
              idPrefix="crab-skin"
              dataKey="data-crab-skin-option"
              disabled={optionsOff}
              onSelect={(skin) => setLook({ skins: { ...look.skins, crab: skin } })}
              lockOf={(skin) => skinLock(unlocks, "crab", skin)}
              preview={(skin) => <CrabMascot skin={skin} color={bot.color} size={32} detail="full" label={null} />}
            />
          )}

          <div>
            <Head title={t("mascot.moves.title")} />
            <div className="flex flex-wrap gap-1">
              {moves.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-character-move={item.id}
                  aria-label={t("mascot.moves.play", { move: item.label })}
                  onClick={() => play(item)}
                  onMouseEnter={() => play(item)}
                  className={cn("rounded-md bg-control px-2 py-0.5 text-[11px] leading-4 text-ink hover:bg-raised-hover", focusRing)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A shape's thumbnail in the Shape row: that shape in the bot's current
 * color and skin, in the skin's still look (no filter, nothing animated), so
 * every thumbnail matches the stage and costs nothing.
 */
function ShapeThumbnail({ shape, skin, color, size }: { shape: MascotShape; skin: ShapeSkin; color: string; size: number }) {
  return <ShapeMascot shape={shape} skin={skin} color={color} size={size} animated={false} detail="static" label={null} />;
}
