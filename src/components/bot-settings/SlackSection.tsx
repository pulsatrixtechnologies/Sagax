// A deep link, nothing more: the bot's Slack app is created and managed in
// the organisation's Admin. Rendered only when the server offered a link
// (see useSlackManagementUrl), so there are no loading or error states here.
import { cn } from "@/lib/cn";
import { ExternalLink } from "lucide-react";

import { t } from "@/lib/i18n";
import { PILL } from "../SettingsPrimitives";

export function SlackSection({ managementUrl }: { managementUrl: string }) {
  return (
    <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-secondary">
      <p>{t("botSlack.body")}</p>
      <a
        href={managementUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(PILL, "w-fit gap-2")}
      >
        {t("botSlack.manage")} <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  );
}
