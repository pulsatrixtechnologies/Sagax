// Settings > Computer > Computer care, first row (parity R7, system 6 and
// 5): Recover when the bot's computer is stuck (Grok Bot's "Recover
// computer"), Update now otherwise. Both rebuild it from the current image
// and keep the person's files (src/lib/computer-recover.ts). Hidden where
// this person has no computer to care for.
import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import { t } from "@/lib/i18n";
import { computerAction, loadComputerStatus, updateComputer, type ComputerStatusView } from "@/lib/computer-recover";
import { ApiError } from "@/state/store";
import { DescribedRow, PILL } from "../SettingsPrimitives";

type Confirm = (message: string) => Promise<boolean>;
const defaultConfirm: Confirm = (message) => window.ogb?.confirm ? window.ogb.confirm(message) : Promise.resolve(window.confirm(message));

export function ComputerRecoverRow({ initial = null, confirm = defaultConfirm }: { initial?: ComputerStatusView | null; confirm?: Confirm }) {
  const [status, setStatus] = useState<ComputerStatusView | null>(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    loadComputerStatus(controller.signal).then(setStatus, () => { /* no computer here: no row */ });
    return () => controller.abort();
  }, [initial]);

  const action = computerAction(status);
  if (!action) return null;
  const recover = action === "recover";

  const run = async () => {
    if (!(await confirm(t(recover ? "computerCare.recover.confirm" : "computerCare.updateNow.confirm")))) return;
    setRunning(true);
    setError("");
    try {
      setStatus(await updateComputer());
    } catch (cause) {
      // the server holds it back: a bot works on it, or an update already runs
      const code = cause instanceof ApiError ? (cause.body as { code?: unknown } | undefined)?.code : undefined;
      setError(t(code === "computer_busy" ? "computerCare.refused.busy"
        : code === "computer_updating" ? "computerCare.refused.updating"
          : recover ? "computerCare.recover.error" : "computerCare.updateNow.error"));
      loadComputerStatus().then(setStatus, () => {});
    } finally {
      setRunning(false);
    }
  };

  const description = running
    ? t(recover ? "computerCare.recover.running" : "computerCare.updateNow.running")
    : recover
      ? t(status?.waking ? "computerCare.recover.waking" : "computerCare.recover.hint")
      : t("computerCare.updateNow.hint");

  return (
    <div data-settings-card="computer.recover" data-computer-action={action}>
      <DescribedRow
        label={t(recover ? "computerCare.recover.title" : "computerCare.updateNow.title")}
        rowId="computerRecover"
        icon={<RotateCcw size={14} />}
        description={<span role={running ? "status" : undefined}>{description}</span>}
        below={error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      >
        <button type="button" className={`${PILL} gap-1.5`} disabled={running} onClick={() => void run()} data-computer-recover="">
          {running && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
          {t(recover ? "computerCare.recover.button" : "computerCare.updateNow.button")}
        </button>
      </DescribedRow>
    </div>
  );
}
