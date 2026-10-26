// Settings > Credentials (Identifiants): the person's credential vault. Each
// item shows its sites, what is saved (booleans only: the server never sends
// a value), the bots allowed to use it and when one last did. Items are
// added here or from a bot's request card, edited, deleted; a bot is
// allowed always or revoked. Optional 1Password: a read-only picker when the
// op CLI or 1Password Connect is present (server/onepassword.ts).
// 2026-10-18 : drawn as the other pages (grey headings over cards of
// rows, the page's intro level with its title, SettingsPrimitives). Import
// and Export move items from and to other password managers
// (CredentialsTransfer.tsx).
import { useCallback, useEffect, useMemo, useState } from "react";

import { allowBotAlways, answerPurchase, createCredential, deleteCredential, importOnePasswordItem, loadCredentials, loadOnePasswordItems, parseDomains, revealCredential, revealCredentialNotes, revokeBot, updateCredential, type CredentialVaultState, type OnePasswordItem, type PurchaseListing, type VaultItemDraft, type VaultItemListing } from "@/lib/credential-vault";
import { t, activeLocale } from "@/lib/i18n";
import { useStore } from "@/state/store";
import type { VaultItemKind } from "../../../shared/credential-vault";
import { EditorBox, EditorField, FIELD, PILL, PillSelect, PRIMARY_PILL, SettingsGroup, SettingsIntro, SettingsNotice, SettingsTextRow } from "../SettingsPrimitives";
import { ExportPanel, ImportPanel, importOutcomeText } from "./CredentialsTransfer";
import { PhoneCardScanButton, scannedCardFields } from "./PhoneCardScanButton";
import { botLabel } from "@/lib/human-label";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const inputClass = FIELD;

type Draft = {
  kind: VaultItemKind; name: string; domains: string; username: string; password: string; totpSeed: string; apiKey: string; notes: string;
  pan: string; cvv: string; expMonth: string; expYear: string; holder: string;
  recipient: string; line1: string; line2: string; city: string; region: string; postal: string; country: string; phone: string;
  fullName: string; email: string; company: string;
};
const EMPTY: Draft = {
  kind: "login", name: "", domains: "", username: "", password: "", totpSeed: "", apiKey: "", notes: "",
  pan: "", cvv: "", expMonth: "", expYear: "", holder: "",
  recipient: "", line1: "", line2: "", city: "", region: "", postal: "", country: "", phone: "",
  fullName: "", email: "", company: "",
};

/** Only the fields typed: on an edit, a secret left blank keeps its value. */
function draftBody(draft: Draft, editing: boolean): Partial<VaultItemDraft> {
  const body: Partial<VaultItemDraft> = { name: draft.name, domains: parseDomains(draft.domains) };
  if (!editing) body.kind = draft.kind;
  if (draft.kind === "login") {
    body.username = draft.username;
    if (draft.password || !editing) body.password = draft.password;
    if (draft.totpSeed || !editing) body.totpSeed = draft.totpSeed;
  }
  if (draft.kind === "apiKey" && (draft.apiKey || !editing)) body.apiKey = draft.apiKey;
  if (draft.kind === "card" && (draft.pan || draft.cvv || draft.holder || !editing)) {
    body.card = {
      ...(draft.pan ? { pan: draft.pan } : {}),
      ...(draft.cvv ? { cvv: draft.cvv } : {}),
      ...(draft.holder ? { holder: draft.holder } : {}),
      ...(draft.expMonth ? { expMonth: Number(draft.expMonth) } : {}),
      ...(draft.expYear ? { expYear: Number(draft.expYear) } : {}),
    };
  }
  if (draft.kind === "address") {
    body.address = {
      recipient: draft.recipient, line1: draft.line1, city: draft.city, postal: draft.postal, country: draft.country,
      ...(draft.line2 ? { line2: draft.line2 } : {}),
      ...(draft.region ? { region: draft.region } : {}),
      ...(draft.phone ? { phone: draft.phone } : {}),
    };
  }
  if (draft.kind === "contact") {
    body.contact = {
      fullName: draft.fullName,
      ...(draft.email ? { email: draft.email } : {}),
      ...(draft.phone ? { phone: draft.phone } : {}),
      ...(draft.company ? { company: draft.company } : {}),
    };
  }
  if (draft.notes || !editing) body.notes = draft.notes;
  return body;
}

function when(at: number | undefined): string {
  if (!at) return t("vault.settings.never");
  return new Date(at).toLocaleString(activeLocale(), { dateStyle: "medium", timeStyle: "short" });
}

export function CredentialsSettings() {
  const { state } = useStore();
  const [data, setData] = useState<CredentialVaultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await loadCredentials());
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const botName = useCallback((id: string) => botLabel(state.bots.find((bot) => bot.id === id)?.name, id), [state.bots]);

  if (!data) {
    return error
      ? <SettingsNotice tone="danger">{error}</SettingsNotice>
      : <SettingsIntro>{t("vault.settings.loading")}</SettingsIntro>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-3" data-credentials-settings>
      <SettingsIntro>{t("vault.settings.intro")}</SettingsIntro>
      {data.unavailable && <SettingsNotice tone="danger">{t("vault.settings.unavailable")}</SettingsNotice>}
      {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
      <div data-settings-card="credentials.items">
        <SettingsGroup title={t("vault.settings.itemsTitle")} groupId="credentials.items">
          <SettingsTextRow>{t("vault.settings.itemsSubtitle")}</SettingsTextRow>
          {data.items.length === 0 && <SettingsTextRow>{t("vault.settings.empty")}</SettingsTextRow>}
          {data.items.map((item) => editing === item.id
            ? <ItemForm key={item.id} item={item} onDone={async () => { setEditing(null); await refresh(); }} />
            : <ItemRow key={item.id} item={item} botName={botName} bots={state.bots} onEdit={() => setEditing(item.id)} onChanged={refresh} onError={setError} />)}
          {adding && <ItemForm onDone={async () => { setAdding(false); await refresh(); }} />}
          {transfer === "import" && (
            <ImportPanel
              existing={data.items}
              onCancel={() => setTransfer(null)}
              onDone={async (outcome) => { setTransfer(null); setImported(importOutcomeText(outcome)); await refresh(); }}
            />
          )}
          {transfer === "export" && <ExportPanel onCancel={() => setTransfer(null)} />}
          {imported && !transfer && <SettingsTextRow live><span data-credential-import-result>{imported}</span></SettingsTextRow>}
          {!adding && !transfer && data.exportBlocked && (
            <SettingsTextRow><span data-credentials-export-blocked="">{t("vault.transfer.exportBlocked")}</span></SettingsTextRow>
          )}
          {!adding && !transfer && (
            <div className="flex flex-wrap justify-end gap-2 px-3.5 py-2.5" data-credentials-actions>
              <button type="button" className={PILL} disabled={Boolean(data.unavailable)} onClick={() => { setImported(null); setTransfer("import"); }} data-credentials-import="">{t("vault.transfer.import")}</button>
              <button
                type="button"
                className={PILL}
                disabled={Boolean(data.unavailable) || data.items.length === 0 || data.exportBlocked === true}
                title={data.exportBlocked ? t("vault.transfer.exportBlocked") : undefined}
                onClick={() => { setImported(null); setTransfer("export"); }}
                data-credentials-export=""
              >{t("vault.transfer.export")}</button>
              <button type="button" className={PRIMARY_PILL} onClick={() => setAdding(true)} data-credentials-add="">{t("vault.settings.add")}</button>
            </div>
          )}
        </SettingsGroup>
      </div>
      {(data.purchases ?? []).length > 0 && <PurchaseList purchases={data.purchases ?? []} onChanged={refresh} onError={setError} />}
      <OnePasswordCard data={data} onImported={refresh} />
    </div>
  );
}

function ItemRow({ item, botName, bots, onEdit, onChanged, onError }: {
  item: VaultItemListing;
  botName: (id: string) => string;
  bots: ReadonlyArray<{ id: string; name: string }>;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [pan, setPan] = useState<string | null>(null);
  const [allow, setAllow] = useState("");
  const allowed = new Set(item.grants.map((grant) => grant.botId));
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await work();
      await onChanged();
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  const saved = [
    item.username ? t("vault.settings.savedUsername", { username: item.username }) : "",
    item.hasPassword ? t("vault.field.password") : "",
    item.hasTotp ? t("vault.settings.savedTotp") : "",
    item.hasApiKey ? t("vault.field.apiKey") : "",
    item.hasNotes ? t("vault.field.notes") : "",
    item.card ? t("vault.card.ending", { last4: item.card.last4, brand: item.card.brand }) : "",
    item.address ? `${item.address.city}, ${item.address.country}` : "",
    item.contact?.email ?? "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-2.5" data-credential-item={item.id}>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="truncate text-[13px] leading-[18px] text-ink">
            {item.name}
            <span className="ms-2 text-[11.5px] text-ink-tertiary">{t(`vault.kind.${item.kind}`)}{item.source === "1password" ? ` · 1Password` : ""}</span>
          </div>
          {item.domains.length > 0 && <div className="mt-0.5 truncate text-[12px] leading-4 text-ink-secondary" dir="ltr">{item.domains.join(", ")}</div>}
          {saved && <div className="text-[12px] leading-4 text-ink-secondary">{saved}</div>}
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          {item.card && (
            <button type="button" className={PILL} disabled={busy} onClick={() => void (pan === null
              ? revealCredential(item.id, "pan").then((answer) => setPan(answer.value)).catch((failure) => onError(message(failure)))
              : Promise.resolve(setPan(null)))}>
              {pan === null ? t("vault.settings.showNumber") : t("vault.settings.hideNumber")}
            </button>
          )}
          {item.hasNotes && (
            <button type="button" className={PILL} disabled={busy} onClick={() => void (notes === null ? revealCredentialNotes(item.id).then((answer) => setNotes(answer.notes)).catch((failure) => onError(message(failure))) : Promise.resolve(setNotes(null)))}>
              {notes === null ? t("vault.settings.showNote") : t("vault.settings.hideNote")}
            </button>
          )}
          <button type="button" className={PILL} disabled={busy} onClick={onEdit}>{t("vault.settings.edit")}</button>
          {confirming
            ? <button type="button" className={`${PILL} text-danger`} disabled={busy} onClick={() => void run(() => deleteCredential(item.id))}>{t("vault.settings.confirmDelete")}</button>
            : <button type="button" className={PILL} disabled={busy} onClick={() => setConfirming(true)}>{t("vault.settings.delete")}</button>}
        </div>
      </div>
      {notes !== null && <pre className="whitespace-pre-wrap rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink">{notes}</pre>}
      {pan !== null && <p className="font-mono text-[12.5px] text-ink" dir="ltr">{pan}</p>}
      {(item.kind === "login" || item.kind === "apiKey") && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-ink-secondary">{t("vault.settings.allowedBots")}</span>
          {item.grants.length === 0 && <span className="text-ink-tertiary">{t("vault.settings.noBots")}</span>}
          {item.grants.map((grant) => (
            <span key={`${grant.botId}:${grant.threadId ?? ""}`} className="inline-flex items-center gap-1 rounded-full bg-ink/[0.07] px-2 py-0.5 text-ink">
              {botName(grant.botId)}{grant.mode === "once" ? ` (${t("vault.settings.onceShort")})` : ""}
              <button type="button" aria-label={t("vault.settings.revoke", { bot: botName(grant.botId) })} title={t("vault.settings.revoke", { bot: botName(grant.botId) })} disabled={busy} className="text-ink-tertiary hover:text-ink" onClick={() => void run(() => revokeBot(item.id, grant.botId))}>×</button>
            </span>
          ))}
          <PillSelect
            ariaLabel={t("vault.settings.allowBot")}
            value={allow}
            disabled={busy}
            onChange={setAllow}
            options={[
              { value: "", label: t("vault.settings.allowBot"), disabled: true },
              ...bots.filter((bot) => !allowed.has(bot.id)).map((bot) => ({ value: bot.id, label: bot.name })),
            ]}
          />
          {allow && <button type="button" className={PILL} disabled={busy} onClick={() => void run(async () => { await allowBotAlways(item.id, allow); setAllow(""); })}>{t("vault.settings.allow")}</button>}
        </div>
      )}
      <div className="text-[12px] leading-4 text-ink-tertiary">
        {item.lastUsedAt
          ? t("vault.settings.lastUsed", { when: when(item.lastUsedAt), bot: botName(item.lastUsedBy ?? "") })
          : t("vault.settings.neverUsed")}
      </div>
    </div>
  );
}

function ItemForm({ item, onDone }: { item?: VaultItemListing; onDone: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => item
    ? {
      ...EMPTY, kind: item.kind, name: item.name, domains: item.domains.join(", "), username: item.username ?? "",
      holder: item.card?.holder ?? "", expMonth: item.card ? String(item.card.expMonth) : "", expYear: item.card ? String(item.card.expYear) : "",
      recipient: item.address?.recipient ?? "", line1: item.address?.line1 ?? "", line2: item.address?.line2 ?? "",
      city: item.address?.city ?? "", region: item.address?.region ?? "", postal: item.address?.postal ?? "",
      country: item.address?.country ?? "", phone: item.address?.phone ?? item.contact?.phone ?? "",
      fullName: item.contact?.fullName ?? "", email: item.contact?.email ?? "", company: item.contact?.company ?? "",
    }
    : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = item?.source === "1password";
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = draftBody(draft, Boolean(item));
      if (item) await updateCredential(item.id, readOnly ? { name: body.name, domains: body.domains, ...(body.notes !== undefined ? { notes: body.notes } : {}) } : body);
      else await createCredential(body as VaultItemDraft);
      setDraft(EMPTY);
      await onDone();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  const keep = item ? t("vault.settings.keepBlank") : undefined;
  return (
    <EditorBox
      label={item ? item.name : t("vault.settings.add")}
      className="mx-3.5 my-1.5"
      data-credential-form=""
      onSubmit={() => void submit()}
      actions={(
        <>
          <button type="button" className={PILL} disabled={busy} onClick={() => void onDone()}>{t("vault.settings.cancel")}</button>
          <button type="submit" className={PRIMARY_PILL} disabled={busy}>{t("vault.settings.save")}</button>
        </>
      )}
    >
      {!item && (
        <EditorField label={t("vault.field.kind")} menu>
          <PillSelect
            ariaLabel={t("vault.field.kind")}
            value={draft.kind}
            onChange={(kind) => setDraft((current) => ({ ...current, kind }))}
            options={(["login", "apiKey", "note", "card", "address", "contact"] as const).map((kind) => ({ value: kind, label: t(`vault.kind.${kind}`) }))}
          />
        </EditorField>
      )}
      <EditorField label={t("vault.field.name")}><input className={inputClass} value={draft.name} onChange={set("name")} aria-label={t("vault.field.name")} required /></EditorField>
      {(draft.kind === "login" || draft.kind === "apiKey") && <EditorField label={t("vault.field.sites")} hint={t("vault.field.sitesHint")}><input className={inputClass} dir="ltr" value={draft.domains} onChange={set("domains")} aria-label={t("vault.field.sites")} /></EditorField>}
      {draft.kind === "card" && !readOnly && (
        <>
          {!item && <div className="px-3 py-1.5"><PhoneCardScanButton onRead={(card) => setDraft((current) => ({ ...current, ...scannedCardFields(card) }))} /></div>}
          <EditorField label={t("vault.field.holder")}><input className={inputClass} value={draft.holder} onChange={set("holder")} aria-label={t("vault.field.holder")} autoComplete="off" /></EditorField>
          <EditorField label={t("vault.field.pan")}><input className={inputClass} dir="ltr" type="password" value={draft.pan} onChange={set("pan")} placeholder={keep} aria-label={t("vault.field.pan")} autoComplete="off" inputMode="numeric" /></EditorField>
          <EditorField label={t("vault.field.cvv")}><input className={inputClass} dir="ltr" type="password" value={draft.cvv} onChange={set("cvv")} placeholder={keep} aria-label={t("vault.field.cvv")} autoComplete="off" inputMode="numeric" /></EditorField>
          <EditorField label={t("vault.field.expMonth")}><input className={inputClass} dir="ltr" value={draft.expMonth} onChange={set("expMonth")} aria-label={t("vault.field.expMonth")} inputMode="numeric" /></EditorField>
          <EditorField label={t("vault.field.expYear")}><input className={inputClass} dir="ltr" value={draft.expYear} onChange={set("expYear")} aria-label={t("vault.field.expYear")} inputMode="numeric" /></EditorField>
        </>
      )}
      {draft.kind === "address" && (
        <>
          <EditorField label={t("vault.field.recipient")}><input className={inputClass} value={draft.recipient} onChange={set("recipient")} aria-label={t("vault.field.recipient")} /></EditorField>
          <EditorField label={t("vault.field.line1")}><input className={inputClass} value={draft.line1} onChange={set("line1")} aria-label={t("vault.field.line1")} /></EditorField>
          <EditorField label={t("vault.field.city")}><input className={inputClass} value={draft.city} onChange={set("city")} aria-label={t("vault.field.city")} /></EditorField>
          <EditorField label={t("vault.field.region")}><input className={inputClass} value={draft.region} onChange={set("region")} aria-label={t("vault.field.region")} /></EditorField>
          <EditorField label={t("vault.field.postal")}><input className={inputClass} dir="ltr" value={draft.postal} onChange={set("postal")} aria-label={t("vault.field.postal")} /></EditorField>
          <EditorField label={t("vault.field.country")}><input className={inputClass} dir="ltr" value={draft.country} onChange={set("country")} aria-label={t("vault.field.country")} /></EditorField>
        </>
      )}
      {draft.kind === "contact" && (
        <>
          <EditorField label={t("vault.field.fullName")}><input className={inputClass} value={draft.fullName} onChange={set("fullName")} aria-label={t("vault.field.fullName")} /></EditorField>
          <EditorField label={t("vault.field.email")}><input className={inputClass} dir="ltr" value={draft.email} onChange={set("email")} aria-label={t("vault.field.email")} /></EditorField>
          <EditorField label={t("vault.field.phone")}><input className={inputClass} dir="ltr" value={draft.phone} onChange={set("phone")} aria-label={t("vault.field.phone")} /></EditorField>
          <EditorField label={t("vault.field.company")}><input className={inputClass} value={draft.company} onChange={set("company")} aria-label={t("vault.field.company")} /></EditorField>
        </>
      )}
      {draft.kind === "login" && !readOnly && (
        <>
          <EditorField label={t("vault.field.username")}><input className={inputClass} dir="ltr" autoComplete="off" value={draft.username} onChange={set("username")} aria-label={t("vault.field.username")} /></EditorField>
          <EditorField label={t("vault.field.password")}><input className={inputClass} dir="ltr" type="password" autoComplete="new-password" value={draft.password} onChange={set("password")} placeholder={keep} aria-label={t("vault.field.password")} /></EditorField>
          <EditorField label={t("vault.field.totp")}><input className={inputClass} dir="ltr" type="password" autoComplete="off" value={draft.totpSeed} onChange={set("totpSeed")} placeholder={keep ?? t("vault.field.totpOptional")} aria-label={t("vault.field.totp")} /></EditorField>
        </>
      )}
      {draft.kind === "apiKey" && !readOnly && (
        <EditorField label={t("vault.field.apiKey")}><input className={inputClass} dir="ltr" type="password" autoComplete="off" value={draft.apiKey} onChange={set("apiKey")} placeholder={keep} aria-label={t("vault.field.apiKey")} /></EditorField>
      )}
      <EditorField label={t("vault.field.notes")}><textarea className={inputClass} rows={draft.kind === "note" ? 4 : 2} value={draft.notes} onChange={set("notes")} placeholder={keep ?? t("vault.field.notesOptional")} aria-label={t("vault.field.notes")} /></EditorField>
      {error && <p role="alert" className="px-3 py-1.5 text-[12px] text-danger">{error}</p>}
    </EditorBox>
  );
}

function PurchaseList({ purchases, onChanged, onError }: { purchases: PurchaseListing[]; onChanged: () => Promise<void>; onError: (error: string | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const answer = async (id: string, decision: "deny" | "once") => {
    setBusy(id);
    onError(null);
    try {
      await answerPurchase(id, decision);
      await onChanged();
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-settings-card="credentials.purchases">
      <SettingsGroup title={t("vault.purchase.title")} groupId="credentials.purchases">
        <SettingsTextRow>{t("vault.purchase.intro")}</SettingsTextRow>
        {purchases.map((purchase) => (
          <div key={purchase.id} className="flex flex-col gap-2 px-3.5 py-2.5" data-purchase={purchase.merchant}>
            <div className="text-[13px] text-ink">{purchase.title}</div>
            <div className="text-[12px] text-ink-secondary">{purchase.line}</div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={`${PILL} text-danger`} disabled={busy !== null} onClick={() => void answer(purchase.id, "deny")}>{t("vault.purchase.deny")}</button>
              <button type="button" className={PRIMARY_PILL} disabled={busy !== null} onClick={() => void answer(purchase.id, "once")}>{t("vault.purchase.once")}</button>
            </div>
          </div>
        ))}
      </SettingsGroup>
    </div>
  );
}

function OnePasswordCard({ data, onImported }: { data: CredentialVaultState; onImported: () => Promise<void> }) {
  const status = data.onePassword;
  const [items, setItems] = useState<OnePasswordItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((item) => !q || item.title.toLowerCase().includes(q) || item.domains.some((domain) => domain.includes(q))).slice(0, 50);
  }, [items, query]);
  if (status.reason === "organization") return null;
  const subtitle = status.available
    ? t(status.via === "connect" ? "vault.onePassword.connect" : "vault.onePassword.cli")
    : t(status.reason === "signed_out" ? "vault.onePassword.signedOut" : "vault.onePassword.absent");
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      setItems((await loadOnePasswordItems()).items);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  // 2026-10-21 (parité R10, ligne 41): check again after the person
  // followed the steps (a fresh look, not the minute-old cached one).
  const recheck = async () => {
    setBusy(true);
    setError(null);
    try {
      await loadOnePasswordItems().catch(() => undefined);
      await onImported();
    } finally {
      setBusy(false);
    }
  };
  const pick = async (item: OnePasswordItem) => {
    setBusy(true);
    setError(null);
    try {
      await importOnePasswordItem(item);
      await onImported();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-settings-card="credentials.onePassword">
      <SettingsGroup title="1Password" groupId="credentials.onePassword">
        <SettingsTextRow>{subtitle}</SettingsTextRow>
        {!status.available && (
          <div className="flex flex-col gap-2 px-3.5 py-2.5 text-[13px]" data-onepassword-steps>
            <span className="text-[12.5px] font-medium text-ink-secondary">{t("vault.onePassword.stepsTitle")}</span>
            <ol className="ms-4 list-decimal text-[12.5px] leading-5 text-ink-secondary">
              <li>{t("vault.onePassword.step1")}</li>
              <li>{t("vault.onePassword.step2")}</li>
              <li>{t("vault.onePassword.step3")}</li>
            </ol>
            <div className="flex justify-end"><button type="button" className={PILL} disabled={busy} onClick={() => void recheck()}>{t("vault.onePassword.recheck")}</button></div>
          </div>
        )}
        {status.available && <SettingsTextRow>{t("vault.onePassword.perRequest")}</SettingsTextRow>}
        {status.available && (
          <div className="flex flex-col gap-2 px-3.5 py-2.5 text-[13px]">
            {items === null
              ? <div className="flex justify-end"><button type="button" className={PILL} disabled={busy} onClick={() => void open()}>{t("vault.onePassword.pick")}</button></div>
              : (
                <>
                  <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("vault.onePassword.search")} aria-label={t("vault.onePassword.search")} />
                  <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
                    {shown.map((item) => (
                      <li key={`${item.vaultId}:${item.id}`} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{item.title} <span className="text-[12px] text-ink-tertiary">{item.vaultName}{item.domains.length ? ` · ${item.domains.join(", ")}` : ""}</span></span>
                        <button type="button" className={PILL} disabled={busy || item.domains.length === 0} title={item.domains.length === 0 ? t("vault.onePassword.noSite") : undefined} onClick={() => void pick(item)}>{t("vault.onePassword.add")}</button>
                      </li>
                    ))}
                    {shown.length === 0 && <li className="text-[12.5px] text-ink-secondary">{t("vault.onePassword.none")}</li>}
                  </ul>
                </>
              )}
            <p className="text-[12px] leading-4 text-ink-tertiary">{t("vault.onePassword.readOnly")}</p>
          </div>
        )}
        {error && <SettingsTextRow tone="danger">{error}</SettingsTextRow>}
      </SettingsGroup>
    </div>
  );
}
