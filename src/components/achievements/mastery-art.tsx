// How a Mastery character (shared/mascot-unlocks.ts) draws in the
// achievements modal, the toast and the look editor's previews. Until its
// branch lands, a character is a greyed placeholder (its initial on a
// disc); a mascot branch registers its real art by adding one line to
// MASTERY_ART below (no other file needs to know).
import type { ComponentType } from "react";
import { MASTERY_UNLOCKS, type MasteryCharacter } from "../../../shared/mascot-unlocks";
import { ShibaMascot } from "@/components/ShibaMascot";

export interface MasteryArtProps {
  skin: string;
  size: number;
  animated: boolean;
}

/** Registered art per Mastery character (append only: `shiba: ShibaRewardArt,`). */
export const MASTERY_ART: Partial<Record<MasteryCharacter, ComponentType<MasteryArtProps>>> = {
  shiba: ({ skin, size, animated }) => <ShibaMascot skin={skin} color="orange" size={size} animated={animated} detail="full" label={null} />,
};

/** The stand-in: the character's initial on a disc, greyed like a locked reward. */
export function MasteryPlaceholder({ character, size }: { character: MasteryCharacter; size: number }) {
  const initial = MASTERY_UNLOCKS[character].name.en.charAt(0);
  return (
    <span
      className="mastery-placeholder grid place-items-center rounded-full font-semibold"
      data-mastery-placeholder={character}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.48) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

export function MasteryArt({ character, skin, size, animated }: { character: MasteryCharacter } & MasteryArtProps) {
  const Art = MASTERY_ART[character];
  return Art ? <Art skin={skin} size={size} animated={animated} /> : <MasteryPlaceholder character={character} size={size} />;
}
