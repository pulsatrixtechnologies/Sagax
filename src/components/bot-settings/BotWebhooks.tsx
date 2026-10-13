// Persona > Access > Webhooks: this bot's webhooks, created and managed
// where the bot is, with the Automations panel's own pieces (WebhookEditor,
// useWebhookActions, terminalCommand). Same rules as there: the full token
// and its command show once, in memory only, after create, regenerate or
// reveal; afterwards the last 4 characters and Regenerate. Only the bot's
// owner (or an admin, or solo) manages them; anyone else reads the list.
import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, Pause, Play, Plus, RotateCw, Trash2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly } from "@/lib/viewer";
import type { WebhookTrigger } from "@/lib/webhooks";
import { WebhookEditor, maskedToken, statusFor, terminalCommand, useWebhookActions } from "../WebhooksPanel";
import { PaneEmpty, PaneSection } from "./PaneSection";

const iconButton = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40";

/** The bot's owner manages its webhooks: solo, an admin or the owner. */
export function canManageBotWebhooks(config: Parameters<typeof viewerOwnsBot>[0], bot: Pick<Bot, "ownerUserId">): boolean {
  return !viewerBotsReadOnly(config) && viewerOwnsBot(config, bot);
}

export function BotWebhooks({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const webhooks = state.webhooks.filter((webhook) => webhook.botId === bot.id);
  const manage = canManageBotWebhooks(state.config, bot);
  const { credentials, setCredentials, working, copiedId, copiedKind, error, invoke, createAndCopyCommand } = useWebhookActions();
  const [editor, setEditor] = useState<WebhookTrigger | "new" | null>(null);
  const receiverDown = state.webhookIngress !== null && !state.webhookIngress.available;

  return (
    <PaneSection
      data-bot-webhooks=""
      title={t("botPanel.access.webhooks")}
      help={t("botPanel.access.webhooksHelp")}
      action={manage && (
        <button
          type="button"
          data-new-webhook=""
          onClick={() => setEditor("new")}
          className="flex items-center gap-1.5 rounded-lg bg-control px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-raised-hover"
        >
          <Plus size={13} aria-hidden="true" />
          {t("botWebhooks.new")}
        </button>
      )}
    >
      {receiverDown && <p role="alert" className="mb-2 text-[12px] text-danger">{t("botWebhooks.receiverDown")}</p>}
      {error && <p role="alert" className="mb-2 text-[12px] text-danger">{error}</p>}
      {webhooks.length === 0 ? (
        <PaneEmpty>{t("botPanel.access.noWebhooks")}</PaneEmpty>
      ) : (
        <ul className="divide-y divide-hairline/40 overflow-hidden rounded-lg border border-hairline/40">
          {webhooks.map((webhook) => {
            const status = statusFor(webhook);
            const credential = credentials[webhook.id];
            const busy = working !== null && working.startsWith(`${webhook.id}:`);
            const copied = (kind: "command" | "token") => copiedId === webhook.id && copiedKind === kind;
            return (
              <li key={webhook.id} data-bot-webhook={webhook.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {manage ? (
                    <button
                      type="button"
                      onClick={() => setEditor(webhook)}
                      title={t("botWebhooks.edit")}
                      className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline"
                    >
                      {webhook.name}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{webhook.name}</span>
                  )}
                  <span className={cn("flex shrink-0 items-center gap-1.5 text-[11.5px]", status.tone)}>
                    <span className={cn("size-1.5 rounded-full", status.dot)} aria-hidden="true" />
                    {status.label}
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-secondary">
                    {t("botPanel.access.deliveries", { count: String(webhook.deliveryCount) })}
                  </span>
                  {manage && (
                    <span className="flex shrink-0 items-center">
                      {!webhook.verificationPending && (
                        <button
                          type="button"
                          disabled={Boolean(working)}
                          onClick={() => void invoke(webhook, "toggle")}
                          aria-label={webhook.enabled ? t("botWebhooks.pause", { name: webhook.name }) : t("botWebhooks.resume", { name: webhook.name })}
                          title={webhook.enabled ? t("botWebhooks.pauseShort") : t("botWebhooks.resumeShort")}
                          className={iconButton}
                        >
                          {webhook.enabled ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={Boolean(working) || receiverDown}
                        onClick={() => void createAndCopyCommand(webhook, !webhook.tokenPending)}
                        aria-label={webhook.tokenPending ? t("botWebhooks.reveal", { name: webhook.name }) : t("botWebhooks.rotate", { name: webhook.name })}
                        title={webhook.tokenPending ? t("botWebhooks.revealShort") : t("botWebhooks.rotateShort")}
                        className={iconButton}
                      >
                        {busy && working === `${webhook.id}:command` ? <Loader2 size={14} className="animate-spin" /> : webhook.tokenPending ? <KeyRound size={14} /> : <RotateCw size={14} />}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(working)}
                        onClick={() => void invoke(webhook, "delete")}
                        aria-label={t("botWebhooks.delete", { name: webhook.name })}
                        title={t("botWebhooks.deleteShort")}
                        className={cn(iconButton, "hover:bg-danger/10 hover:text-danger")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  )}
                </div>
                {credential ? (
                  <div data-webhook-credential="" className="mt-2 overflow-hidden rounded-lg border border-hairline/40 bg-inset">
                    <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">{terminalCommand(credential)}</pre>
                    <div className="flex flex-wrap items-center gap-1 border-t border-hairline/40 px-2 py-1.5">
                      <button type="button" onClick={() => void createAndCopyCommand(webhook)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-ink-secondary hover:bg-raised hover:text-ink">
                        {copied("command") ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                        {copied("command") ? t("botWebhooks.copied") : t("botWebhooks.copyCommand")}
                      </button>
                      <button type="button" onClick={() => void createAndCopyCommand(webhook, false, "token")} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-ink-secondary hover:bg-raised hover:text-ink">
                        {copied("token") ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                        {copied("token") ? t("botWebhooks.copied") : t("botWebhooks.copyToken")}
                      </button>
                      <span className="ml-auto px-1 text-[11px] text-warning">{t("botWebhooks.once")}</span>
                    </div>
                  </div>
                ) : webhook.tokenPending ? (
                  <p className="mt-1 text-[11.5px] text-warning">{t("botWebhooks.needsToken")}</p>
                ) : webhook.tokenLast4 ? (
                  <p className="mt-0.5 font-mono text-[11px] text-ink-tertiary">{maskedToken(webhook)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editor && (
        <WebhookEditor
          webhook={editor === "new" ? undefined : editor}
          bots={[bot]}
          onClose={() => setEditor(null)}
          onCredential={(credential, webhookId) => setCredentials((current) => ({ ...current, [webhookId]: credential }))}
        />
      )}
    </PaneSection>
  );
}
