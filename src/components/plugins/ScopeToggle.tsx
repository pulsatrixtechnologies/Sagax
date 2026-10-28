// Connect apps: install for everyone (the workspace) or for one bot. Shown
// when a bot is in reach (src/lib/plugin-scope.ts); the bot scope lists the
// marketplace plugins and installs each whole on that bot. On My accounts
// (the person's own accounts, which serve all of their bots) it stays in its
// place turned off, so the title and the tabs never move between tabs.
import type { ReactNode } from "react";
import { Bot, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PluginScope } from "@/lib/plugin-scope";

export function ScopeToggle({ scope, botName, onScope, disabled = false, describedBy }: {
  scope: PluginScope;
  botName: string;
  onScope: (scope: PluginScope) => void;
  /** shown but not in use on this tab (My accounts) */
  disabled?: boolean;
  /** the id of the line that says why it is off */
  describedBy?: string;
}) {
  const option = (value: PluginScope, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={scope === value}
      disabled={disabled}
      data-plugins-scope-option={value}
      onClick={() => onScope(value)}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none disabled:cursor-default",
        scope === value
          ? disabled ? "bg-ink/10 text-ink-secondary" : "bg-accent text-accent-ink"
          : disabled ? "text-ink-tertiary" : "text-ink-secondary hover:bg-hover hover:text-ink",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label={t("connectApps.scope.aria")}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      data-plugins-scope={scope}
      data-plugins-scope-disabled={disabled ? "" : undefined}
      className="flex w-fit max-w-full items-center gap-0.5 rounded-full border border-border p-0.5"
    >
      {option("workspace", t("connectApps.scope.workspace"), <Users size={13} aria-hidden="true" />)}
      {option("bot", t("connectApps.scope.bot", { name: botName }), <Bot size={13} aria-hidden="true" />)}
    </div>
  );
}
