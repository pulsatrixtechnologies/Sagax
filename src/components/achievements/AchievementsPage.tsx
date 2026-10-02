// Settings > Achievements: the person's trophies. Total points and level,
// the current streak, recent unlocks, then every achievement by category
// (unlocked, locked with its progress, secret until found), each with its
// points, its rarity (or the share of this server's people who have it,
// when there are enough people to say so) and what it unlocks. The settings
// that hide the points or the toasts sit at the bottom.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Flame, Lock, Trophy } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES, rarityForPoints, type AchievementCategory, type AchievementDefinition, type AchievementItemState } from "../../../shared/achievements";
import { loadAchievements, localized, reportAchievement, rewardLabel, saveAchievementSettings, useAchievements } from "@/lib/achievements";
import { requestNotificationPermission } from "@/lib/notify";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { SettingRow, Switch } from "../SettingsPrimitives";
import { achievementIcon } from "./icons";
import "./achievements.css";

const RewardPreview = lazy(() => import("./RewardPreview"));

const CATEGORY_LABEL: Record<AchievementCategory, LocaleKey> = {
  onboarding: "achievements.category.onboarding",
  productivity: "achievements.category.productivity",
  power: "achievements.category.power",
  voice: "achievements.category.voice",
  collaboration: "achievements.category.collaboration",
  streaks: "achievements.category.streaks",
  mastery: "achievements.category.mastery",
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

type Filter = "all" | "unlocked" | "locked";

function AchievementCard({ item, state }: { item: AchievementDefinition; state?: AchievementItemState }) {
  const unlocked = Boolean(state?.unlockedAt);
  const secret = item.hidden && !unlocked;
  const tier = rarityForPoints(item.points);
  const Icon = secret ? Lock : achievementIcon(item.icon);
  const progress = state && !unlocked && state.target > 1 && state.current > 0 ? state.current / state.target : null;
  const reward = item.rewards[0];
  return (
    <li
      className="achievement-card flex gap-3 rounded-xl border-[0.5px] border-border bg-card p-3"
      data-tier={tier}
      data-unlocked={unlocked ? "" : undefined}
      data-achievement={item.id}
      data-secret={secret ? "" : undefined}
    >
      <span className="achievement-card-badge" aria-hidden="true">
        <Icon size={17} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className={cn("text-[13px] font-medium leading-[18px]", unlocked ? "text-ink" : "text-ink-secondary")}>
            {secret ? t("achievements.secretName") : localized(item.name)}
          </span>
          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-ink-secondary">{item.points}</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-[16px] text-ink-tertiary">
          {secret ? (item.hint ? localized(item.hint) : t("achievements.secretDescription")) : localized(item.description)}
        </p>
        {progress !== null && state && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="achievement-progress flex-1" role="progressbar" aria-valuemin={0} aria-valuemax={state.target} aria-valuenow={state.current} aria-label={localized(item.name)}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="text-[11px] tabular-nums text-ink-tertiary">{state.current}/{state.target}</span>
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-[14px]">
          <span className="achievement-card-tier font-semibold uppercase tracking-[0.06em]">{t(TIER_LABEL[tier])}</span>
          {state?.percent !== undefined && <span className="text-ink-tertiary">{t("achievements.percent", { percent: state.percent })}</span>}
          {reward && !secret && <span className="truncate text-ink-tertiary">{rewardLabel(reward)}</span>}
        </div>
      </div>
    </li>
  );
}

export function AchievementsPage() {
  const { status, snapshot } = useAchievements();
  const [category, setCategory] = useState<AchievementCategory | "all">("all");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    void loadAchievements();
    reportAchievement("achievements.viewed");
  }, []);

  const states = useMemo(() => new Map((snapshot?.items ?? []).map((item) => [item.id, item])), [snapshot]);
  const shown = ACHIEVEMENTS.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    const unlocked = Boolean(states.get(item.id)?.unlockedAt);
    return filter === "all" || (filter === "unlocked" ? unlocked : !unlocked);
  });

  if (status === "unavailable") {
    return <p className="px-1 text-[13px] text-ink-secondary" data-achievements-unavailable="">{t("achievements.unavailable")}</p>;
  }
  if (!snapshot) return <p className="px-1 text-[13px] text-ink-secondary">{t("achievements.loading")}</p>;

  const level = snapshot.level;
  const toNext = level.to - level.from;
  const titles = ACHIEVEMENTS.flatMap((item) => (states.get(item.id)?.unlockedAt ? item.rewards : [])).filter((reward) => reward.kind === "title");
  const recent = snapshot.recent.map((id) => ACHIEVEMENTS.find((item) => item.id === id)).filter((item): item is AchievementDefinition => Boolean(item));

  return (
    <div className="flex flex-col gap-4" data-achievements-page="">
      <section className="flex flex-wrap items-center gap-4 rounded-[14px] border-[0.5px] border-border bg-card p-4">
        <span className="grid size-14 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff,#e0a82e_72%)] text-[#1b1406] shadow-[0_0_18px_-4px_#e0a82e]" aria-hidden="true">
          <Trophy size={26} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[24px] font-semibold leading-7 tabular-nums text-ink" data-achievement-points="">
            {formatPoints(snapshot.points)} <span className="text-[13px] font-normal text-ink-secondary">{t("achievements.pointsUnit")}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-secondary">
            <span className="font-medium text-ink">{t("achievements.level", { level: level.level })}</span>
            <div className="achievement-progress w-32" style={{ ["--tier" as string]: "#e0a82e" }} role="progressbar" aria-valuemin={0} aria-valuemax={toNext} aria-valuenow={snapshot.points - level.from} aria-label={t("achievements.nextLevel")}>
              <span style={{ width: `${Math.round(((snapshot.points - level.from) / toNext) * 100)}%` }} />
            </div>
            <span className="tabular-nums">{t("achievements.toNext", { points: formatPoints(level.to - snapshot.points) })}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-ink-tertiary">
            <span>{t("achievements.unlockedCount", { count: snapshot.unlockedCount, total: snapshot.count })}</span>
            {snapshot.streak > 0 && (
              <span className="inline-flex items-center gap-1" data-achievement-streak="">
                <Flame size={12} className="text-[#f97316]" aria-hidden="true" />
                {t("achievements.streak", { days: snapshot.streak })}
              </span>
            )}
          </div>
        </div>
        {titles.length > 0 && (
          <label className="flex flex-col gap-1 text-[11px] text-ink-tertiary">
            {t("achievements.titleLabel")}
            <select
              value={snapshot.settings.title ?? ""}
              onChange={(event) => void saveAchievementSettings({ title: event.target.value || null })}
              className="rounded-lg border border-border bg-ink/[0.03] px-2 py-1 text-[12px] text-ink"
            >
              <option value="">{t("achievements.titleNone")}</option>
              {titles.map((reward) => reward.kind === "title" && <option key={reward.id} value={reward.id}>{localized(reward.name)}</option>)}
            </select>
          </label>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-label={t("achievements.recent")}>
          <h3 className="mb-1.5 px-1 text-[12px] font-medium text-ink-secondary">{t("achievements.recent")}</h3>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {recent.map((item) => {
              const reward = item.rewards[0];
              return (
                <li key={item.id} className="flex min-w-[180px] items-center gap-2 rounded-xl border-[0.5px] border-border bg-card px-2.5 py-2" data-recent-achievement={item.id}>
                  <span className="grid size-9 shrink-0 place-items-center">
                    {reward && (reward.kind === "skin" || reward.kind === "character") ? (
                      <Suspense fallback={null}><RewardPreview reward={reward} size={30} animated={false} /></Suspense>
                    ) : (
                      (() => { const Icon = achievementIcon(item.icon); return <Icon size={18} aria-hidden="true" />; })()
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{localized(item.name)}</span>
                    <span className="block text-[11px] tabular-nums text-ink-tertiary">+{item.points}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={t("achievements.categories")} className="flex flex-wrap gap-0.5 rounded-lg bg-inset p-0.5">
            {(["all", ...ACHIEVEMENT_CATEGORIES] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={category === id}
                data-achievement-category={id}
                onClick={() => setCategory(id)}
                className={cn("rounded-md px-2 py-0.5 text-[11.5px] leading-5", category === id ? "bg-control text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}
              >
                {id === "all" ? t("achievements.category.all") : t(CATEGORY_LABEL[id])}
              </button>
            ))}
          </div>
          <select
            value={filter}
            aria-label={t("achievements.filter")}
            onChange={(event) => setFilter(event.target.value as Filter)}
            className="ml-auto rounded-lg border border-border bg-ink/[0.03] px-2 py-1 text-[12px] text-ink"
          >
            <option value="all">{t("achievements.filter.all")}</option>
            <option value="unlocked">{t("achievements.filter.unlocked")}</option>
            <option value="locked">{t("achievements.filter.locked")}</option>
          </select>
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {shown.map((item) => <AchievementCard key={item.id} item={item} state={states.get(item.id)} />)}
        </ul>
      </section>

      <section className="rounded-[14px] border-[0.5px] border-border py-1">
        <SettingRow title={t("achievements.settings.showPoints")} subtitle={t("achievements.settings.showPointsHint")}>
          <Switch checked={snapshot.settings.showPoints} aria-label={t("achievements.settings.showPoints")} onClick={() => void saveAchievementSettings({ showPoints: !snapshot.settings.showPoints })} />
        </SettingRow>
        <SettingRow title={t("achievements.settings.toasts")} subtitle={t("achievements.settings.toastsHint")}>
          <Switch checked={snapshot.settings.toasts} aria-label={t("achievements.settings.toasts")} onClick={() => void saveAchievementSettings({ toasts: !snapshot.settings.toasts })} />
        </SettingRow>
        <SettingRow title={t("achievements.settings.native")} subtitle={t("achievements.settings.nativeHint")}>
          <Switch
            checked={snapshot.settings.native}
            aria-label={t("achievements.settings.native")}
            onClick={() => {
              const next = !snapshot.settings.native;
              if (next) void requestNotificationPermission();
              void saveAchievementSettings({ native: next });
            }}
          />
        </SettingRow>
        <SettingRow title={t("achievements.settings.public")} subtitle={t("achievements.settings.publicHint")}>
          <Switch checked={snapshot.settings.public} aria-label={t("achievements.settings.public")} onClick={() => void saveAchievementSettings({ public: !snapshot.settings.public })} />
        </SettingRow>
      </section>
    </div>
  );
}
