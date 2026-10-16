// The Achievements modal's content pane (AchievementsModal.tsx): the
// person's trophies for one category. Total points and level, the current
// streak, recent unlocks (on All only), then every achievement of the
// category (unlocked, locked with its progress, secret until found), each
// with its points, its rarity (or the share of this server's people who have
// it, when there are enough people to say so) and what it unlocks. The
// modal's left column picks the category; unlocked or locked, reward and
// search narrow the list together. The settings that hide the points or the
// toasts sit at the bottom.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Flame, Lock, Search, Trophy } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { rarityForPoints, type AchievementCategory, type AchievementDefinition, type AchievementItemState, type AchievementReward, type Unlocks } from "../../../shared/achievements";
import { characterUnlocked, displayReward, loadAchievements, localized, reportAchievement, saveAchievementSettings, unlocksFromSnapshot, useAchievements } from "@/lib/achievements";
import { forgetPublicAchievements } from "@/lib/public-achievements";
import { requestNotificationPermission } from "@/lib/notify";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { CompactRow, DescribedRow, PillSelect, SettingsGroup, Switch } from "../SettingsPrimitives";
import { achievementIcon } from "./icons";
import { achievementMatches, achievementRewardFilterLabel, achievementRewardFilters, type AchievementRewardFilter, type AchievementStatusFilter } from "./achievement-filters";
import "./achievements.css";

const RewardPreview = lazy(() => import("./RewardPreview"));

export const CATEGORY_LABEL: Record<AchievementCategory, LocaleKey> = {
  onboarding: "achievements.category.onboarding",
  productivity: "achievements.category.productivity",
  power: "achievements.category.power",
  voice: "achievements.category.voice",
  claude: "achievements.category.claude",
  collaboration: "achievements.category.collaboration",
  streaks: "achievements.category.streaks",
  mastery: "achievements.category.mastery",
  tiers: "achievements.category.tiers",
  secrets: "achievements.category.secrets",
};

const TIER_LABEL = {
  common: "mascot.tier.common",
  rare: "mascot.tier.rare",
  epic: "mascot.tier.epic",
  legendary: "mascot.tier.legendary",
} as const satisfies Record<string, LocaleKey>;

export function formatPoints(points: number, locale = activeLocale()): string {
  try {
    return new Intl.NumberFormat(locale).format(points);
  } catch {
    return String(points);
  }
}

/** How many looks a Mastery card previews before "+N". */
const MASTERY_PREVIEWS = 5;

/**
 * What a Mastery achievement unlocks, drawn: the character or its skins,
 * greyed until it unlocks (a character that has not landed yet is its
 * placeholder), then "+N" for the rest.
 */
function MasteryUnlockPreview({ item, unlocked, unlocks }: { item: AchievementDefinition; unlocked: boolean; unlocks: Unlocks }) {
  const looks = item.rewards.filter((reward): reward is Extract<AchievementReward, { kind: "character" | "skin" }> => reward.kind === "character" || reward.kind === "skin");
  if (!looks.length) return null;
  const shown = looks.slice(0, MASTERY_PREVIEWS);
  return (
    <div className="mt-1.5 flex items-center gap-1" data-mastery-preview={item.id} aria-label={t("achievements.mastery.unlocks")}>
      <span className="mr-0.5 text-[11px] text-ink-tertiary">{t("achievements.mastery.unlocks")}</span>
      {shown.map((reward) => {
        const line = displayReward(reward, unlocks);
        if (!line) return null;
        const showArt = characterUnlocked(unlocks, reward.character);
        return (
          <span
            key={`${reward.character}:${reward.kind === "skin" ? reward.skin : ""}`}
            className="mastery-look grid size-7 place-items-center"
            data-locked={unlocked ? undefined : ""}
            title={line}
          >
            {showArt ? <Suspense fallback={null}><RewardPreview reward={reward} size={24} animated={false} /></Suspense> : null}
          </span>
        );
      })}
      {looks.length > shown.length && <span className="text-[11px] tabular-nums text-ink-tertiary">{t("achievements.mastery.more", { count: looks.length - shown.length })}</span>}
    </div>
  );
}

function AchievementCard({ item, state, unlocks }: { item: AchievementDefinition; state?: AchievementItemState; unlocks: Unlocks }) {
  const unlocked = Boolean(state?.unlockedAt);
  const secret = item.hidden && !unlocked;
  const tier = rarityForPoints(item.points);
  const Icon = secret ? Lock : achievementIcon(item.icon);
  const mastery = item.category === "mastery";
  // a Mastery card always shows how far it went, 0 included: the bar is the point
  const progress = state && !unlocked && (mastery ? !secret && state.target > 0 : state.target > 1 && state.current > 0) ? state.current / state.target : null;
  const reward = item.rewards[0];
  const line = reward && !secret && !mastery ? displayReward(reward, unlocks) : null;
  // 2026-10-16 (JC): a tile, as the skin tiles of Settings > Appearance
  // (#582): the badge on a small framed ground, the name and the rest under it.
  return (
    <li
      className="achievement-card flex min-w-0 flex-col gap-1.5 rounded-[10px] p-1.5"
      data-tier={tier}
      data-unlocked={unlocked ? "" : undefined}
      data-achievement={item.id}
      data-secret={secret ? "" : undefined}
      data-mastery={mastery ? "" : undefined}
    >
      <div className={cn("achievement-tile-art relative grid h-[78px] place-items-center rounded-lg bg-elevated", !unlocked && "ring-1 ring-hairline/60")}>
        <span className="achievement-card-badge" aria-hidden="true">
          <Icon size={17} strokeWidth={2.2} />
        </span>
        <span className="absolute right-2 top-1.5 text-[11.5px] font-semibold tabular-nums text-ink-secondary">
          {item.points}
        </span>
      </div>
      <div className="min-w-0 px-0.5">
        <span className={cn("block text-[13px] leading-[18px]", unlocked ? "text-ink" : "text-ink-secondary")}>
          {secret ? t("achievements.secretName") : localized(item.name)}
        </span>
        <p className="mt-0.5 line-clamp-3 text-[12px] leading-4 text-ink-secondary">
          {secret ? (item.hint ? localized(item.hint) : t("achievements.secretDescription")) : localized(item.description)}
        </p>
        {progress !== null && state && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="achievement-progress flex-1" role="progressbar" aria-valuemin={0} aria-valuemax={state.target} aria-valuenow={state.current} aria-label={localized(item.name)}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="text-[11px] tabular-nums text-ink-secondary">{state.current}/{state.target}</span>
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-[14px]">
          <span className="achievement-card-tier font-semibold uppercase tracking-[0.06em]">{t(TIER_LABEL[tier])}</span>
          {state?.percent !== undefined && <span className="text-ink-secondary">{t("achievements.percent", { percent: state.percent })}</span>}
          {line && <span className="min-w-0 truncate text-ink-secondary" title={line}>{line}</span>}
        </div>
        {mastery && !secret && <MasteryUnlockPreview item={item} unlocked={unlocked} unlocks={unlocks} />}
      </div>
    </li>
  );
}

/** A setting that changes what colleagues see on this person's card: save it,
 * then ask the server for the cards again so every panel follows. */
function saveCardSetting(patch: Parameters<typeof saveAchievementSettings>[0]): void {
  void saveAchievementSettings(patch).then(forgetPublicAchievements);
}

/** The left column's label for a category, "All" included. */
export function achievementCategoryLabel(id: AchievementCategory | "all"): string {
  return id === "all" ? t("achievements.category.all") : t(CATEGORY_LABEL[id]);
}

export function AchievementsPage({ category = "all" }: { category?: AchievementCategory | "all" }) {
  const { status, snapshot } = useAchievements();
  const [filter, setFilter] = useState<AchievementStatusFilter>("all");
  const [reward, setReward] = useState<AchievementRewardFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    void loadAchievements();
    reportAchievement("achievements.viewed");
  }, []);

  const states = useMemo(() => new Map((snapshot?.items ?? []).map((item) => [item.id, item])), [snapshot]);
  const unlocks = unlocksFromSnapshot(snapshot ?? { rewards: [] });
  const shown = ACHIEVEMENTS.filter((item) => achievementMatches(item, states.get(item.id)?.unlockedAt, { category, status: filter, reward, search }, unlocks));

  if (status === "unavailable") {
    return <p className="px-1 text-[13px] text-ink-secondary" data-achievements-unavailable="">{t("achievements.unavailable")}</p>;
  }
  if (!snapshot) return <p className="px-1 text-[13px] text-ink-secondary">{t("achievements.loading")}</p>;

  const level = snapshot.level;
  const toNext = level.to - level.from;
  const titles = ACHIEVEMENTS.flatMap((item) => (states.get(item.id)?.unlockedAt ? item.rewards : [])).filter((reward) => reward.kind === "title");
  const recent = snapshot.recent.map((id) => ACHIEVEMENTS.find((item) => item.id === id)).filter((item): item is AchievementDefinition => Boolean(item));

  // 2026-10-16 (JC): drawn like Settings: the progress card, then grey
  // headings over the recent unlocks, the tiles and the card of settings.
  return (
    <div className="flex flex-col gap-5" data-achievements-page="">
      <section className="flex flex-wrap items-center gap-4 rounded-xl border-[0.5px] border-border bg-elevated p-4">
        <span className="grid size-14 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff,#e0a82e_72%)] text-[#1b1406] shadow-[0_0_18px_-4px_#e0a82e]" aria-hidden="true">
          <Trophy size={26} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[24px] font-semibold leading-7 tabular-nums text-ink" data-achievement-points="">
            {formatPoints(snapshot.points)} <span className="text-[13px] font-normal text-ink-secondary">{t("achievements.pointsUnit")}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary">
            <span className="font-medium text-ink">{t("achievements.level", { level: level.level })}</span>
            <div className="achievement-progress w-32" style={{ ["--tier" as string]: "#e0a82e" }} role="progressbar" aria-valuemin={0} aria-valuemax={toNext} aria-valuenow={snapshot.points - level.from} aria-label={t("achievements.nextLevel")}>
              <span style={{ width: `${Math.round(((snapshot.points - level.from) / toNext) * 100)}%` }} />
            </div>
            <span className="tabular-nums">{t("achievements.toNext", { points: formatPoints(level.to - snapshot.points) })}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-ink-secondary">
            <span>{t("achievements.unlockedCount", { count: snapshot.unlockedCount, total: snapshot.count })}</span>
            {snapshot.streak > 0 && (
              <span className="inline-flex items-center gap-1" data-achievement-streak="">
                <Flame size={12} className="text-[#f97316]" aria-hidden="true" />
                {t("achievements.streak", { days: snapshot.streak })}
              </span>
            )}
          </div>
        </div>
      </section>

      {category === "all" && recent.length > 0 && (
        <SettingsGroup title={t("achievements.recent")} groupId="achievements.recent" plain>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {recent.map((item) => {
              const reward = item.rewards[0];
              const showArt = Boolean(reward && (reward.kind === "skin" || reward.kind === "character") && characterUnlocked(unlocks, reward.character));
              const Icon = achievementIcon(item.icon);
              return (
                <li key={item.id} className="flex min-w-[180px] items-center gap-2 rounded-xl border-[0.5px] border-border bg-elevated px-2.5 py-2" data-recent-achievement={item.id}>
                  <span className="grid size-9 shrink-0 place-items-center">
                    {showArt && reward ? (
                      <Suspense fallback={null}><RewardPreview reward={reward} size={30} animated={false} /></Suspense>
                    ) : (
                      <Icon size={18} aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{localized(item.name)}</span>
                    <span className="block text-[11.5px] tabular-nums text-ink-secondary">+{item.points}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </SettingsGroup>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <div className="mr-auto flex min-w-0 items-center gap-2 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1 focus-within:border-border-strong">
            <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("achievements.search")}
              aria-label={t("achievements.searchLabel")}
              data-achievement-search=""
              className="w-40 min-w-0 bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
          <PillSelect
            value={reward}
            ariaLabel={t("achievements.rewardFilter")}
            options={achievementRewardFilters(unlocksFromSnapshot(snapshot)).map((id) => ({ value: id, label: achievementRewardFilterLabel(id) }))}
            onChange={setReward}
          />
          <PillSelect
            value={filter}
            ariaLabel={t("achievements.filter")}
            options={[
              { value: "all", label: t("achievements.filter.all") },
              { value: "unlocked", label: t("achievements.filter.unlocked") },
              { value: "locked", label: t("achievements.filter.locked") },
            ]}
            onChange={setFilter}
          />
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2" data-achievement-grid="">
          {shown.map((item) => <AchievementCard key={item.id} item={item} state={states.get(item.id)} unlocks={unlocks} />)}
        </ul>
      </section>

      <SettingsGroup title={t("achievements.settings.title")} groupId="achievements.settings">
        {titles.length > 0 && (
          <CompactRow label={t("achievements.titleLabel")} rowId="achievements.title">
            <PillSelect
              value={snapshot.settings.title ?? ""}
              ariaLabel={t("achievements.titleLabel")}
              options={[
                { value: "", label: t("achievements.titleNone") },
                ...titles.flatMap((reward) => (reward.kind === "title" ? [{ value: reward.id, label: localized(reward.name) }] : [])),
              ]}
              onChange={(next) => saveCardSetting({ title: next || null })}
            />
          </CompactRow>
        )}
        <DescribedRow label={t("achievements.settings.showPoints")} help={t("achievements.settings.showPointsHint")}>
          <Switch checked={snapshot.settings.showPoints} aria-label={t("achievements.settings.showPoints")} onClick={() => saveCardSetting({ showPoints: !snapshot.settings.showPoints })} />
        </DescribedRow>
        <DescribedRow label={t("achievements.settings.showTitle")} help={t("achievements.settings.showTitleHint")}>
          <Switch checked={snapshot.settings.showTitle !== false} aria-label={t("achievements.settings.showTitle")} onClick={() => saveCardSetting({ showTitle: snapshot.settings.showTitle === false })} />
        </DescribedRow>
        <DescribedRow label={t("achievements.settings.toasts")} help={t("achievements.settings.toastsHint")}>
          <Switch checked={snapshot.settings.toasts} aria-label={t("achievements.settings.toasts")} onClick={() => void saveAchievementSettings({ toasts: !snapshot.settings.toasts })} />
        </DescribedRow>
        <DescribedRow label={t("achievements.settings.native")} help={t("achievements.settings.nativeHint")}>
          <Switch
            checked={snapshot.settings.native}
            aria-label={t("achievements.settings.native")}
            onClick={() => {
              const next = !snapshot.settings.native;
              if (next) void requestNotificationPermission();
              void saveAchievementSettings({ native: next });
            }}
          />
        </DescribedRow>
        <DescribedRow label={t("achievements.settings.public")} help={t("achievements.settings.publicHint")}>
          <Switch checked={snapshot.settings.public} aria-label={t("achievements.settings.public")} onClick={() => saveCardSetting({ public: !snapshot.settings.public })} />
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
}
