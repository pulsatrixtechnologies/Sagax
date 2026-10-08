// Settings > Achievements: the person's trophies. One line for points, level,
// unlocked count and streak (with the title picker), then every achievement
// as a compact row by category, unlocked first, a "New" tag on recent ones
// (locked with its progress, secret until found). The ring color is the
// rarity; the tooltip has the share of people and the reward. Category,
// "Locked only" and search narrow that list together. The
// settings that hide the points or the toasts sit at the bottom.
import { useEffect, useMemo, useState } from "react";
import { Flame, Lock, Trophy } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES, rarityForPoints, type AchievementCategory, type AchievementDefinition, type AchievementItemState } from "../../../shared/achievements";
import { loadAchievements, localized, reportAchievement, rewardLabel, saveAchievementSettings, useAchievements } from "@/lib/achievements";
import { forgetPublicAchievements } from "@/lib/public-achievements";
import { requestNotificationPermission } from "@/lib/notify";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { SettingRow, Switch } from "../SettingsPrimitives";
import { achievementIcon } from "./icons";
import { achievementMatches } from "./achievement-filters";
import "./achievements.css";

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

function AchievementRow({ item, state, isNew }: { item: AchievementDefinition; state?: AchievementItemState; isNew: boolean }) {
  const unlocked = Boolean(state?.unlockedAt);
  const secret = item.hidden && !unlocked;
  const tier = rarityForPoints(item.points);
  const Icon = secret ? Lock : achievementIcon(item.icon);
  const inProgress = state && !unlocked && state.target > 1 && state.current > 0 ? state : null;
  const reward = item.rewards[0];
  const name = secret ? t("achievements.secretName") : localized(item.name);
  const description = secret ? (item.hint ? localized(item.hint) : t("achievements.secretDescription")) : localized(item.description);
  const rewardText = reward && !secret ? rewardLabel(reward) : "";
  const tooltip = [t(TIER_LABEL[tier]), state?.percent !== undefined ? t("achievements.percent", { percent: state.percent }) : "", rewardText].filter(Boolean).join(" · ");
  return (
    <li
      className="achievement-row flex items-center gap-3 rounded-lg px-2 py-1.5"
      data-tier={tier}
      data-unlocked={unlocked ? "" : undefined}
      data-achievement={item.id}
      data-secret={secret ? "" : undefined}
      title={tooltip}
    >
      <span className="achievement-row-icon" aria-hidden="true">
        <Icon size={15} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate text-[13px] font-medium leading-[18px]", unlocked ? "text-ink" : "text-ink-secondary")}>{name}</span>
          {isNew && <span className="achievement-new-tag" data-achievement-new="">{t("achievements.new")}</span>}
        </div>
        <p className="truncate text-[12px] leading-[16px] text-ink-tertiary">
          {description}
          {rewardText && <span className="achievement-row-reward"> · {rewardText}</span>}
        </p>
        {inProgress && (
          <div className="achievement-progress mt-1 w-24" role="progressbar" aria-valuemin={0} aria-valuemax={inProgress.target} aria-valuenow={inProgress.current} aria-label={name}>
            <span style={{ width: `${Math.round((inProgress.current / inProgress.target) * 100)}%` }} />
          </div>
        )}
      </div>
      {inProgress && <span className="shrink-0 text-[11px] tabular-nums text-ink-tertiary">{inProgress.current}/{inProgress.target}</span>}
      <span className="w-8 shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink-secondary">{item.points}</span>
    </li>
  );
}

/** A setting that changes what colleagues see on this person's card: save it,
 * then ask the server for the cards again so every panel follows. */
function saveCardSetting(patch: Parameters<typeof saveAchievementSettings>[0]): void {
  void saveAchievementSettings(patch).then(forgetPublicAchievements);
}

export function AchievementsPage() {
  const { status, snapshot } = useAchievements();
  const [category, setCategory] = useState<AchievementCategory | "all">("all");
  const [lockedOnly, setLockedOnly] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void loadAchievements();
    reportAchievement("achievements.viewed");
  }, []);

  const states = useMemo(() => new Map((snapshot?.items ?? []).map((item) => [item.id, item])), [snapshot]);
  const shown = useMemo(() => {
    const unlockedAt = (id: string) => Boolean(states.get(id)?.unlockedAt);
    const order = (item: AchievementDefinition) => ACHIEVEMENT_CATEGORIES.indexOf(item.category);
    return ACHIEVEMENTS
      .filter((item) => achievementMatches(item, states.get(item.id)?.unlockedAt, { category, lockedOnly, search }))
      .sort((a, b) => order(a) - order(b) || Number(unlockedAt(b.id)) - Number(unlockedAt(a.id)));
  }, [states, category, lockedOnly, search]);

  if (status === "unavailable") {
    return <p className="px-1 text-[13px] text-ink-secondary" data-achievements-unavailable="">{t("achievements.unavailable")}</p>;
  }
  if (!snapshot) return <p className="px-1 text-[13px] text-ink-secondary">{t("achievements.loading")}</p>;

  const level = snapshot.level;
  const toNext = level.to - level.from;
  const titles = ACHIEVEMENTS.flatMap((item) => (states.get(item.id)?.unlockedAt ? item.rewards : [])).filter((reward) => reward.kind === "title");
  const recent = new Set(snapshot.recent);

  return (
    <div className="flex flex-col gap-4" data-achievements-page="">
      <section className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-ink-secondary">
        <span className="inline-flex items-baseline gap-1.5 text-ink" data-achievement-points="">
          <Trophy size={14} className="self-center text-[#e0a82e]" aria-hidden="true" />
          <span className="text-[15px] font-semibold tabular-nums">{formatPoints(snapshot.points)}</span>
          <span className="text-ink-secondary">{t("achievements.pointsUnit")}</span>
        </span>
        <span className="inline-flex items-center gap-2" title={t("achievements.toNext", { points: formatPoints(level.to - snapshot.points) })}>
          <span className="font-medium text-ink">{t("achievements.level", { level: level.level })}</span>
          <span className="achievement-progress w-20" style={{ ["--tier" as string]: "#e0a82e", height: 3 }} role="progressbar" aria-valuemin={0} aria-valuemax={toNext} aria-valuenow={snapshot.points - level.from} aria-label={t("achievements.nextLevel")}>
            <span style={{ width: `${Math.round(((snapshot.points - level.from) / toNext) * 100)}%` }} />
          </span>
        </span>
        <span>{t("achievements.unlockedCount", { count: snapshot.unlockedCount, total: snapshot.count })}</span>
        {snapshot.streak > 0 && (
          <span className="inline-flex items-center gap-1" data-achievement-streak="">
            <Flame size={12} className="text-[#f97316]" aria-hidden="true" />
            {t("achievements.streak", { days: snapshot.streak })}
          </span>
        )}
        {titles.length > 0 && (
          <select
            value={snapshot.settings.title ?? ""}
            onChange={(event) => saveCardSetting({ title: event.target.value || null })}
            aria-label={t("achievements.titleLabel")}
            className="ml-auto max-w-[160px] rounded-md border border-border bg-ink/[0.03] px-1.5 py-0.5 text-[12px] text-ink"
          >
            <option value="">{t("achievements.titleNone")}</option>
            {titles.map((reward) => reward.kind === "title" && <option key={reward.id} value={reward.id}>{localized(reward.name)}</option>)}
          </select>
        )}
      </section>

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
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("achievements.search")}
            aria-label={t("achievements.searchLabel")}
            data-achievement-search=""
            className="w-36 rounded-lg border border-border bg-ink/[0.03] px-2 py-1 text-[12px] text-ink placeholder:text-ink-tertiary"
          />
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-[12px] text-ink-secondary">
            {t("achievements.lockedOnly")}
            <Switch checked={lockedOnly} aria-label={t("achievements.lockedOnly")} data-achievement-locked-only="" onClick={() => setLockedOnly((value) => !value)} />
          </label>
        </div>
        <ul className="flex flex-col">
          {shown.map((item) => <AchievementRow key={item.id} item={item} state={states.get(item.id)} isNew={recent.has(item.id) && Boolean(states.get(item.id)?.unlockedAt)} />)}
        </ul>
      </section>

      <section className="rounded-[14px] border-[0.5px] border-border py-1">
        <SettingRow title={t("achievements.settings.showPoints")} subtitle={t("achievements.settings.showPointsHint")}>
          <Switch checked={snapshot.settings.showPoints} aria-label={t("achievements.settings.showPoints")} onClick={() => saveCardSetting({ showPoints: !snapshot.settings.showPoints })} />
        </SettingRow>
        <SettingRow title={t("achievements.settings.showTitle")} subtitle={t("achievements.settings.showTitleHint")}>
          <Switch checked={snapshot.settings.showTitle !== false} aria-label={t("achievements.settings.showTitle")} onClick={() => saveCardSetting({ showTitle: snapshot.settings.showTitle === false })} />
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
          <Switch checked={snapshot.settings.public} aria-label={t("achievements.settings.public")} onClick={() => saveCardSetting({ public: !snapshot.settings.public })} />
        </SettingRow>
      </section>
    </div>
  );
}
