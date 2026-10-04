// The bot's Works on, once, at the top of the Computer tab on a solo
// server and on an organization server. The labels are the same ones the
// composer chip uses (placeLabelKey). What each place means, and why one
// is not available, is in its tooltip.
import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { placeLabelKey, placeOffered, type EffectivePlace } from "@/lib/place";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useStore, type Bot } from "@/state/store";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";

export type WorksOnMode = Bot["computer"] | null;
export const WORKS_ON_MODES = [null, "cloud", "vm", "local", "browser", "off"] as const;

const SOLO_MEANS: Record<string, LocaleKey> = {
  auto: "computer.dest.autoDesc", cloud: "computer.dest.cloudDesc", vm: "computer.dest.vmDesc",
  local: "computer.dest.localDesc", browser: "computer.dest.browserDesc", off: "computer.dest.offDesc",
};
const ORG_MEANS: Record<string, LocaleKey> = {
  auto: "worksOn.tip.autoOrg", cloud: "computer.dest.cloudOrgDesc", vm: "computer.dest.vmOrgDesc",
  local: "computer.dest.localOrgDesc", browser: "computer.dest.browserDesc", off: "computer.dest.offDesc",
};

/** Choices this server offers. Auto and Off are always listed. An
 * organization server offers every place; a solo server hides Cloud until
 * a Boat or a VPS is on, and an OMB Cloud home hides Local VM and This
 * computer (placeOffered). */
export function worksOnModes(
  config: Parameters<typeof placeOffered>[1],
  organization: boolean,
): WorksOnMode[] {
  return WORKS_ON_MODES.filter((mode) => mode === null || mode === "off" || placeOffered(mode, config, organization));
}

/** The tooltip of one choice: what it means, or why it cannot be chosen. */
export function worksOnTip(mode: WorksOnMode, disabledReason?: string | null, organization = true): string {
  const key = (mode ?? "auto") as EffectivePlace;
  const means = t((organization ? ORG_MEANS : SOLO_MEANS)[key]!);
  return disabledReason ? t("worksOn.disabled", { place: t(placeLabelKey(key, organization)), reason: disabledReason }) : means;
}

/** The view part, without the store: the panel feeds it, tests render it. */
export function WorksOnControl({ value, onChange, disabled, organization = true, modes }: {
  value: WorksOnMode;
  onChange: (mode: WorksOnMode) => void;
  /** Choices that cannot be picked, with the reason shown in their tooltip. */
  disabled: Partial<Record<"local" | "browser", string>>;
  /** Organization labels name the server environment. Solo labels match the chip. */
  organization?: boolean;
  /** Offered choices. Defaults to every place. */
  modes?: readonly WorksOnMode[];
}) {
  const shown = modes ?? WORKS_ON_MODES;
  return (
    <section aria-labelledby="works-on-setting" aria-describedby="works-on-setting-hint" className="mb-4 rounded-xl border border-hairline/40 p-4" data-works-on-setting={value ?? "auto"} data-works-on-org={organization ? "1" : "0"}>
      <div id="works-on-setting" className="text-[13px] font-medium text-ink">{t("computer.worksOn")}</div>
      <div id="works-on-setting-hint" className="mt-0.5 text-[13px] text-ink-secondary">{t(organization ? "worksOn.sectionTip" : "worksOn.help")}</div>
      <div role="radiogroup" aria-labelledby="works-on-setting" className="mt-3 grid grid-cols-3 gap-0.5 rounded-lg bg-control p-0.5">
        {shown.map((mode) => {
          const key = (mode ?? "auto") as EffectivePlace;
          const reason = mode === "local" || mode === "browser" ? disabled[mode] : undefined;
          const selected = (mode ?? null) === (value ?? null);
          return (
            <button key={key} type="button" role="radio" aria-checked={selected} disabled={Boolean(reason)}
              title={worksOnTip(mode, reason, organization)} data-works-on-choice={key}
              onClick={() => { if (!selected) onChange(mode); }}
              className={cn("min-h-[36px] truncate whitespace-nowrap rounded-md border px-2 py-1 text-[12px] md:min-h-0",
                selected ? "border-accent-border bg-selected font-medium text-ink shadow-sm" : "border-transparent text-ink-secondary hover:bg-raised-hover hover:text-ink",
                reason && "cursor-not-allowed opacity-40 hover:text-ink-secondary")}>
              {t(placeLabelKey(key, organization))}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The bot's own setting, saved like every bot edit. Hidden when this
 * person cannot save `computer` (an organization member who does not own
 * the bot). */
export function WorksOnSetting({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const derived = useBotSettingsDerived(bot);
  const organization = usePerspicaxOrg() !== null;
  const [warnLocal, setWarnLocal] = useState(false);
  if (!derived.canEdit("computer")) return null;
  const disabled: Partial<Record<"local" | "browser", string>> = {};
  if (!derived.localSelectable) disabled.local = derived.localDisabledReason ?? t("place.unavailable");
  if (!derived.browserSelectable) disabled.browser = derived.browserDisabledReason;
  return (
    <>
      <WorksOnControl
        value={bot.computer ?? null}
        organization={organization}
        modes={worksOnModes(state.config, organization)}
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
