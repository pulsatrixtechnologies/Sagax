// Category, unlocked or locked, reward and search narrow the achievements
// list together (AND). A locked secret matches only the words already on
// its card, never its real name, description or reward.
import { MASCOT_CHARACTERS } from "../../../shared/mascot-look";
import type { AchievementCategory, AchievementDefinition } from "../../../shared/achievements";
import { characterName, localized, rewardLabel } from "@/lib/achievements";
import { t } from "@/lib/i18n";

export type AchievementStatusFilter = "all" | "unlocked" | "locked";

export const ACHIEVEMENT_REWARD_FILTERS = ["all", "title", ...MASCOT_CHARACTERS] as const;
export type AchievementRewardFilter = (typeof ACHIEVEMENT_REWARD_FILTERS)[number];

export interface AchievementListQuery {
  category: AchievementCategory | "all";
  status: AchievementStatusFilter;
  reward: AchievementRewardFilter;
  search: string;
}

export function achievementRewardFilterLabel(filter: AchievementRewardFilter): string {
  if (filter === "all") return t("achievements.rewardFilter.all");
  if (filter === "title") return t("achievements.rewardFilter.title");
  return characterName(filter);
}

/** True when the achievement should stay in the list for this query. */
export function achievementMatches(item: AchievementDefinition, unlockedAt: number | undefined, query: AchievementListQuery): boolean {
  if (query.category !== "all" && item.category !== query.category) return false;
  const unlocked = Boolean(unlockedAt);
  if (query.status === "unlocked" && !unlocked) return false;
  if (query.status === "locked" && unlocked) return false;
  if (!matchesReward(item, query.reward)) return false;
  return matchesSearch(item, unlocked, query.search);
}

function matchesReward(item: AchievementDefinition, reward: AchievementRewardFilter): boolean {
  if (reward === "all") return true;
  if (reward === "title") return item.rewards.some((entry) => entry.kind === "title");
  return item.rewards.some((entry) => (entry.kind === "character" || entry.kind === "skin") && entry.character === reward);
}

function matchesSearch(item: AchievementDefinition, unlocked: boolean, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") return true;
  return searchText(item, unlocked).some((part) => part.toLowerCase().includes(query));
}

function searchText(item: AchievementDefinition, unlocked: boolean): readonly string[] {
  const secret = Boolean(item.hidden) && !unlocked;
  if (secret) {
    return [t("achievements.secretName"), item.hint ? localized(item.hint) : t("achievements.secretDescription")];
  }
  return [localized(item.name), localized(item.description), ...item.rewards.map((reward) => rewardLabel(reward))];
}
