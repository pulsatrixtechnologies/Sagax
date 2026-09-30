// One place that draws whichever assistant the person picked, in a pose:
// Trombi (inline SVG), the app's owl (OwlAvatar), or the person's own
// pictures from this browser's storage. Used on the desk, in the detached
// window and in the "Choose an assistant" gallery.
import { forwardRef, useEffect, useState } from "react";
import { OwlAvatar, type OwlAvatarHandle } from "@/components/OwlAvatar";
import type { OwlGaze, OwlState } from "@/lib/owl/owl-art";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import { Trombi } from "./Trombi";
import { characterBox, type AssistantPose, type RetroCharacter } from "./logic";
import { customArtFor, loadCustomArt, type CustomState } from "./custom-art";

export type CustomArtUrls = Partial<Record<CustomState, string>>;

/** The custom pictures cover six moments; "bored" borrows the idle one. */
export function customStateFor(pose: AssistantPose): CustomState {
  return pose === "bored" ? "idle" : pose;
}

export function owlStateFor(pose: AssistantPose): OwlState {
  if (pose === "think") return "working";
  if (pose === "sleep") return "sleepy";
  if (pose === "celebrate") return "success";
  return "idle";
}

/**
 * Object URLs for the saved custom pictures, loaded when `enabled` and
 * reloaded when `version` changes; revoked when replaced or unmounted.
 */
export function useCustomArtUrls(enabled: boolean, version = 0): CustomArtUrls {
  const [urls, setUrls] = useState<CustomArtUrls>({});
  useEffect(() => {
    if (!enabled || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      setUrls({});
      return;
    }
    let live = true;
    const made: string[] = [];
    void loadCustomArt().then((art) => {
      if (!live) return;
      const next: CustomArtUrls = {};
      for (const state of Object.keys(art) as CustomState[]) {
        const blob = customArtFor(art, state);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        made.push(url);
        next[state] = url;
      }
      setUrls(next);
    });
    return () => {
      live = false;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [enabled, version]);
  return urls;
}

export interface AssistantArtProps {
  character: RetroCharacter;
  pose: AssistantPose;
  reduced?: boolean;
  look?: { color: string; skin: MascotSkinId };
  gaze?: OwlGaze;
  custom?: CustomArtUrls;
  /** Overrides the character's usual width (the gallery draws smaller). */
  width?: number;
}

export const AssistantArt = forwardRef<OwlAvatarHandle, AssistantArtProps>(function AssistantArt(
  { character, pose, reduced, look, gaze, custom, width },
  owlRef,
) {
  const box = characterBox(character);
  const scale = width ? width / box.width : 1;
  if (character === "owl") {
    return (
      <OwlAvatar
        ref={owlRef}
        color={look?.color ?? "blue"}
        skin={look?.skin ?? "none"}
        size={Math.round(box.width * scale)}
        state={owlStateFor(pose)}
        gaze={gaze}
        reducedMotion={reduced}
        label={null}
      />
    );
  }
  if (character === "custom") {
    const src = custom?.[customStateFor(pose)] ?? custom?.idle;
    if (src) {
      return (
        <img
          className="r98-custom-art"
          src={src}
          alt=""
          draggable={false}
          width={Math.round(box.width * scale)}
          height={Math.round(box.height * scale)}
          data-pose={pose}
        />
      );
    }
  }
  // Trombi, and the fallback while custom pictures are missing
  return <Trombi pose={pose} size={Math.round(characterBox("trombi").width * scale)} still={reduced} label={null} />;
});
