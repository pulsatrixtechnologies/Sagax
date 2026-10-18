// The bot's Works on, once, as the editor's Workspace page on a solo server
// and on an organization server. Workspace is always Auto (JC 2026-10-18):
// the bot picks where each task runs among every place it may use (the
// cloud, a Local VM, this computer, the browser), so no place is offered
// here. Off stays: it is the restriction that gives the bot no computer and
// no browser at all, and lifting it would widen what the bot may reach.
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { placeLabelKey, type EffectivePlace } from "@/lib/place";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import type { Bot } from "@/state/store";

import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";

/** null is Auto. A place an older build saved reads as Auto (the server
 * moves it back to Auto at start). */
export type WorksOnMode = "off" | null;
export const WORKS_ON_MODES: readonly WorksOnMode[] = [null, "off"];

/** What the bot's stored Works on means now: Off, else Auto. */
export function worksOnMode(computer: Bot["computer"] | null | undefined): WorksOnMode {
  return computer === "off" ? "off" : null;
}

const MEANS: Record<"auto" | "off", LocaleKey> = {
  auto: "worksOn.tip.autoOnly", off: "computer.dest.offDesc",
};

/** The tooltip of one choice: what it means. */
export function worksOnTip(mode: WorksOnMode): string {
  return t(MEANS[mode ?? "auto"]);
}

/** The view part, without the store: the panel feeds it, tests render it. */
export function WorksOnControl({ value, onChange, organization = true }: {
  value: WorksOnMode;
  onChange: (mode: WorksOnMode) => void;
  /** Organization labels say what Auto does there. Solo labels say Auto. */
  organization?: boolean;
}) {
  return (
    // The editor's Workspace page titles it already (JC 2026-10-15): the
    // heading stays for the radio group's name, read by assistive tech only,
    // and the explanation shows under the page title.
    <section aria-labelledby="works-on-setting" aria-describedby="works-on-setting-hint" data-works-on-setting={value ?? "auto"} data-works-on-org={organization ? "1" : "0"}>
      <h3 id="works-on-setting" className="sr-only">{t("computer.worksOn")}</h3>
      <p id="works-on-setting-hint" className="text-[12.5px] leading-relaxed text-ink-secondary">{t("worksOn.autoOnlyHelp")}</p>
      <div role="radiogroup" aria-labelledby="works-on-setting" className="mt-3 grid grid-cols-2 gap-0.5 rounded-lg bg-control p-0.5">
        {WORKS_ON_MODES.map((mode) => {
          const key = (mode ?? "auto") as EffectivePlace;
          const selected = mode === value;
          return (
            <button key={key} type="button" role="radio" aria-checked={selected}
              title={worksOnTip(mode)} data-works-on-choice={key}
              onClick={() => { if (!selected) onChange(mode); }}
              className={cn("min-h-[36px] truncate whitespace-nowrap rounded-md border px-2 py-1 text-[12px] md:min-h-0",
                selected ? "border-accent-border bg-selected font-medium text-ink shadow-sm" : "border-transparent text-ink-secondary hover:bg-raised-hover hover:text-ink")}>
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
  const derived = useBotSettingsDerived(bot);
  const organization = usePerspicaxOrg() !== null;
  if (!derived.canEdit("computer")) return null;
  return (
    <WorksOnControl
      value={worksOnMode(bot.computer)}
      organization={organization}
      onChange={(mode) => derived.patch({ computer: mode })}
    />
  );
}
