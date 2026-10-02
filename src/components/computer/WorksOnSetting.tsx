// The bot's Works on, on an organization server, as its own item of the
// bot panel's More tab ("Computer", between Access and Model), drawn like
// the other items there: a card with a title, a one-line hint and the
// control. Short labels; what each place means, and why one is not
// available, is in its tooltip. (It sat under the Computer tab's screen
// before; that tab now shows only the screen.)
import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore, type Bot } from "@/state/store";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";

export type WorksOnMode = Bot["computer"] | null;
export const ORG_WORKS_ON_MODES = [null, "cloud", "vm", "local", "browser", "off"] as const;

const SHORT: Record<string, LocaleKey> = {
  auto: "place.auto", cloud: "worksOn.short.cloud", vm: "place.vm", local: "place.local", browser: "place.browser", off: "place.off",
};
const MEANS: Record<string, LocaleKey> = {
  auto: "worksOn.tip.autoOrg", cloud: "computer.dest.cloudOrgDesc", vm: "computer.dest.vmOrgDesc",
  local: "computer.dest.localOrgDesc", browser: "computer.dest.browserDesc", off: "computer.dest.offDesc",
};

/** The tooltip of one choice: what it means, or why it cannot be chosen. */
export function worksOnTip(mode: WorksOnMode, disabledReason?: string | null): string {
  const key = mode ?? "auto";
  const means = t(MEANS[key]!);
  return disabledReason ? t("worksOn.disabled", { place: t(SHORT[key]!), reason: disabledReason }) : means;
}

/** The view part, without the store: the panel feeds it, tests render it. */
export function WorksOnControl({ value, onChange, disabled }: {
  value: WorksOnMode;
  onChange: (mode: WorksOnMode) => void;
  /** Choices that cannot be picked, with the reason shown in their tooltip. */
  disabled: Partial<Record<"local" | "browser", string>>;
}) {
  return (
    <section aria-labelledby="works-on-setting" aria-describedby="works-on-setting-hint" className="rounded-xl border border-hairline/40 p-4" data-works-on-setting={value ?? "auto"}>
      <div id="works-on-setting" className="text-[13px] font-medium text-ink">{t("computer.worksOn")}</div>
      <div id="works-on-setting-hint" className="mt-0.5 text-[13px] text-ink-secondary">{t("worksOn.sectionTip")}</div>
      <div role="radiogroup" aria-labelledby="works-on-setting" className="mt-3 grid grid-cols-3 gap-0.5 rounded-lg bg-control p-0.5">
        {ORG_WORKS_ON_MODES.map((mode) => {
          const key = mode ?? "auto";
          const reason = mode === "local" || mode === "browser" ? disabled[mode] : undefined;
          const selected = (mode ?? null) === (value ?? null);
          return (
            <button key={key} type="button" role="radio" aria-checked={selected} disabled={Boolean(reason)}
              title={worksOnTip(mode, reason)} data-works-on-choice={key}
              onClick={() => { if (!selected) onChange(mode); }}
              className={cn("min-h-[36px] truncate whitespace-nowrap rounded-md border px-2 py-1 text-[12px] md:min-h-0",
                selected ? "border-accent-border bg-selected font-medium text-ink shadow-sm" : "border-transparent text-ink-secondary hover:bg-raised-hover hover:text-ink",
                reason && "cursor-not-allowed opacity-40 hover:text-ink-secondary")}>
              {t(SHORT[key]!)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The bot's own setting, saved like every bot edit. */
export function WorksOnSetting({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const derived = useBotSettingsDerived(bot);
  const [warnLocal, setWarnLocal] = useState(false);
  const disabled: Partial<Record<"local" | "browser", string>> = {};
  if (!derived.localSelectable) disabled.local = derived.localDisabledReason ?? t("place.unavailable");
  if (!derived.browserSelectable) disabled.browser = derived.browserDisabledReason;
  return (
    <>
      <WorksOnControl
        value={bot.computer ?? null}
        disabled={disabled}
        onChange={(mode) => {
          if (mode === "local" && derived.approvalMode === "auto") setWarnLocal(true);
          // a browser-only bot must actually have its browser
          else if (mode === "browser") derived.patch({ computer: mode, browser: true });
          else derived.patch({ computer: mode });
        }}
      />
      <LocalComputerAutoWarning
        open={warnLocal}
        onCancel={() => setWarnLocal(false)}
        onConfirm={() => {
          setWarnLocal(false);
          dispatch({ type: "updateBot", botId: bot.id, patch: { computer: "local", acknowledgeLocalAuto: true } });
        }}
      />
    </>
  );
}
