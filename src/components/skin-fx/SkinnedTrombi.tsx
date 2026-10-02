// Trombi in a bot's skin, with the skin's equip and move bursts: the one
// way a bot's Trombi is drawn (the avatars, the popover, the desktop
// mascot), so a skin looks the same everywhere. Small or still drawings get
// the skin's still look.
import "./skin-fx.css";
import { useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { Trombi, type TrombiPose } from "../retro-assistant/Trombi";
import { TROMBI_SKIN_TIER, TROMBI_SKINS, type TrombiSkin } from "../../../shared/mascot-look";
import { EquipFx, MoveFx } from "./SkinFx";
import { trombiPaint } from "./trombi-skins";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, type FxDetail, type FxMoveRequest } from "./skin-fx";

export interface SkinnedTrombiProps {
  skin: TrombiSkin | string;
  pose: TrombiPose;
  /** The square box, px. */
  size: number;
  /** Trombi's own width, px (he is thin: a share of the box). */
  width: number;
  animated?: boolean;
  detail?: FxDetail;
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  label?: string | null;
  className?: string;
}

export function SkinnedTrombi({ skin, pose, size, width, animated = true, detail, move, moveBody = false, label = null, className }: SkinnedTrombiProps) {
  const known: TrombiSkin = (TROMBI_SKINS as readonly string[]).includes(skin) ? (skin as TrombiSkin) : "classic";
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const burst = useMoveBurst(move, live);
  const uid = `trombi-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const palette = fxPalette(trombiPaint(known, uid).fx, "#5fd4ff");
  return (
    <span
      ref={root}
      className={cn("trombi-avatar relative inline-flex shrink-0 items-end justify-center", `trombi-skin-${known}`, live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-trombi-skin={known}
      data-skin-tier={TROMBI_SKIN_TIER[known]}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <span key={burst && moveBody ? burst.key : undefined} className={cn("inline-flex", burst && moveBody && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop")}>
        <Trombi pose={pose} size={width} still={!animated} label={null} skin={known} fxFull={full} />
      </span>
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} />}
    </span>
  );
}
