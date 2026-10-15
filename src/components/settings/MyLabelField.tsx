// Settings > General, in the account card right under the person's name: their
// own label (src/lib/person-labels.ts), edited in place as a bot's label is in
// its panel. The pencil always shows so the line reads as editable. Sagax's
// own field, on a solo server and on an organization server alike.
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
    <div className="-ml-1.5 flex min-w-0" data-my-label="">
      <InlineEditableText
        value={label}
        maxLength={PERSON_LABEL_MAX}
        placeholder={t("personLabel.add")}
        ariaLabel={t("personLabel.edit")}
        onSave={(next) => { void savePersonLabel(principalId, next).catch(() => dispatch({ type: "error", message: t("personLabel.saveError") })); }}
        muted
        className="justify-start text-[12.5px] leading-4 [&_svg]:opacity-100"
        inputClassName="text-left"
      />
    </div>
  );
}
