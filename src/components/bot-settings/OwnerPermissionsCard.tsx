// The owner's own permissions for a bot (2026-10-14, JC): the bot's
// permission mode (Approval, Automatic approval, Bypass) and the owner's
// rules, a two-column Action / Behavior table like Grok Bot's, each row a
// plain-language rule with edit and delete. Spec:
// docs/superpowers/specs/2026-10-14-bot-owner-permissions.md.
//
// Only the bot's owner sees it: the server keeps both to them
// (GET/PUT /api/bots/:id/permission-mode, /api/approval-rules).
import { useCallback, useEffect, useState } from "react";
import { Pencil, ShieldAlert, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, type Bot } from "@/state/store";
import { ConfirmDialog } from "../ConfirmDialog";
import { PaneEmpty, PaneSection } from "./PaneSection";

export type BotPermissionMode = "approval" | "auto" | "bypass";
export type RuleBehavior = "allow" | "ask" | "deny";

export interface OwnerRuleRow {
  id: string;
  botId: string | null;
  tool: string;
  scope: Record<string, string>;
  destructive?: "delete" | "bulk" | "external-message";
  behavior: RuleBehavior;
  description: string;
  legacy?: true;
}

const MODES: ReadonlyArray<{ id: BotPermissionMode; label: LocaleKey; help: LocaleKey }> = [
  { id: "approval", label: "botPanel.permissionMode.approval", help: "botPanel.permissionMode.approvalHelp" },
  { id: "auto", label: "botPanel.permissionMode.auto", help: "botPanel.permissionMode.autoHelp" },
  { id: "bypass", label: "botPanel.permissionMode.bypass", help: "botPanel.permissionMode.bypassHelp" },
];

export const BEHAVIOR_LABEL: Record<RuleBehavior, LocaleKey> = {
  allow: "botPanel.rules.allow",
  ask: "botPanel.rules.ask",
  deny: "botPanel.rules.deny",
};

const KIND_LABEL: Record<NonNullable<OwnerRuleRow["destructive"]>, LocaleKey> = {
  delete: "botPanel.rules.kind.delete",
  bulk: "botPanel.rules.kind.bulk",
  "external-message": "botPanel.rules.kind.externalMessage",
};

/** Rules this bot meets: its own first, then the ones for all my bots. */
export function rulesForBot(rules: readonly OwnerRuleRow[], botId: string): OwnerRuleRow[] {
  return rules
    .filter((rule) => rule.botId === botId || rule.botId === null)
    .sort((a, b) => Number(a.botId === null) - Number(b.botId === null) || a.description.localeCompare(b.description));
}

const LONG_TEXT = 110;

function RuleText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LONG_TEXT;
  return (
    <div className="min-w-0">
      <span className={cn("break-words text-[13px] text-ink", !open && long && "line-clamp-2")}>{text}</span>
      {long && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="block text-[12px] text-accent hover:underline">
          {open ? t("botPanel.rules.showLess") : t("botPanel.rules.showMore")}
        </button>
      )}
    </div>
  );
}

function RuleEditor({ rule, botId, onCancel, onSave }: {
  rule: OwnerRuleRow;
  botId: string;
  onCancel: () => void;
  onSave: (patch: { behavior: RuleBehavior; description: string; botId: string | null; anyTarget: boolean }) => void;
}) {
  const [behavior, setBehavior] = useState<RuleBehavior>(rule.behavior);
  const [description, setDescription] = useState(rule.description);
  const [allBots, setAllBots] = useState(rule.botId === null);
  const [anyTarget, setAnyTarget] = useState(false);
  const scoped = Object.keys(rule.scope).length > 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-inset px-3 py-2.5" data-rule-editor={rule.id}>
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
        {t("botPanel.rules.description")}
        <textarea
          value={description}
          maxLength={500}
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded-md bg-raised px-2 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-[12.5px] text-ink-secondary">
        {t("botPanel.rules.behavior")}
        <select
          value={behavior}
          onChange={(event) => setBehavior(event.target.value as RuleBehavior)}
          className="rounded-md bg-raised px-2 py-1 text-[13px] text-ink"
        >
          {(["allow", "ask", "deny"] as const).map((value) => <option key={value} value={value}>{t(BEHAVIOR_LABEL[value])}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3 text-[12.5px] text-ink-secondary">
        {t("botPanel.rules.appliesTo")}
        <select
          value={allBots ? "all" : "this"}
          onChange={(event) => setAllBots(event.target.value === "all")}
          className="rounded-md bg-raised px-2 py-1 text-[13px] text-ink"
        >
          <option value="this">{t("botPanel.rules.thisBot")}</option>
          <option value="all">{t("botPanel.rules.allBots")}</option>
        </select>
      </label>
      {scoped && !rule.legacy && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <input type="checkbox" checked={anyTarget} onChange={(event) => setAnyTarget(event.target.checked)} />
          {t("botPanel.rules.anyTarget")}
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-control">
          {t("botPanel.rules.cancel")}
        </button>
        <button
          type="button"
          onClick={() => onSave({ behavior, description, botId: allBots ? null : botId, anyTarget })}
          className="rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-accent-ink hover:brightness-110"
        >
          {t("botPanel.rules.save")}
        </button>
      </div>
    </div>
  );
}

export function OwnerPermissionsCard({ bot }: { bot: Pick<Bot, "id" | "name"> }) {
  const [mode, setMode] = useState<BotPermissionMode | null>(null);
  const [canBypass, setCanBypass] = useState(false);
  const [rules, setRules] = useState<OwnerRuleRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmBypass, setConfirmBypass] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRules = useCallback(() => api<{ rules: OwnerRuleRow[] }>(`/api/approval-rules?botId=${encodeURIComponent(bot.id)}`)
    .then((body) => setRules(rulesForBot(body.rules ?? [], bot.id)))
    .catch(() => setRules([])), [bot.id]);

  useEffect(() => {
    let alive = true;
    setMode(null);
    setEditing(null);
    void api<{ mode: BotPermissionMode; canBypass: boolean }>(`/api/bots/${bot.id}/permission-mode`)
      .then((body) => {
        if (!alive) return;
        setMode(body.mode);
        setCanBypass(body.canBypass === true);
      })
      .catch(() => {});
    void loadRules();
    return () => {
      alive = false;
    };
  }, [bot.id, loadRules]);

  const saveMode = (next: BotPermissionMode, confirmed = false) => {
    setError(null);
    void api<{ mode: BotPermissionMode; canBypass: boolean }>(`/api/bots/${bot.id}/permission-mode`, {
      method: "PUT",
      body: JSON.stringify({ mode: next, ...(confirmed ? { confirmBypass: true } : {}) }),
    })
      .then((body) => {
        setMode(body.mode);
        setCanBypass(body.canBypass === true);
      })
      .catch((failure: unknown) => setError(t("botPanel.permissionMode.error", { error: failure instanceof Error ? failure.message : String(failure) })));
  };

  const choose = (next: BotPermissionMode) => {
    if (next === mode) return;
    if (next === "bypass") {
      setConfirmBypass(true);
      return;
    }
    saveMode(next);
  };

  const saveRule = (rule: OwnerRuleRow, patch: { behavior: RuleBehavior; description: string; botId: string | null; anyTarget: boolean }) => {
    setError(null);
    void api(`/api/approval-rules/${rule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ behavior: patch.behavior, description: patch.description, botId: patch.botId, ...(patch.anyTarget ? { anyTarget: true } : {}) }),
    })
      .then(() => {
        setEditing(null);
        return loadRules();
      })
      .catch((failure: unknown) => setError(t("botPanel.rules.error", { error: failure instanceof Error ? failure.message : String(failure) })));
  };

  const removeRule = (rule: OwnerRuleRow) => {
    setError(null);
    void api(`/api/approval-rules/${rule.id}`, { method: "DELETE" })
      .then(() => loadRules())
      .catch((failure: unknown) => setError(t("botPanel.rules.error", { error: failure instanceof Error ? failure.message : String(failure) })));
  };

  if (mode === null) return null;

  return (
    <>
      <PaneSection title={t("botPanel.permissionMode.title")} help={t("botPanel.permissionMode.help")} data-permission-mode={mode}>
        <div className="flex gap-1 rounded-lg bg-inset p-0.5" role="radiogroup" aria-label={t("botPanel.permissionMode.title")}>
          {MODES.map((option) => {
            const disabled = option.id === "bypass" && !canBypass && mode !== "bypass";
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={mode === option.id}
                disabled={disabled}
                title={disabled ? t("botPanel.permissionMode.bypassUnavailable") : t(option.help)}
                onClick={() => choose(option.id)}
                className={cn(
                  "flex-1 rounded-md px-2.5 py-1.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40",
                  mode === option.id ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink",
                )}
              >
                {t(option.label)}
              </button>
            );
          })}
        </div>
        <p className={cn("mt-2 flex items-start gap-1.5 text-[12.5px]", mode === "bypass" ? "text-warning" : "text-ink-secondary")}>
          {mode === "bypass" && <ShieldAlert size={14} className="mt-0.5 shrink-0" />}
          {t(MODES.find((option) => option.id === mode)!.help)}
        </p>
      </PaneSection>

      <PaneSection title={t("botPanel.rules.title")} help={t("botPanel.rules.help")} data-owner-rules={String(rules.length)}>
        {rules.length === 0 ? (
          <PaneEmpty>{t("botPanel.rules.empty")}</PaneEmpty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-hairline/40">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-hairline/40 bg-inset px-3 py-1.5 text-[12px] font-medium text-ink-secondary">
              <span>{t("botPanel.rules.action")}</span>
              <span>{t("botPanel.rules.behavior")}</span>
              <span className="sr-only">{t("botPanel.rules.edit")}</span>
            </div>
            <div className="divide-y divide-hairline/40">
              {rules.map((rule) => (
                <div key={rule.id} className="px-3 py-2" data-owner-rule-row={rule.behavior}>
                  {editing === rule.id ? (
                    <RuleEditor rule={rule} botId={bot.id} onCancel={() => setEditing(null)} onSave={(patch) => saveRule(rule, patch)} />
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3">
                      <div className="min-w-0">
                        <RuleText text={rule.description} />
                        <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11.5px] text-ink-tertiary">
                          {rule.botId === null && <span>{t("botPanel.rules.allBots")}</span>}
                          {rule.destructive && <span className="text-warning">{t(KIND_LABEL[rule.destructive])}</span>}
                          {rule.legacy && <span>{t("botPanel.rules.migrated")}</span>}
                        </div>
                      </div>
                      <span className={cn("whitespace-nowrap text-[12.5px]", rule.behavior === "deny" ? "text-danger" : rule.behavior === "allow" ? "text-success" : "text-ink-secondary")}>
                        {t(BEHAVIOR_LABEL[rule.behavior])}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={t("botPanel.rules.edit")}
                          title={t("botPanel.rules.edit")}
                          onClick={() => setEditing(rule.id)}
                          className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("botPanel.rules.remove")}
                          title={t("botPanel.rules.remove")}
                          onClick={() => removeRule(rule)}
                          className="rounded-md p-1 text-ink-secondary hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
      </PaneSection>

      <ConfirmDialog
        open={confirmBypass}
        title={t("botPanel.permissionMode.bypassWarnTitle", { name: bot.name })}
        body={t("botPanel.permissionMode.bypassWarnBody", { name: bot.name })}
        confirmLabel={t("botPanel.permissionMode.bypassConfirm")}
        tone="danger"
        icon={<ShieldAlert size={18} />}
        onCancel={() => setConfirmBypass(false)}
        onConfirm={() => {
          setConfirmBypass(false);
          saveMode("bypass", true);
        }}
      />
    </>
  );
}
