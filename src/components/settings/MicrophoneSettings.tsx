// Settings > Models and voice > Microphone: which input this computer
// records with, for dictation, voice notes and calls (lib/audio-input). The
// list comes from the window's own enumerateDevices; the choice stays on this
// computer. The macOS dictation helper keeps the system's input.
import { Mic } from "lucide-react";

import { useAudioInputs } from "@/lib/audio-input";
import { t } from "@/lib/i18n";
import { DescribedRow, PILL, PillSelect } from "../SettingsPrimitives";

const DEFAULT = "default";

export function MicrophoneSettings() {
  const mic = useAudioInputs();
  const listed = mic.selected ? mic.inputs.some((input) => input.id === mic.selected) : true;
  const options = [
    { value: DEFAULT, label: t("settings.microphone.default") },
    ...mic.inputs.map((input, index) => ({
      value: input.id,
      label: input.label || t("settings.microphone.unnamed", { number: index + 1 }),
    })),
    // a saved microphone that is not plugged in stays visible, so the choice is not lost
    ...(mic.selected && !listed && mic.loaded ? [{ value: mic.selected, label: t("settings.microphone.missing") }] : []),
  ];
  return (
    <div data-settings-card="voice.microphone">
      <DescribedRow
        label={t("settings.microphone.title")}
        rowId="microphone"
        icon={<Mic size={14} />}
        description={mic.selected && !listed && mic.loaded ? t("settings.microphone.missingHint") : t("settings.microphone.hint")}
      >
        {mic.namesHidden && (
          <button type="button" className={PILL} onClick={() => void mic.revealNames()} data-microphone-reveal="">
            {t("settings.microphone.showNames")}
          </button>
        )}
        <PillSelect
          value={mic.selected ?? DEFAULT}
          ariaLabel={t("settings.microphone.title")}
          onChange={(next) => mic.select(next === DEFAULT ? null : next)}
          options={options}
        />
      </DescribedRow>
    </div>
  );
}
