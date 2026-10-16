import type { TerminalDestinationChoice } from "../../../shared/terminal-resources";
import { terminalRequestBehavior, type TerminalDestinationPick, type TerminalRequestCardData } from "../../../shared/terminal-request";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ASK_FIELD } from "../AskCard";

/** The key a destination is picked by on the card. */
export function terminalDestinationKey(choice: Pick<TerminalDestinationChoice, "provider" | "resourceId">): string {
  return `${choice.provider}:${choice.resourceId}`;
}

/** The destination an answer opens: the one picked on the card (`choiceKey`,
 * "" = the bot's) when the answer opens a terminal and the card offered it;
 * nothing for a refusal or an unknown pick (the server then keeps the bot's). */
export function terminalAnswerPick(request: TerminalRequestCardData, choiceKey: string, answer: string): TerminalDestinationPick | undefined {
  if (terminalRequestBehavior(answer) !== "allow") return undefined;
  const key = choiceKey || terminalDestinationKey(request);
  const picked = (request.destinations ?? []).find((choice) => terminalDestinationKey(choice) === key);
  return picked ? { provider: picked.provider, resourceId: picked.resourceId } : undefined;
}

/** What a destination is called in the app's language: the person's own
 * environments by their kind, a server host by the name the server gave it. */
export function terminalDestinationLabel(choice: TerminalDestinationChoice): string {
  const kind = choice.provider === "sandbox"
    ? t("terminal.destination.sandbox")
    : choice.provider === "local-vm"
      ? t("terminal.destination.localVm")
      : choice.provider === "desktop"
        ? t("terminal.destination.desktop")
        : choice.label;
  return choice.hostLabel && choice.hostLabel !== kind ? `${kind} · ${choice.hostLabel}` : kind;
}

/** The destination menu of a terminal card (2026-10-15): the bot's choice
 * first, then every other destination this person may open. Shown only when
 * there is a choice to make; the server checks the pick again. */
export function TerminalDestinationPicker({
  destinations,
  value,
  onChange,
  disabled,
}: {
  destinations: readonly TerminalDestinationChoice[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  if (destinations.length < 2) return null;
  return (
    <label className="mb-2 flex min-w-0 items-center gap-2 text-[13px] text-ink-secondary" data-terminal-destination="">
      <span className="shrink-0">{t("terminal.destination.label")}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(ASK_FIELD, "min-w-0 flex-1 truncate pe-7")}
        aria-label={t("terminal.destination.label")}
      >
        {destinations.map((choice) => (
          <option key={terminalDestinationKey(choice)} value={terminalDestinationKey(choice)}>
            {terminalDestinationLabel(choice)}
          </option>
        ))}
      </select>
    </label>
  );
}
