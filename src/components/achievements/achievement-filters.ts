// Category, locked only and search narrow the achievements
// list together (AND). A locked secret matches only the words already on
// its card, never its real name, description or reward.
import type { AchievementCategory, AchievementDefinition } from "../../../shared/achievements";
import { localized, rewardLabel } from "@/lib/achievements";
import { t } from "@/lib/i18n";

export interface AchievementListQuery {
  category: AchievementCategory | "all";
  lockedOnly: boolean;
  search: string;
}

/** True when the achievement should stay in the list for this query. */
export function achievementMatches(item: AchievementDefinition, unlockedAt: number | undefined, query: AchievementListQuery): boolean {
  if (query.category !== "all" && item.category !== query.category) return false;
  const unlocked = Boolean(unlockedAt);
  if (query.lockedOnly && unlocked) return false;
  return matchesSearch(item, unlocked, query.search);
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
