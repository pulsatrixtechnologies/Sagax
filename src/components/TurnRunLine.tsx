import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Message } from "@/state/store";
import { effortLabel } from "@/lib/effort-label";

/** The words for what a turn ran on: "Claude Fable 5.1 · effort Medium". The
 * model reads as the picker names it; no recorded effort is "Default". */
export function turnRunText(
  run: NonNullable<Message["turnRun"]>,
  instances: ReadonlyArray<{ instanceId: string; models: { options: ReadonlyArray<{ id: string; label?: string }> } }>,
): string {
  const option = instances.find((instance) => instance.instanceId === run.instanceId)?.models.options.find((entry) => entry.id === run.model);
  return t("chat.turnRun", {
    model: option?.label ?? run.model,
    effort: run.effort ? effortLabel(run.effort) : t("chat.turnRun.effortDefault"),
  });
}

/** A quiet line under a bot reply with the model and effort that wrote it.
 * The caller decides when it shows (a pointer resting on the reply, or
 * keyboard focus inside the message row, a `group`); this only fades. It
 * is always laid out, so showing it never pushes the reply above it
 * (JC, 2026-10-15). */
export function TurnRunLine({ run, visible }: { run: NonNullable<Message["turnRun"]>; visible: boolean }) {
  const { state } = useStore();
  return (
    <div
      data-turn-run
      aria-hidden={!visible}
      className={cn(
        "mt-1 px-1 text-[11px] leading-4 text-ink-tertiary transition-opacity duration-200",
        visible ? "visible opacity-100" : "invisible opacity-0 group-focus-within:visible group-focus-within:opacity-100",
      )}
    >
      {turnRunText(run, state.instances)}
    </div>
  );
}
