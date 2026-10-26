// "Redo the wizard" in the bot's panel (2026-10-26): the wizard's steps
// again, prefilled from the bot. While the bot is still a wizard draft, the
// same button says so and resumes it. Shown to whoever may change the bot.
import { useEffect, useState } from "react";
import { Wand2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { canEditBotField } from "@/lib/bot-capabilities";
import { readWizardDraft } from "@/lib/bot-wizard";

export function WizardPanelButton({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const mayChange = canEditBotField(state.config, bot, "soul");
  useEffect(() => {
    if (!mayChange) return;
    let cancelled = false;
    void readWizardDraft(bot.id, activeLocale())
      .then(({ draft }) => { if (!cancelled) setOpen(draft.status === "draft"); })
      .catch(() => { if (!cancelled) setOpen(false); });
    return () => { cancelled = true; };
  }, [bot.id, mayChange, state.botWizard]);
  if (!mayChange) return <span />;
  return (
    <button type="button" data-bot-wizard-redo={open ? "resume" : "redo"}
      onClick={() => dispatch({ type: "openBotWizard", botId: bot.id, ...(open ? {} : { redo: true }) })}
      className="ui-button min-h-[32px] gap-1.5 text-[12.5px] md:min-h-0">
      <Wand2 size={14} aria-hidden="true" />
      {open ? t("botWizard.panel.resume") : t("botWizard.panel.redo")}
      {open && <span className="rounded-full bg-warning/15 px-1.5 text-[11px] text-warning">{t("botWizard.panel.draft")}</span>}
    </button>
  );
}
