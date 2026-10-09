// Connect apps: install for everyone (the workspace) or for one bot. Shown
// when a bot is in reach (src/lib/plugin-scope.ts); the bot scope lists the
// marketplace plugins and installs each whole on that bot.
import type { ReactNode } from "react";
import { Bot, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PluginScope } from "@/lib/plugin-scope";

export function ScopeToggle({ scope, botName, onScope }: { scope: PluginScope; botName: string; onScope: (scope: PluginScope) => void }) {
  const option = (value: PluginScope, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={scope === value}
      data-plugins-scope-option={value}
      onClick={() => onScope(value)}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors",
        scope === value ? "bg-accent text-accent-ink" : "text-ink-secondary hover:bg-hover hover:text-ink",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <div role="radiogroup" aria-label={t("connectApps.scope.aria")} data-plugins-scope={scope} className="flex w-fit max-w-full items-center gap-0.5 rounded-full border border-border p-0.5">
      {option("workspace", t("connectApps.scope.workspace"), <Users size={13} aria-hidden="true" />)}
      {option("bot", t("connectApps.scope.bot", { name: botName }), <Bot size={13} aria-hidden="true" />)}
    </div>
  );
}
