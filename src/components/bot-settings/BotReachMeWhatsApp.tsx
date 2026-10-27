// "Me joindre" by WhatsApp on the bot's Overview (2026-10-27): the person
// connects their own WhatsApp Business number (access token and Phone
// Number ID from their Meta app, the app secret for replies), proves their
// own number by a code, sets the message template used outside WhatsApp's
// 24 hour window, and copies the webhook settings for their Meta app. No
// admin. Never a token, an app secret or an id on screen: the webhook's
// address and verify token are behind Copy buttons.
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { ReachChannelView, ReachWhatsAppStep } from "@/lib/reach-me";
import type { LocaleKey } from "@/locales";

const inputCls = "min-h-8 min-w-0 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink focus:border-focus";
const buttonCls = "rounded-lg border border-hairline/50 px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised disabled:opacity-40";
const noteCls = "text-[12px] leading-4 text-ink-secondary";

/** Meta's answer about the template, in the person's words, with what to do. */
function templateLine(status: ReachChannelView): { text: string; ok: boolean } | null {
  const check = status.templateCheck;
  if (!check || !status.templateName) return null;
  const params = {
    name: status.templateName, language: check.language, languages: (check.languages ?? []).join(", "),
    status: check.status ?? "", count: String(check.parameters ?? 0),
  };
  return { text: t(`botPanel.reachMe.whatsapp.check.${check.state}` as LocaleKey, params), ok: check.state === "approved" };
}

export type ReachWhatsAppAction = (step: ReachWhatsAppStep) => Promise<{ ok: true } | { ok: false; error: string }>;

function CopyRow({ label, value, name }: { label: string; value: string; name: string }) {
  const { state, copy } = useCopyFeedback(value);
  const copyLabel = t("botPanel.reachMe.whatsapp.copy", { name: label });
  return (
    <div data-reach-whatsapp-copy={name} className="flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
      <span className="min-w-0 truncate">{label}</span>
      <button type="button" onClick={copy} aria-label={copyLabel} title={copyLabel} className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink">
        {state === "copied" ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

export function ReachWhatsAppSetup({ status, busy, act }: { status: ReachChannelView; busy: boolean; act?: ReachWhatsAppAction }) {
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateLanguage, setTemplateLanguage] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [working, setWorking] = useState(false);
  const disabled = busy || working || !act;
  const run = async (step: ReachWhatsAppStep, after?: () => void) => {
    if (!act) return;
    setWorking(true);
    setError(undefined);
    const result = await act(step);
    setWorking(false);
    if (result.ok) after?.(); else setError(result.error);
  };
  const name = templateName ?? status.templateName ?? "";
  const language = templateLanguage ?? status.templateLanguage ?? "";
  const templateDirty = (templateName !== null && templateName !== (status.templateName ?? "")) || (templateLanguage !== null && templateLanguage !== (status.templateLanguage ?? ""));
  const errorLine = error && <p role="alert" className="text-[12px] leading-4 text-danger">{error}</p>;

  // Not connected yet: the person's own Meta app credentials.
  if (!status.displayNumber) {
    return (
      <div data-reach-whatsapp-connect="" className="flex flex-col gap-1.5">
        <input className={inputCls} value={accessToken} type="password" autoComplete="off" spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.tokenPlaceholder")} aria-label={t("botPanel.reachMe.whatsapp.token")} onChange={(event) => setAccessToken(event.target.value)} />
        <input className={inputCls} value={phoneNumberId} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.phoneNumberIdPlaceholder")} aria-label={t("botPanel.reachMe.whatsapp.phoneNumberId")} onChange={(event) => setPhoneNumberId(event.target.value)} />
        <input className={inputCls} value={appSecret} type="password" autoComplete="off" spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.appSecretPlaceholder")} aria-label={t("botPanel.reachMe.whatsapp.appSecret")} onChange={(event) => setAppSecret(event.target.value)} />
        <div className="flex gap-2">
          <input className={cn(inputCls, "flex-1")} value={name} spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.templatePlaceholder")} aria-label={t("botPanel.reachMe.whatsapp.template")} onChange={(event) => setTemplateName(event.target.value)} />
          <input className={cn(inputCls, "w-20")} value={language} spellCheck={false} placeholder="fr" aria-label={t("botPanel.reachMe.whatsapp.templateLanguage")} onChange={(event) => setTemplateLanguage(event.target.value)} />
        </div>
        <input className={inputCls} value={businessAccountId} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.businessAccountPlaceholder")} aria-label={t("botPanel.reachMe.whatsapp.businessAccount")} onChange={(event) => setBusinessAccountId(event.target.value)} />
        <p className={noteCls}>{t("botPanel.reachMe.whatsapp.templateHelp")}</p>
        <div className="flex justify-end">
          <button type="button" className={buttonCls} disabled={disabled || !accessToken.trim() || !phoneNumberId.trim()}
            onClick={() => void run({ kind: "connect", accessToken, phoneNumberId, ...(appSecret.trim() ? { appSecret } : {}), ...(name.trim() ? { templateName: name } : {}), ...(language.trim() ? { templateLanguage: language } : {}), ...(businessAccountId.trim() ? { businessAccountId } : {}) },
              () => { setAccessToken(""); setAppSecret(""); setBusinessAccountId(""); setTemplateName(null); setTemplateLanguage(null); })}
          >{t("botPanel.reachMe.whatsapp.connect")}</button>
        </div>
        {errorLine}
      </div>
    );
  }

  const check = templateLine(status);
  const business = status.verifiedName ? `${status.verifiedName} (${status.displayNumber})` : status.displayNumber;
  return (
    <div data-reach-whatsapp-setup="" className="flex flex-col gap-2">
      {status.connected ? (
        <div className="flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
          <span data-reach-whatsapp-connected="">{t("botPanel.reachMe.whatsapp.connected", { name: business, number: status.number ?? "" })}</span>
          <button type="button" className={buttonCls} disabled={disabled} onClick={() => void run({ kind: "disconnect" })}>{t("botPanel.reachMe.whatsapp.disconnect")}</button>
        </div>
      ) : (
        <div data-reach-whatsapp-linking="" className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className={noteCls}>{t("botPanel.reachMe.whatsapp.business", { name: business })}</p>
            <button type="button" className={buttonCls} disabled={disabled} onClick={() => void run({ kind: "disconnect" })}>{t("botPanel.reachMe.whatsapp.disconnect")}</button>
          </div>
          {status.linkUrl && status.linkCode && (
            <p className={noteCls}>
              {t("botPanel.reachMe.whatsapp.sendCode", { code: `SAGAX ${status.linkCode}` })}{" "}
              <a className="text-accent-text underline" href={status.linkUrl} target="_blank" rel="noreferrer">{t("botPanel.reachMe.whatsapp.open")}</a>
            </p>
          )}
          {status.codeSentTo ? (
            <div className="flex gap-2">
              <input className={cn(inputCls, "flex-1")} value={code} autoComplete="one-time-code" spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.codePlaceholder", { number: status.codeSentTo })} aria-label={t("botPanel.reachMe.whatsapp.code")} onChange={(event) => setCode(event.target.value)} />
              <button type="button" className={buttonCls} disabled={disabled || !code.trim()} onClick={() => void run({ kind: "link", code }, () => setCode(""))}>{t("botPanel.reachMe.whatsapp.confirm")}</button>
            </div>
          ) : (
            <>
              <p className={noteCls}>{t("botPanel.reachMe.whatsapp.byTemplate")}</p>
              <div className="flex gap-2">
                <input className={cn(inputCls, "flex-1")} value={number} inputMode="tel" autoComplete="tel" placeholder="+1 514 555 0123" aria-label={t("botPanel.reachMe.whatsapp.number")} onChange={(event) => setNumber(event.target.value)} />
                <button type="button" className={buttonCls} disabled={disabled || !number.trim() || !status.templateName} onClick={() => void run({ kind: "link", number })}>{t("botPanel.reachMe.whatsapp.sendByTemplate")}</button>
              </div>
            </>
          )}
          {!status.linking && <button type="button" className="self-start text-[12px] font-medium text-accent-text hover:underline" disabled={disabled} onClick={() => void run({ kind: "link" })}>{t("botPanel.reachMe.whatsapp.newCode")}</button>}
        </div>
      )}
      <div data-reach-whatsapp-template="" className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <input className={cn(inputCls, "flex-1")} value={name} spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.templatePlaceholder")} aria-label={t("botPanel.reachMe.whatsapp.template")} onChange={(event) => setTemplateName(event.target.value)} />
          <input className={cn(inputCls, "w-20")} value={language} spellCheck={false} placeholder="fr" aria-label={t("botPanel.reachMe.whatsapp.templateLanguage")} onChange={(event) => setTemplateLanguage(event.target.value)} />
          {templateDirty && <button type="button" className={buttonCls} disabled={disabled} onClick={() => void run({ kind: "update", templateName: name, templateLanguage: language }, () => { setTemplateName(null); setTemplateLanguage(null); })}>{t("botPanel.reachMe.save")}</button>}
        </div>
        {!status.hasBusinessAccount && (
          <div className="flex gap-2">
            <input className={cn(inputCls, "flex-1")} value={businessAccountId} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.businessAccountPlaceholder")} aria-label={t("botPanel.reachMe.whatsapp.businessAccount")} onChange={(event) => setBusinessAccountId(event.target.value)} />
            <button type="button" className={buttonCls} disabled={disabled || !businessAccountId.trim()} onClick={() => void run({ kind: "update", businessAccountId }, () => setBusinessAccountId(""))}>{t("botPanel.reachMe.save")}</button>
          </div>
        )}
        {check && (
          <div data-reach-whatsapp-check={status.templateCheck?.state} className="flex items-start justify-between gap-2">
            <p className={cn("text-[12px] leading-4", check.ok ? "text-ink-secondary" : "text-warning")}>{check.text}</p>
            {!check.ok && <button type="button" className={cn(buttonCls, "shrink-0")} disabled={disabled} onClick={() => void run({ kind: "update" })}>{t("botPanel.reachMe.whatsapp.recheck")}</button>}
          </div>
        )}
        <p className={noteCls}>{status.windowOpen ? t("botPanel.reachMe.whatsapp.windowOpen") : t("botPanel.reachMe.whatsapp.templateHelp")}</p>
      </div>
      <div data-reach-whatsapp-replies="" className="flex flex-col gap-1">
        {!status.webhookPublic ? (
          <p className={noteCls}>{t("botPanel.reachMe.whatsapp.noPublicWebhook")}</p>
        ) : (
          <>
            <p className={noteCls}>{status.replies ? t("botPanel.reachMe.whatsapp.webhookHelp") : t("botPanel.reachMe.whatsapp.needsAppSecret")}</p>
            {status.webhookUrl && <CopyRow name="url" label={t("botPanel.reachMe.whatsapp.callbackUrl")} value={status.webhookUrl} />}
            {status.verifyToken && <CopyRow name="verify" label={t("botPanel.reachMe.whatsapp.verifyToken")} value={status.verifyToken} />}
          </>
        )}
        {!status.hasAppSecret && (
          <div className="flex gap-2">
            <input className={cn(inputCls, "flex-1")} value={appSecret} type="password" autoComplete="off" spellCheck={false} placeholder={t("botPanel.reachMe.whatsapp.appSecretPlaceholder")} aria-label={t("botPanel.reachMe.whatsapp.appSecret")} onChange={(event) => setAppSecret(event.target.value)} />
            <button type="button" className={buttonCls} disabled={disabled || !appSecret.trim()} onClick={() => void run({ kind: "update", appSecret }, () => setAppSecret(""))}>{t("botPanel.reachMe.save")}</button>
          </div>
        )}
      </div>
      {errorLine}
    </div>
  );
}
