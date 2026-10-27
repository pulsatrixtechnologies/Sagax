// "Me joindre" on the bot's Overview (2026-10-26): how THIS bot reaches
// the person outside the app when a question or an approval waits on them,
// and when. Each person chooses for themself, no admin. Channels: phone
// notifications, a text message (their Perspicax Voice line, to their own
// verified number), their own Teams chat, their own Telegram bot; WhatsApp
// later. Hours: any time, or ranges of days and times in a time zone.
// No id on screen: the Telegram bot is named by its @username.
import { useState } from "react";

import { normalizePhone, type ReachChannelId, type ReachHoursRange, type ReachMeSettings } from "../../../shared/reach-me";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { connectReachTelegram, disconnectReachTelegram, localTimeZone, saveReachMe, useReachMe, type ReachMeView } from "@/lib/reach-me";
import type { LocaleKey } from "@/locales";
import { SettingsGroup, Switch } from "../SettingsPrimitives";

const CHANNELS: ReachChannelId[] = ["push", "sms", "teams", "telegram", "whatsapp"];
/** Monday first, as the week reads in French and English calendars here. */
const DAYS = [1, 2, 3, 4, 5, 6, 0];

const inputCls = "min-h-8 min-w-0 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink focus:border-focus";
const buttonCls = "rounded-lg border border-hairline/50 px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised disabled:opacity-40";

export type ReachMeActions = {
  onSave: (settings: ReachMeSettings) => Promise<{ ok: true } | { ok: false; error: string }>;
  onTelegramConnect: (token: string) => Promise<{ ok: true; link?: string } | { ok: false; error: string }>;
  onTelegramDisconnect: () => Promise<unknown>;
};

function channelHelp(id: ReachChannelId, view: ReachMeView): string {
  const status = view.channels[id];
  if (id === "push" && status.devices === 1) return t("botPanel.reachMe.push.deviceOne");
  if (id === "push") return status.devices ? t("botPanel.reachMe.push.devices", { count: String(status.devices) }) : t("botPanel.reachMe.push.none");
  return t(`botPanel.reachMe.${id}.help` as LocaleKey);
}

export function BotReachMeCard({ view, actions, initialTelegramLink }: { view: ReachMeView | null; actions: ReachMeActions; initialTelegramLink?: string }) {
  const [draft, setDraft] = useState<ReachMeSettings | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [telegramLink, setTelegramLink] = useState<string | undefined>(initialTelegramLink);
  const [telegramError, setTelegramError] = useState<string | undefined>();
  if (!view) return null;
  const current = draft ?? view.settings;
  const phone = number ?? current.smsNumber ?? "";
  const dirty = draft !== null || (number !== null && number !== (view.settings.smsNumber ?? ""));
  const change = (next: ReachMeSettings) => { setDraft(next); setError(undefined); };
  const toggle = (id: ReachChannelId, on: boolean) => change({ ...current, channels: on ? [...current.channels.filter((c) => c !== id), id] : current.channels.filter((c) => c !== id) });
  const ranges = current.hours.always ? [] : current.hours.ranges;
  const setRanges = (next: ReachHoursRange[]) => change({ ...current, hours: { always: false, timeZone: current.hours.always ? localTimeZone() : current.hours.timeZone, ranges: next } });
  const save = async () => {
    const smsNumber = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !smsNumber) { setError(t("botPanel.reachMe.sms.invalid")); return; }
    const next: ReachMeSettings = { ...current, ...(smsNumber ? { smsNumber } : {}) };
    if (!smsNumber) delete next.smsNumber;
    setBusy(true);
    const result = await actions.onSave(next);
    setBusy(false);
    if (result.ok) { setDraft(null); setNumber(null); } else setError(result.error);
  };
  const connect = async () => {
    setBusy(true);
    setTelegramError(undefined);
    const result = await actions.onTelegramConnect(token);
    setBusy(false);
    if (result.ok) { setToken(""); setTelegramLink(result.link); } else setTelegramError(result.error);
  };
  const telegram = view.channels.telegram;
  return (
    <div data-bot-reach-me="">
      <SettingsGroup title={t("botPanel.reachMe.label")} groupId="botReachMe">
        <p className="px-3.5 pb-1 pt-0.5 text-[12px] leading-4 text-ink-secondary">{t("botPanel.reachMe.help")}</p>
        {CHANNELS.map((id) => {
          const on = current.channels.includes(id);
          const later = id === "whatsapp";
          const status = view.channels[id];
          return (
            <div key={id} data-reach-channel={id} className="flex flex-col gap-1.5 px-3.5 py-2">
              <label className={cn("flex min-w-0 items-center justify-between gap-4 text-[13px] text-ink", later ? "cursor-not-allowed" : "cursor-pointer")}>
                <span className="min-w-0">
                  <span className="block leading-[18px]">{t(`botPanel.reachMe.${id}.label` as LocaleKey)}</span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-ink-secondary">{later ? t("botPanel.reachMe.whatsapp.later") : channelHelp(id, view)}</span>
                </span>
                <Switch checked={on && !later} disabled={later || busy} onClick={() => toggle(id, !on)} aria-label={t(`botPanel.reachMe.${id}.label` as LocaleKey)} />
              </label>
              {on && !later && !status.ready && status.reason && id !== "telegram" && (
                <p data-reach-not-ready="" title={status.reason} className="text-[12px] leading-4 text-warning">{t(`botPanel.reachMe.${id}.notReady` as LocaleKey)}</p>
              )}
              {on && id === "sms" && (
                <input className={inputCls} value={phone} inputMode="tel" autoComplete="tel" placeholder="+1 514 555 0123" aria-label={t("botPanel.reachMe.sms.number")} onChange={(event) => { setNumber(event.target.value); setError(undefined); }} />
              )}
              {on && id === "telegram" && (
                telegram.connected ? (
                  <div className="flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
                    <span data-reach-telegram-connected="">{t("botPanel.reachMe.telegram.connected", { name: `@${telegram.username ?? ""}` })}</span>
                    <button type="button" className={buttonCls} disabled={busy} onClick={() => void actions.onTelegramDisconnect()}>{t("botPanel.reachMe.telegram.disconnect")}</button>
                  </div>
                ) : telegramLink || telegram.linking ? (
                  <p data-reach-telegram-linking="" className="text-[12px] leading-4 text-ink-secondary">
                    {t("botPanel.reachMe.telegram.finish", { name: `@${telegram.username ?? ""}` })}{" "}
                    {telegramLink && <a className="text-accent-text underline" href={telegramLink} target="_blank" rel="noreferrer">{t("botPanel.reachMe.telegram.open")}</a>}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      <input className={cn(inputCls, "flex-1")} value={token} type="password" autoComplete="off" spellCheck={false} placeholder={t("botPanel.reachMe.telegram.tokenPlaceholder")} aria-label={t("botPanel.reachMe.telegram.token")} onChange={(event) => setToken(event.target.value)} />
                      <button type="button" className={buttonCls} disabled={busy || !token.trim()} onClick={() => void connect()}>{t("botPanel.reachMe.telegram.connect")}</button>
                    </div>
                    {telegramError && <p role="alert" className="text-[12px] leading-4 text-danger">{telegramError}</p>}
                  </div>
                )
              )}
            </div>
          );
        })}
        <div data-reach-hours="" className="flex flex-col gap-2 border-t-[0.5px] border-border px-3.5 py-2">
          <label className="flex min-w-0 items-center justify-between gap-4 text-[13px] text-ink">
            <span className="min-w-0">
              <span className="block leading-[18px]">{t("botPanel.reachMe.hours.label")}</span>
              <span className="mt-0.5 block text-[12px] leading-4 text-ink-secondary">{current.hours.always ? t("botPanel.reachMe.hours.always") : t("botPanel.reachMe.hours.ranges")}</span>
            </span>
            <Switch checked={!current.hours.always} disabled={busy} aria-label={t("botPanel.reachMe.hours.label")}
              onClick={() => current.hours.always ? setRanges([{ days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }]) : change({ ...current, hours: { always: true } })} />
          </label>
          {!current.hours.always && (
            <>
              <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
                <span className="shrink-0">{t("botPanel.reachMe.hours.timeZone")}</span>
                <input className={cn(inputCls, "flex-1")} value={current.hours.timeZone} spellCheck={false} onChange={(event) => change({ ...current, hours: { ...(current.hours as { always: false; timeZone: string; ranges: ReachHoursRange[] }), timeZone: event.target.value } })} />
              </label>
              {ranges.map((range, index) => (
                <div key={index} data-reach-range="" className="flex flex-wrap items-center gap-1.5">
                  {DAYS.map((day) => {
                    const on = range.days.includes(day);
                    return (
                      <button key={day} type="button" aria-pressed={on} disabled={busy}
                        className={cn("size-7 rounded-md text-[11px] font-medium", on ? "bg-accent text-accent-ink" : "border border-hairline/50 text-ink-secondary hover:bg-raised")}
                        onClick={() => setRanges(ranges.map((row, i) => i === index ? { ...row, days: on ? row.days.filter((d) => d !== day) : [...row.days, day].sort() } : row))}
                      >{t(`botPanel.reachMe.day.${day}` as LocaleKey)}</button>
                    );
                  })}
                  <input type="time" className={inputCls} value={range.start} aria-label={t("botPanel.reachMe.hours.start")} onChange={(event) => setRanges(ranges.map((row, i) => i === index ? { ...row, start: event.target.value } : row))} />
                  <span className="text-[12px] text-ink-secondary">{t("botPanel.reachMe.hours.to")}</span>
                  <input type="time" className={inputCls} value={range.end} aria-label={t("botPanel.reachMe.hours.end")} onChange={(event) => setRanges(ranges.map((row, i) => i === index ? { ...row, end: event.target.value } : row))} />
                  {ranges.length > 1 && <button type="button" className="text-[12px] text-ink-secondary hover:text-ink" onClick={() => setRanges(ranges.filter((_, i) => i !== index))}>{t("botPanel.reachMe.hours.remove")}</button>}
                </div>
              ))}
              <button type="button" className="self-start text-[12px] font-medium text-accent-text hover:underline" onClick={() => setRanges([...ranges, { days: [0, 6], start: "10:00", end: "16:00" }])}>{t("botPanel.reachMe.hours.add")}</button>
            </>
          )}
        </div>
        {error && <p role="alert" className="px-3.5 pb-1 text-[12px] leading-4 text-danger">{error}</p>}
        {dirty && (
          <div className="flex gap-2 px-3.5 py-2">
            <button type="button" data-reach-save="" disabled={busy} onClick={() => void save()} className={cn(buttonCls, "border-transparent bg-accent text-accent-ink hover:brightness-110")}>{t("botPanel.reachMe.save")}</button>
            <button type="button" disabled={busy} onClick={() => { setDraft(null); setNumber(null); setError(undefined); }} className={buttonCls}>{t("botPanel.reachMe.cancel")}</button>
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

export function BotReachMe({ botId }: { botId: string }) {
  const [view, setView] = useReachMe(botId);
  const actions: ReachMeActions = {
    onSave: async (settings) => {
      const result = await saveReachMe(botId, settings);
      if (!result.ok) return { ok: false, error: result.error };
      setView(result.view);
      return { ok: true };
    },
    onTelegramConnect: async (token) => {
      const result = await connectReachTelegram(botId, token);
      if (!result.ok) return { ok: false, error: result.error };
      setView(result.view);
      return { ok: true, ...(result.link ? { link: result.link } : {}) };
    },
    onTelegramDisconnect: async () => {
      const result = await disconnectReachTelegram(botId);
      if (result.ok) setView(result.view);
    },
  };
  return <BotReachMeCard view={view} actions={actions} />;
}
