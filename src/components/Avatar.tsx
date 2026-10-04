// Bot avatar: the Sagax owl (OwlAvatar.tsx), wrapped in the app's
// historical MausAvatar API so no call site changes. The bot's color is the
// owl's plumage; the app's MausState vocabulary and one-shot MausMotion beats
// are translated to the owl's six states by src/lib/owl/owl-state.ts. A bot
// may wear another character instead (bot.mascotLook: one of the shapes, or
// Trombi), drawn by BotAvatar for every bot avatar in the app.
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { OWL_BEAT_MS, owlBeatForMotion, owlStateForMaus } from "@/lib/owl/owl-state";
import { OwlAvatar, type OwlAvatarHandle } from "./OwlAvatar";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, type BotAvatarCrop } from "../../shared/bot-avatar";
import type { MascotBodyId } from "../../shared/mascot-bodies";
import type { MascotSkinId } from "../../shared/mascot-skins";
import { botMascotLook, completeMascotLook, type MascotLook } from "../../shared/mascot-look";
import { ShapeMascot, type ShapeMood } from "./ShapeMascot";
import type { TrombiPose } from "./retro-assistant/Trombi";
import { SkinnedTrombi } from "./skin-fx/SkinnedTrombi";
import { BunbuMascot, type BunbuMood } from "./BunbuMascot";
import type { FxMoveRequest } from "./skin-fx/skin-fx";

/** Kept for API compatibility (the preview page reads them); the owl ignores both. */
export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

/** A head turn of this many degrees looks all the way to one side. */
const TURN_FULL_DEG = 90;

export interface MausAvatarHandle {
  blink: () => void;
  /** The old engine spun the body; the owl hops. */
  spin: (durationMs?: number) => void;
  /** The owl has no expression sheet; kept so old callers still compile. */
  setExpression: (index: number) => void;
}

export type MausAvatarProps = {
  color: MausColor;
  /** Named behaviour, mapped to one of the owl's six states. */
  state?: MausState;
  /** Ignored by the owl (it has no expression sheet). */
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
  motionKey?: number;
  /** Head turn in degrees: moves the owl's gaze sideways. */
  turn?: number;
  /** Pins the gaze (-1..1 per axis). */
  gaze?: { x?: number; y?: number };
  /** Ignored by the owl. */
  spring?: number;
  /** Ignored by the owl. */
  eyeScale?: number;
  /** Ignored by the owl (it has no mouth). */
  showMouth?: boolean;
  /** Ignored by the owl. */
  mouthStroke?: number;
  /** Ignored by the owl. */
  forward?: boolean;
  /** Ignored by the owl. */
  lookAround?: number;
  /** Let the eye follow the pointer across this avatar. */
  trackPointer?: boolean;
  /** Run the animation. Off draws the resting pose once. */
  animated?: boolean;
  /** Ignored: every bot is the owl now. The field stays on the wire. */
  bodyId?: MascotBodyId;
  /** Special-edition skin. Missing or unknown values wear none. */
  skin?: MascotSkinId | null;
  /** Play the skin's effects even while `animated` is off (skin pickers). */
  skinAnimated?: boolean;
  /** A one-shot move's skin effect (the avatar popover's Moves). */
  move?: FxMoveRequest | null;
};

function MausAvatarComponent(
  {
    color,
    state = "idle",
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    turn,
    gaze,
    trackPointer = true,
    animated = true,
    skin,
    skinAnimated,
    move,
  }: MausAvatarProps,
  ref: React.Ref<MausAvatarHandle>,
) {
  const owl = useRef<OwlAvatarHandle>(null);
  useImperativeHandle(ref, () => ({
    blink: () => owl.current?.blink(),
    spin: () => owl.current?.play("success"),
    setExpression: () => {},
  }));

  // success/alert are one-shots: the owl rests as idle and plays the beat
  // when the bot enters the state (not on first mount, so a list of happy
  // bots does not all jump at once).
  const mapped = owlStateForMaus(state);
  const restState = mapped.oneShot ? "idle" : mapped.state;
  const entered = useRef(mapped.state);
  useEffect(() => {
    if (mapped.state === entered.current) return;
    entered.current = mapped.state;
    if (animated && mapped.oneShot) owl.current?.play(mapped.state);
  }, [mapped.state, mapped.oneShot, animated]);

  // A one-shot motion borrows a state (or a blink) for a moment.
  useEffect(() => {
    if (!animated) return;
    const beat = owlBeatForMotion(motion);
    if (!beat) return;
    if (beat.blink) owl.current?.blink();
    if (beat.play) owl.current?.play(beat.play, OWL_BEAT_MS);
    if (beat.wings) owl.current?.flourish(beat.wings);
  }, [motion, motionKey, animated]);

  const pinned =
    gaze || turn
      ? {
          x: Math.max(-1, Math.min(1, (gaze?.x ?? 0) + (turn ?? 0) / TURN_FULL_DEG)),
          y: Math.max(-1, Math.min(1, gaze?.y ?? 0)),
        }
      : undefined;

  return (
    <OwlAvatar
      ref={owl}
      color={color}
      state={animated ? restState : mapped.state === "alert" ? "alert" : restState}
      size={size}
      label={label ?? null}
      animated={animated}
      trackPointer={trackPointer}
      gaze={pinned}
      skin={skin}
      skinAnimated={skinAnimated}
      move={move}
    />
  );
}

export const MausAvatar = memo(forwardRef(MausAvatarComponent));

export type BotAvatarProps = Omit<MausAvatarProps, "color"> & {
  bot: {
    name?: string;
    color: MausColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: MascotBodyId | null;
    mascotSkin?: MascotSkinId | null;
    /** The bot's character (owl, shape, Trombi); absent means the owl. */
    mascotLook?: MascotLook | null;
  };
  /** A one-shot move (the avatar popover's Moves): a shape's or Trombi's body motion and skin effect, the owl's skin effect. */
  characterMove?: FxMoveRequest | null;
  /** Mark this avatar as its person's Primary Bot: a small orange circle with
   * a white star at the bottom-right corner. Lists pass it (sidebar,
   * pickers, team map, chat header); a transcript does not. */
  primary?: boolean;
  /** The ring around the star, in the colour of what the avatar sits on. */
  primaryRingClassName?: string;
};

/** The Primary Bot mark: orange circle, white star, bottom-right. */
export function PrimaryBotBadge({ size, ringClassName = "ring-panel", label }: { size: number; ringClassName?: string; label?: string }) {
  const badge = Math.min(18, Math.max(10, Math.round(size * 0.28)));
  return (
    <span
      data-testid="primary-bot-badge"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={`pointer-events-none absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-orange-500 text-white ring-2 ${ringClassName}`}
      style={{ width: badge, height: badge }}
    >
      <svg viewBox="0 0 24 24" width={Math.round(badge * 0.66)} height={Math.round(badge * 0.66)} fill="currentColor" aria-hidden="true">
        <path d="M12 2.6l2.83 5.73 6.33.92-4.58 4.46 1.08 6.3L12 17.03l-5.66 2.98 1.08-6.3-4.58-4.46 6.33-.92z" />
      </svg>
    </span>
  );
}

/** A shape's mood for the app's mascot states. */
export function shapeMoodFor(state: MausState | undefined): ShapeMood {
  if (!state) return "idle";
  if (["thinking", "searching", "loading", "curious", "confused"].includes(state)) return "thinking";
  if (["working", "progress", "orbit", "radar", "writing", "uploading", "sending", "receiving", "dictating", "humming"].includes(state)) return "working";
  if (["happy", "celebrate", "proud", "laughing", "excited", "playful"].includes(state)) return "happy";
  if (["sleeping", "drowsy", "powering-down"].includes(state)) return "sleeping";
  return "idle";
}

/** Trombi's pose for the app's mascot states. */
export function trombiPoseFor(state: MausState | undefined): TrombiPose {
  const mood = shapeMoodFor(state);
  if (mood === "thinking" || mood === "working") return "think";
  if (mood === "happy") return "celebrate";
  if (mood === "sleeping") return "sleep";
  if (state === "listening" || state === "notifying") return "speak";
  return "idle";
}

/** Bunbu's face for the app's mascot states (listening perks its ears, speaking moves its grin). */
export function bunbuMoodFor(state: MausState | undefined): BunbuMood {
  if (state === "listening" || state === "dictating") return "listening";
  if (state === "notifying") return "speaking";
  return shapeMoodFor(state);
}

/**
 * The bot's character, when it is not the owl: one of the shapes, Trombi or Bunbu, in the bot's look. Every bot avatar in the app comes through
 * BotAvatar, so this is where a character change shows everywhere.
 */
function CharacterAvatar({ look, color, size, state, animated = true, label, move }: { look: MascotLook; color: MausColor; size: number; state?: MausState; animated?: boolean; label?: string | null; move?: FxMoveRequest | null }) {
  const full = completeMascotLook(look);
  if (full.character === "shape") {
    return <ShapeMascot shape={full.shape} skin={full.skins.shape} color={color} size={size} mood={shapeMoodFor(state)} animated={animated} move={move} moveBody label={label ?? null} />;
  }
  if (full.character === "bunbu") {
    return <BunbuMascot skin={full.skins.bunbu} color={color} size={size} mood={bunbuMoodFor(state)} animated={animated} move={move} moveBody label={label ?? null} />;
  }
  return <SkinnedTrombi skin={full.skins.trombi} pose={trombiPoseFor(state)} size={size} width={Math.round(size * 0.78)} animated={animated} move={move} moveBody label={label ?? null} />;
}

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/**
 * Pick which of the two ways to render a bot's avatar, given the parsed
 * profile plus whether the image has already failed to load. Kept as a pure
 * function — independent of React state and effects — so both arms can be
 * unit-tested directly: `imageFailed` is set by the `<img>`'s own `onError`,
 * which `renderToStaticMarkup` never fires, so the failure fallback is
 * unreachable from a synchronous render test.
 *
 * The iOS half of this decision is `resolveBotAvatarOutcome` in
 * `ios/Sources/CompanionCore/BotAvatarRendering.swift`, which mirrors this
 * union name for name so the two renderers can be read side by side.
 */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

/**
 * The one renderer for a bot's chosen profile image. Malformed persisted
 * values and images that fail to load both fall back to the animated mascot,
 * so an old/corrupt profile can never leave a broken-image icon in the app.
 */
export function BotAvatar({ primary, primaryRingClassName, ...props }: BotAvatarProps) {
  if (!primary) return <BotAvatarImage {...props} />;
  const size = props.size ?? 44;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} data-primary-bot="">
      <BotAvatarImage {...props} />
      <PrimaryBotBadge size={size} ringClassName={primaryRingClassName} label={t("primaryBot.badge")} />
    </span>
  );
}

function BotAvatarImage({ bot, size = 44, label, characterMove, ...mascotProps }: Omit<BotAvatarProps, "primary" | "primaryRingClassName">) {
  const profile = botAvatarProfile(bot);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  const look = botMascotLook(bot.mascotLook);
  if (outcome !== "flatImage" && look.character !== "owl") {
    return <CharacterAvatar look={look} color={bot.color} size={size} state={mascotProps.state} animated={mascotProps.animated} label={label ?? bot.name} move={characterMove} />;
  }
  if (outcome !== "flatImage") {
    return (
      <MausAvatar
        skin={bot.mascotSkin}
        move={characterMove}
        {...mascotProps}
        showMouth={false}
        color={bot.color}
        size={size}
        label={label ?? bot.name}
      />
    );
  }

  const radius = avatarCropRadius(profile.avatarCrop);
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
        width={size}
        height={size}
        draggable={false}
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  size = 32,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
