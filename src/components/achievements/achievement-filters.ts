// Category, unlocked or locked, reward and search narrow the achievements
// list together (AND). A locked secret matches only the words already on
// its card, never its real name, description or reward.
import { MASCOT_CHARACTERS } from "../../../shared/mascot-look";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES, characterUnlocked, NOTHING_LOCKED, type AchievementCategory, type AchievementDefinition, type Unlocks } from "../../../shared/achievements";
import { characterName, displayReward, localized } from "@/lib/achievements";
import { t } from "@/lib/i18n";

/** A choice of the toolbar's category filter: All and the categories. */
export type AchievementsNavCategory = AchievementCategory | "all";

/** The category filter's choices, All first (2026-10-28: a filter of the
 * page's toolbar, not a left column). */
export const ACHIEVEMENTS_SCREEN_CATEGORIES: readonly AchievementsNavCategory[] = ["all", ...ACHIEVEMENT_CATEGORIES];

export type AchievementCategoryCounts = Record<AchievementsNavCategory, { unlocked: number; total: number }>;

/** Unlocked and total per category, All included. Secrets count like the
 * others: their cards are on the page already, masked. */
export function achievementCategoryCounts(unlocked: ReadonlySet<string>): AchievementCategoryCounts {
  const counts = Object.fromEntries(ACHIEVEMENTS_SCREEN_CATEGORIES.map((id) => [id, { unlocked: 0, total: 0 }])) as AchievementCategoryCounts;
  for (const item of ACHIEVEMENTS) {
    const got = unlocked.has(item.id) ? 1 : 0;
    counts.all.total += 1;
    counts.all.unlocked += got;
    counts[item.category].total += 1;
    counts[item.category].unlocked += got;
  }
  return counts;
}

export type AchievementStatusFilter = "all" | "unlocked" | "locked";

export const ACHIEVEMENT_REWARD_FILTERS = ["all", "title", ...MASCOT_CHARACTERS] as const;
export type AchievementRewardFilter = (typeof ACHIEVEMENT_REWARD_FILTERS)[number];

export function achievementRewardFilters(unlocks: Unlocks): AchievementRewardFilter[] {
  const characters = MASCOT_CHARACTERS.filter((id) => id === "owl" || characterUnlocked(unlocks, id));
  return ["all", "title", ...characters];
}

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
export function achievementMatches(item: AchievementDefinition, unlockedAt: number | undefined, query: AchievementListQuery, unlocks: Unlocks = NOTHING_LOCKED): boolean {
  if (query.category !== "all" && item.category !== query.category) return false;
  const unlocked = Boolean(unlockedAt);
  if (query.status === "unlocked" && !unlocked) return false;
  if (query.status === "locked" && unlocked) return false;
  if (!matchesReward(item, query.reward)) return false;
  return matchesSearch(item, unlocked, query.search, unlocks);
}

function matchesReward(item: AchievementDefinition, reward: AchievementRewardFilter): boolean {
  if (reward === "all") return true;
  if (reward === "title") return item.rewards.some((entry) => entry.kind === "title");
  return item.rewards.some((entry) => (entry.kind === "character" || entry.kind === "skin") && entry.character === reward);
}

function matchesSearch(item: AchievementDefinition, unlocked: boolean, search: string, unlocks: Unlocks): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") return true;
  return searchText(item, unlocked, unlocks).some((part) => part.toLowerCase().includes(query));
}

function searchText(item: AchievementDefinition, unlocked: boolean, unlocks: Unlocks): readonly string[] {
  const secret = Boolean(item.hidden) && !unlocked;
  if (secret) {
    return [t("achievements.secretName"), item.hint ? localized(item.hint) : t("achievements.secretDescription")];
  }
  const rewards = item.rewards.map((reward) => displayReward(reward, unlocks)).filter((line): line is string => line !== null);
  return [localized(item.name), localized(item.description), ...rewards];
}
