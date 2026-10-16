// A bot's request_login card (target vaultLogin): the person picks a login
// from their credential vault, or saves a new one, and allows it for this
// time (this conversation, 15 minutes) or always for this bot. The bot gets
// a handle, never a value; it fills the login into its browser by reference
// (server/credential-fill.ts). Once answered the card folds into one line.
import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Loader2, LockKeyhole, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { createCredentialDraft, dismissCard, grantFromCard, loadCredentials, matchingItems, parseDomains, type VaultItemListing } from "@/lib/credential-vault";
import { t } from "@/lib/i18n";
import { useStore, type Message } from "@/state/store";
import type { VaultGrantMode } from "../../shared/credential-vault";
import { ASK_CHIP, ASK_CHIP_IDLE, ASK_CHIP_PICKED, ASK_FIELD, ASK_PRIMARY_BUTTON, AskCard, AskSettledLine, returnFocusToComposer } from "./AskCard";

const NEW = "__new__";

export function VaultRequestCard({ botId, threadId, message }: { botId: string; threadId: string; message: Message }) {
  const { state } = useStore();
  const secret = message.secret!;
  const request = secret.vault;
  const site = request?.domain ?? request?.name ?? "";
  const botName = message.from?.name ?? state.bots.find((bot) => bot.id === botId)?.name ?? t("vault.card.thisBot");
  const settled = secret.provided === true || secret.dismissed === true || secret.superseded === true;
  const [items, setItems] = useState<VaultItemListing[] | null>(null);
  const [choice, setChoice] = useState<string>("");
  // The site field starts empty: the bot chose the name it asked for, and a
  // look-alike must be typed by the person, not accepted with one click.
  const [draft, setDraft] = useState({ name: "", domains: "", username: "", password: "", totpSeed: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settled || !request) return;
    let live = true;
    loadCredentials()
      .then((state) => {
        if (!live) return;
        const matches = matchingItems(state.items, request);
        setItems(matches);
        setChoice(matches[0]?.id ?? NEW);
      })
      .catch((failure) => { if (live) { setItems([]); setChoice(NEW); setError(failure instanceof Error ? failure.message : String(failure)); } });
    return () => { live = false; };
  }, [settled, request]);

  if (!request) return null;

  if (secret.superseded) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={t("vault.card.title", { site })}>
        <span className="text-ink-secondary">{t("vault.card.title", { site })}</span>
        <span> · {t("vault.card.superseded")}</span>
      </AskSettledLine>
    );
  }
  if (secret.dismissed) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={t("vault.card.title", { site })}>
        <span className="text-ink-secondary">{t("vault.card.declined", { site })}</span>
      </AskSettledLine>
    );
  }
  if (secret.provided) {
    const how = request.mode === "always" ? t("vault.card.allowedAlways", { bot: botName }) : t("vault.card.allowedOnce");
    return (
      <AskSettledLine
        ariaLabel={t("vault.card.title", { site })}
        icon={secret.resumed || !secret.error ? undefined : <KeyRound size={13} />}
        detail={secret.error && <p role="alert" className="ms-[19px] mt-1 text-[12px] text-danger">{secret.error}</p>}
      >
        <span className="text-ink-secondary">{t("vault.card.allowed", { name: request.itemName ?? site })}</span>
        <span> · {how}</span>
      </AskSettledLine>
    );
  }

  const grant = async (mode: VaultGrantMode, event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const target = choice === NEW
        ? { item: createCredentialDraft({ ...draft, domains: parseDomains(draft.domains) }) }
        : { itemId: choice };
      await grantFromCard(botId, message.id, threadId, mode, target);
      setDraft((current) => ({ ...current, password: "", totpSeed: "" }));
      returnFocusToComposer();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const decline = () => { void dismissCard(botId, message.id, threadId).catch(() => {}); };
  const field = (key: keyof typeof draft, label: string, type = "text", autoComplete = "off") => (
    <input
      type={type}
      autoComplete={autoComplete}
      spellCheck={false}
      dir="ltr"
      value={draft[key]}
      onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
      placeholder={label}
      aria-label={label}
      disabled={busy}
      className={cn(ASK_FIELD, "min-w-[10rem] flex-1")}
    />
  );

  return (
    <AskCard
      ariaLabel={t("vault.card.title", { site })}
      icon={<KeyRound size={15} />}
      title={t("vault.card.title", { site })}
      explanation={t("vault.card.explanation", { bot: botName, site })}
      onDismiss={decline}
      dismissLabel={t("vault.card.notNow")}
    >
      {items === null ? (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary"><Loader2 size={13} className="animate-spin" /> {t("vault.card.loading")}</div>
      ) : (
        <form onSubmit={(event) => void grant("once", event)} className="flex flex-col gap-2" data-vault-card>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("vault.card.choose")}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={choice === item.id}
                onClick={() => setChoice(item.id)}
                className={cn(ASK_CHIP, choice === item.id ? ASK_CHIP_PICKED : ASK_CHIP_IDLE)}
              >
                <span className="truncate">{item.name}{item.username ? ` · ${item.username}` : ""}</span>
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={choice === NEW}
              onClick={() => setChoice(NEW)}
              className={cn(ASK_CHIP, choice === NEW ? ASK_CHIP_PICKED : ASK_CHIP_IDLE)}
            >
              {t("vault.card.newLogin")}
            </button>
          </div>
          {choice === NEW && (
            <div className="flex flex-col gap-2">
              {request.domain && (
                <p role="note" className="text-[12px] leading-relaxed text-ink-secondary" data-vault-lookalike>
                  {t("vault.card.checkSite", { site: request.domain })}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {field("name", t("vault.field.name"))}
                {field("domains", t("vault.field.sites"))}
              </div>
              <div className="flex flex-wrap gap-2">
                {field("username", t("vault.field.username"), "text", "off")}
                {field("password", t("vault.field.password"), "password", "new-password")}
              </div>
              {field("totpSeed", t("vault.field.totpOptional"), "password", "off")}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || !choice} className={ASK_PRIMARY_BUTTON}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
              {t("vault.card.allowOnce")}
            </button>
            <button type="button" disabled={busy || !choice} onClick={() => void grant("always")} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>
              {t("vault.card.allowAlways", { bot: botName })}
            </button>
          </div>
          <span className="flex items-center gap-1 text-[11.5px] text-ink-tertiary">
            <LockKeyhole size={11} /> {t("vault.card.privacy")}
          </span>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </AskCard>
  );
}
