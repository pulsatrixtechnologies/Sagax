// The persona editor's Overview header: the mascot (its editor on click),
// name, label and short description edited in place, a summary of the
// engine, model, owner and sharing, and the quick actions (Rename, Put on
// the desktop, Make primary bot, Archive). Every write goes through the
// existing paths: the bot patch queue, the floating-bots store, POST
// /api/bots/:id/primary and PATCH hidden.
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Archive, Pencil, PictureInPicture2, Star } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { canEditBotField, showBotArchive, showBotRename } from "@/lib/bot-capabilities";
import { archiveBlockReason, primaryBotOffer, requestBotHidden, requestPrimaryBot } from "@/lib/bot-quick-actions";
import { isViewersPrimaryBot, viewerOwnsBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { botEngine } from "@/lib/failed-turn";
import { isBotFloating, subscribeFloatingBots, toggleFloatingBot } from "@/lib/floating-bots";
import { useOrgPeople } from "@/lib/perspicax-org";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { BotProfileAvatarCard } from "../BotProfileAvatarCard";
import { InlineEditableText } from "../bot-settings/InlineEditableText";
import { inputCls } from "../bot-settings/field";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";

/** "Model" in the summary: Auto, or the engine's label for the model, with
 * the effort when one is set. */
export function personaModelSummary(bot: Bot, engine: ReturnType<typeof botEngine>): string {
  if (bot.modelSelection.auto) return t("persona.overview.modelAuto");
  const label = engine?.models.options.find((option) => option.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;
  return bot.modelSelection.effort ? `${label} · ${bot.modelSelection.effort}` : label;
}

/** "Sharing" in the summary: the grants when there are any, else who may
 * see it, else not shared. */
export function personaSharingSummary(bot: Bot): string {
  const grants = bot.grants?.length ?? bot.directGrants?.length ?? 0;
  if (grants > 0) return t("persona.overview.sharedCount", { count: String(grants) });
  if (bot.visibility === "everyone") return t("botSettings.visibility.everyone");
  if (bot.visibility === "admins") return t("botSettings.visibility.admins");
  if (bot.visibility && typeof bot.visibility === "object") return t("botSettings.visibility.people");
  return t("botSettings.sharing.empty");
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] leading-4 text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] leading-5 text-ink">{children}</dd>
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, reason, id }: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string;
  id: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        data-persona-action={id}
        onClick={onClick}
        disabled={disabled}
        title={reason}
        className={cn(
          "flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[13px] text-ink",
          disabled ? "cursor-default opacity-50" : "hover:bg-raised-hover",
        )}
      >
        {icon}
        {label}
      </button>
      {disabled && reason && <span data-persona-action-reason={id} className="mt-1 max-w-[220px] text-[11.5px] leading-4 text-ink-secondary">{reason}</span>}
    </div>
  );
}

export function PersonaOverview({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [renameRequest, setRenameRequest] = useState(0);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const floating = useSyncExternalStore(subscribeFloatingBots, () => isBotFloating(bot.id), () => false);
  const people = useOrgPeople();
  const viewerId = viewerActorId(state.config);
  const engine = botEngine(bot, state.instances);
  const canRename = showBotRename(state.config, bot);
  const canDescribe = canEditBotField(state.config, bot, "description");
  const primary = primaryBotOffer(state.config, bot);
  const isPrimary = isViewersPrimaryBot(bot, viewerId);
  const archiveAllowed = showBotArchive(state.config);
  const archiveBlocked = archiveBlockReason(state.bots, bot);
  const owner = viewerOwnsBot(bot, viewerId)
    ? t("persona.overview.ownerYou")
    : (() => {
      const person = people.get(bot.ownerUserId?.trim().toLowerCase() ?? "");
      return person?.name || person?.login || bot.ownerUserId || "";
    })();
  const fail = (cause: unknown) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });

  const makePrimary = () => {
    if (!primary.allowed || busy) return;
    setBusy(true);
    void requestPrimaryBot(bot.id)
      .then((next) => dispatch({ type: "botPatched", bot: next }))
      .catch(fail)
      .finally(() => setBusy(false));
  };
  const archive = () => {
    if (busy || archiveBlocked) return;
    setBusy(true);
    const next = state.bots.find((candidate) => !candidate.hidden && candidate.id !== bot.id);
    void requestBotHidden(bot.id, true)
      .then((archived) => {
        dispatch({ type: "botPatched", bot: archived });
        if (state.selectedId === bot.id && next) dispatch({ type: "select", id: next.id });
        onClose();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-5" data-persona-overview="">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="-mt-6 shrink-0">
          <BotProfileAvatarCard bot={bot} activeState={derived.activeState} mascotMotion={derived.mascotMotion} onPatch={derived.patch} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1 sm:items-start sm:pt-4">
          <InlineEditableText
            value={bot.name}
            required
            maxLength={BOT_PROFILE_LIMITS.name}
            ariaLabel={t("botPanel.name.edit")}
            onSave={canRename ? (name) => derived.patch({ name }) : undefined}
            editRequest={renameRequest}
            className="text-[19px] font-semibold leading-7 text-ink"
          />
          <InlineEditableText
            value={bot.title}
            maxLength={BOT_PROFILE_LIMITS.title}
            placeholder={t("botPanel.label.add")}
            ariaLabel={t("botPanel.label.edit")}
            onSave={canEditBotField(state.config, bot, "title") ? (title) => derived.patch({ title }) : undefined}
            muted
            className="text-[13px] leading-5"
          />
          {isPrimary && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11.5px] text-ink-secondary">
              <Star size={11} aria-hidden="true" className="text-accent" /> {t("primaryBot.badge")}
            </span>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={`persona-description-${bot.id}`} className="mb-1.5 block text-[13px] text-ink-secondary">{t("persona.overview.description")}</label>
        {canDescribe ? (
          <textarea
            id={`persona-description-${bot.id}`}
            className={cn(inputCls, "min-h-[64px] resize-y leading-relaxed")}
            maxLength={BOT_PROFILE_LIMITS.description}
            placeholder={t("botPanel.identity.blurbPlaceholder")}
            value={bot.description}
            onChange={(event) => derived.patch({ description: event.target.value })}
          />
        ) : (
          <p id={`persona-description-${bot.id}`} className="text-[13px] leading-relaxed text-ink">
            {bot.description.trim() || <span className="text-ink-secondary">{t("persona.overview.noDescription")}</span>}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-hover p-3 sm:grid-cols-4">
        <Fact label={t("persona.overview.engine")}>{engine?.displayName ?? bot.modelSelection.instanceId}</Fact>
        <Fact label={t("persona.overview.model")}>{personaModelSummary(bot, engine)}</Fact>
        <Fact label={t("persona.overview.owner")}>{owner}</Fact>
        <Fact label={t("persona.overview.sharing")}>{personaSharingSummary(bot)}</Fact>
      </dl>

      <div>
        <div className="mb-2 text-[13px] text-ink-secondary">{t("persona.overview.actions")}</div>
        <div className="flex flex-wrap items-start gap-2">
          <ActionButton
            id="rename"
            icon={<Pencil size={14} />}
            label={t("persona.action.rename")}
            onClick={() => setRenameRequest((count) => count + 1)}
            disabled={!canRename}
            reason={canRename ? undefined : t("persona.locked.owner")}
          />
          <ActionButton
            id={floating ? "remove-from-desktop" : "put-on-desktop"}
            icon={<PictureInPicture2 size={14} />}
            label={floating ? t("floatingBots.menu.unfloat") : t("floatingBots.menu.float")}
            onClick={() => toggleFloatingBot(bot.id)}
          />
          <ActionButton
            id="make-primary"
            icon={<Star size={14} />}
            label={t("sidebar.bot.makePrimary")}
            onClick={makePrimary}
            disabled={!primary.allowed || busy}
            reason={primary.allowed ? undefined : t(primary.reason)}
          />
          {archiveAllowed && !confirmArchive && (
            <ActionButton
              id="archive"
              icon={<Archive size={14} />}
              label={t("sidebar.bot.archive")}
              onClick={() => setConfirmArchive(true)}
              disabled={archiveBlocked !== null || busy}
              reason={archiveBlocked ? t(archiveBlocked) : undefined}
            />
          )}
        </div>
        {/* Archive asks here, in the pane: no dialog over the modal. */}
        {confirmArchive && (
          <div role="group" data-persona-archive-confirm="" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-hover p-3 text-[13px] text-ink">
            <span className="min-w-0 flex-1">{t("sidebar.confirm.archiveBody", { name: bot.name })}</span>
            <button type="button" onClick={() => setConfirmArchive(false)} className="rounded-lg px-3 py-1.5 text-ink-secondary hover:bg-control hover:text-ink">
              {t("common.cancel")}
            </button>
            <button type="button" onClick={archive} disabled={busy} className="rounded-lg bg-control px-3 py-1.5 text-ink hover:bg-raised-hover disabled:opacity-50">
              {t("sidebar.bot.archive")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
