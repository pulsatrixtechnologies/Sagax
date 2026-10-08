// Settings > General, under the profile: the person's own label
// (src/lib/person-labels.ts), edited as a bot's label is in its panel.
// Sagax's own field, on a solo server and on an organization server alike.
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { savePersonLabel, usePersonLabel } from "@/lib/person-labels";
import { PERSON_LABEL_MAX } from "../../../shared/person-label";
import { InlineEditableText } from "../bot-settings/InlineEditableText";

export function MyLabelField() {
  const { state, dispatch } = useStore();
  const principalId = state.config?.viewer?.principalId?.trim() || null;
  const label = usePersonLabel(principalId);
  if (!principalId) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-3 border-t border-hairline-weak pt-2" data-my-label="">
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{t("personLabel.mine")}</div>
        <div className="text-[12px] text-ink-secondary">{t("personLabel.mineHint")}</div>
      </div>
      <InlineEditableText
        value={label}
        maxLength={PERSON_LABEL_MAX}
        placeholder={t("personLabel.add")}
        ariaLabel={t("personLabel.edit")}
        onSave={(next) => { void savePersonLabel(principalId, next).catch(() => dispatch({ type: "error", message: t("personLabel.saveError") })); }}
        muted
        className="shrink-0 text-[12.5px] leading-4"
      />
    </div>
  );
}
