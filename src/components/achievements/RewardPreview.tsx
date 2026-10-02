// A reward drawn small: the skin on its character, the character itself, or
// a trophy for a title and an app icon. Loaded lazily with the first toast or
// the achievements page, so the mascots' code stays out of the main bundle.
import { Award, Trophy } from "lucide-react";
import type { AchievementReward } from "../../../shared/achievements";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import type { BunbuSkin, ShapeSkin } from "../../../shared/mascot-look";
import { MausAvatar } from "@/components/Avatar";
import { ShapeMascot } from "@/components/ShapeMascot";
import { BunbuMascot } from "@/components/BunbuMascot";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import "@/components/skin-fx/skin-fx.css";

export default function RewardPreview({ reward, size = 34, animated = true }: { reward: AchievementReward; size?: number; animated?: boolean }) {
  if (reward.kind === "title") return <Award size={size * 0.7} aria-hidden="true" />;
  if (reward.kind === "appIcon") return <Trophy size={size * 0.7} aria-hidden="true" />;
  const character = reward.character;
  const skin = reward.kind === "skin" ? reward.skin : undefined;
  if (character === "owl") return <MausAvatar color="blue" skin={(skin ?? "none") as MascotSkinId} state="idle" size={size} animated={false} skinAnimated={animated} trackPointer={false} />;
  if (character === "shape") return <ShapeMascot shape="circle" skin={(skin ?? "plain") as ShapeSkin} color="blue" size={size} animated={animated} detail="full" label={null} />;
  if (character === "bunbu") return <BunbuMascot skin={(skin ?? "plain") as BunbuSkin} color="mint" size={size} animated={animated} detail="full" label={null} />;
  return <SkinnedTrombi skin={skin ?? "classic"} pose="idle" size={size} width={size * 0.75} animated={animated} detail="full" label={null} />;
}
