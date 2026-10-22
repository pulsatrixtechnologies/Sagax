// The bot's own email address on its profile (B21, 2026-10-21): the
// address the Perspicax relay gave it, a Copy button, the one rule (mail
// only wakes a routine), and the administrator's off state. Nothing at all
// when no address is available (solo server, older Perspicax, inbound mail
// off). The address is not an id: it is shown as is.
import { Check, Copy } from "lucide-react";

import { useBotInboundMail, type BotInboundMail } from "@/lib/bot-inbound-mail";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { SettingsGroup } from "../SettingsPrimitives";

export function BotEmailAddressCard({ mail }: { mail: BotInboundMail | null }) {
  const address = mail?.available ? mail.address : null;
  const { state, copy } = useCopyFeedback(address ?? "");
  if (!mail || !address) return null;
  const copyLabel = t("botPanel.email.copy");
  return (
    <div data-bot-email-address="">
      <SettingsGroup title={t("botPanel.email.label")} groupId="botEmail">
        <div className="flex min-w-0 items-center gap-3 px-3.5 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink" data-bot-email-value="">{address}</span>
          <button
            type="button"
            onClick={copy}
            aria-label={copyLabel}
            title={copyLabel}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
          >
            {state === "copied" ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>
        </div>
        <p className="px-3.5 pb-2 text-[12px] leading-4 text-ink-secondary">{t("botPanel.email.help")}</p>
        {!mail.enabled && <p data-bot-email-off="" className="px-3.5 pb-2 text-[12px] leading-4 text-warning">{t("botPanel.email.disabled")}</p>}
      </SettingsGroup>
    </div>
  );
}

export function BotEmailAddress({ botId }: { botId: string }) {
  return <BotEmailAddressCard mail={useBotInboundMail(botId)} />;
}
