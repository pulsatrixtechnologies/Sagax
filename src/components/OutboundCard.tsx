// The card of an outward action a bot asks for (message field `outbound`,
// shared/wire.ts): a phone call (server/outbound-calls.ts) or a purchase
// with a saved card (server/credential-vault.ts). Parité Grok Bot V4, 59, 83.
//
// One answer covers one action: Call or Don't call, Allow once or Decline.
// No Always allow here. The card shows the full number to its own person,
// the exact words the call says, what the purchase buys; never a card
// number, a security code or an id.
//
// A conversation call (mode `conversation`) shows the objective, the most it
// may last and the language, its guidance and voicemail words behind a
// disclosure; once placed and not ended, "in progress"; once ended, the
// result: how it ended, how long, the summary, the commitments and the
// transcript behind a toggle. The other party's words stay plain text.
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Phone, PhoneCall, PhoneOff, Plane, ShoppingBag, TriangleAlert, Truck } from "lucide-react";

import { answerPurchase } from "@/lib/credential-vault";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, type Message } from "@/state/store";
import type { OutboundCallResult, OutboundCard as OutboundCardData } from "../../shared/wire";
import { ORDER_STEPPER, orderStepIndex, type OrderStep, type OrderTracking } from "../../shared/order-tracking";
import { cn } from "@/lib/cn";
import { openExternalLink } from "@/lib/app-links";
import { readableError } from "@/lib/plain-error";

export function formatMoney(amount: string | undefined, currency: string | undefined, locale = activeLocale()): string {
  if (!amount) return "";
  const value = Number(amount);
  if (!Number.isFinite(value) || !currency) return amount;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** "3 articles achetés · 45,20 $", "2 vols achetés", "Acheté · 12,00 $". */
export function purchaseSummary(card: OutboundCardData): string {
  const amount = formatMoney(card.amount, card.currency);
  const count = (card.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const flights = card.flights?.length ?? 0;
  if (flights) return flights === 1 ? t("outbound.purchase.flightOne", { amount }) : t("outbound.purchase.flights", { count: String(flights), amount });
  if (count) return count === 1 ? t("outbound.purchase.itemOne", { amount }) : t("outbound.purchase.items", { count: String(count), amount });
  return t("outbound.purchase.done", { amount });
}

/** "4:07": whole seconds as minutes and seconds. */
export function formatCallDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const OUTCOME_LABEL: Record<OutboundCallResult["outcome"], LocaleKey> = {
  completed: "outbound.call.outcome.completed",
  voicemail: "outbound.call.outcome.voicemail",
  "no-answer": "outbound.call.outcome.noAnswer",
  busy: "outbound.call.outcome.busy",
  failed: "outbound.call.outcome.failed",
};

const ENDED_BY_LABEL: Record<NonNullable<OutboundCallResult["endedBy"]>, LocaleKey> = {
  goal: "outbound.call.endedBy.goal",
  callee: "outbound.call.endedBy.callee",
  "stop-request": "outbound.call.endedBy.stopRequest",
  "time-limit": "outbound.call.endedBy.timeLimit",
  "hang-up": "outbound.call.endedBy.hangUp",
};

const OUTCOME_TONE: Record<OutboundCallResult["outcome"], string> = {
  completed: "bg-accent/12 text-accent",
  voicemail: "bg-inset text-ink-secondary",
  "no-answer": "bg-warning/15 text-warning",
  busy: "bg-warning/15 text-warning",
  failed: "bg-danger/12 text-danger",
};

/** The badge's words: an outcome from a newer server reads as "Ended". */
export function outcomeLabel(result: OutboundCallResult): string {
  const outcome = t(OUTCOME_LABEL[result.outcome] ?? "outbound.call.outcome.ended");
  const reason = result.outcome === "completed" && result.endedBy ? ENDED_BY_LABEL[result.endedBy] : undefined;
  return reason ? `${outcome} · ${t(reason)}` : outcome;
}

function languageName(language: OutboundCardData["language"]): string {
  if (language === "fr") return t("outbound.call.language.fr");
  if (language === "en") return t("outbound.call.language.en");
  return "";
}

function statusLine(card: OutboundCardData): string | null {
  const bot = card.botName;
  if (card.kind === "call" && card.mode === "conversation") {
    if (card.status === "approved") return t("outbound.call.status.approved", { bot });
    if (card.status === "done") return card.result ? null : t("outbound.call.status.inProgress");
    if (card.status === "denied") return t("outbound.call.status.denied");
    if (card.status === "failed") return card.result ? null : t("outbound.call.status.failed");
    return null;
  }
  if (card.kind === "call") {
    if (card.status === "approved") return t("outbound.call.status.approved", { bot });
    if (card.status === "done") return t("outbound.call.status.done");
    if (card.status === "denied") return t("outbound.call.status.denied");
    if (card.status === "failed") return t("outbound.call.status.failed");
    return null;
  }
  if (card.status === "approved") return t("outbound.purchase.status.approved", { bot });
  if (card.status === "denied") return t("outbound.purchase.status.denied");
  return null;
}

export function OutboundCard({ message, transcriptOpen = false }: { message: Message; transcriptOpen?: boolean }) {
  const card = message.outbound!;
  const conversation = card.kind === "call" && card.mode === "conversation";
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [answered, setAnswered] = useState<OutboundCardData["status"] | null>(null);
  const [error, setError] = useState("");
  // ÉFVP pilot: Call only after the person confirms the number on the card
  const [confirmed, setConfirmed] = useState(false);
  const status = answered ?? card.status;
  const view = { ...card, status };

  const answer = async (yes: boolean) => {
    setBusy(yes ? "yes" : "no");
    setError("");
    try {
      if (card.kind === "call") {
        await api(`/api/me/phone-calls/${encodeURIComponent(card.id)}/answer`, { method: "POST", body: JSON.stringify(yes ? { decision: "call", confirmed: confirmed, confirmedTo: card.destination } : { decision: "deny" }) });
      } else {
        await answerPurchase(card.id, yes ? "once" : "deny");
      }
      setAnswered(yes ? "approved" : "denied");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const done = card.kind === "purchase" && status === "done";
  const Icon = card.kind === "call" ? (status === "denied" ? PhoneOff : conversation ? PhoneCall : Phone) : card.flights?.length ? Plane : ShoppingBag;
  const title = card.kind === "call"
    ? t("outbound.call.to", { destination: card.destination ?? "" })
    : done ? purchaseSummary(card) : t("outbound.purchase.pay", { amount: formatMoney(card.amount, card.currency), merchant: card.merchant ?? "" });
  const state = statusLine(view);

  return (
    <article data-outbound-card={card.kind} data-outbound-status={status} aria-label={title}
      className="my-2 w-full max-w-[560px] overflow-hidden rounded-xl border border-hairline/40 bg-panel shadow-sm">
      <header className="flex items-center gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-2 text-[12px] text-ink-secondary">
        <Icon size={14} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{conversation ? t("outbound.call.conversation.title") : card.kind === "call" ? t("outbound.call.title") : t("outbound.purchase.title")}</span>
        <span className="truncate">{card.botName}</span>
      </header>
      <div className="space-y-2 px-3 py-3 text-[13px] text-ink">
        <p className="font-medium">{title}</p>
        {conversation && (
          <ConversationCallBody card={card} status={status} transcriptOpen={transcriptOpen} />
        )}
        {conversation && status === "pending" && (
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" data-outbound-confirm checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            {t("outbound.call.confirm", { destination: card.destination ?? "" })}
          </label>
        )}
        {card.kind === "call" && !conversation && (
          <>
            {card.from && <p className="text-[12px] text-ink-secondary">{t("outbound.call.from", { from: card.from })}</p>}
            {card.purpose && <p><span className="text-ink-secondary">{t("outbound.call.purpose")} </span>{card.purpose}</p>}
            {card.script && (
              <div>
                <p className="text-[12px] text-ink-secondary">{t("outbound.call.script", { bot: card.botName })}</p>
                <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-hairline/60 pl-2 text-[12.5px]">{card.script}</blockquote>
              </div>
            )}
            {card.callback && <p className="text-[12px] text-ink-secondary">{t("outbound.call.callback", { number: card.callback })}</p>}
            {status === "pending" && <p className="text-[12px] text-ink-secondary">{t("outbound.call.disclosure")}</p>}
            {status === "pending" && (
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" data-outbound-confirm checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                {t("outbound.call.confirm", { destination: card.destination ?? "" })}
              </label>
            )}
          </>
        )}
        {card.kind === "purchase" && (
          <>
            {done && card.merchant && <p className="text-[12px] text-ink-secondary">{card.merchant}{card.orderRef ? ` · ${t("outbound.purchase.order", { ref: card.orderRef })}` : ""}</p>}
            {(card.items?.length ?? 0) > 0 && (
              <ul className="space-y-0.5 text-[12.5px]">
                {card.items!.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{(item.quantity ?? 1) > 1 ? `${item.quantity} × ` : ""}{item.name}</span>
                    {item.price && <span className="text-ink-secondary">{formatMoney(item.price, card.currency)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {(card.flights?.length ?? 0) > 0 && (
              <ul className="space-y-0.5 text-[12.5px]">
                {card.flights!.map((leg, index) => (
                  <li key={`${leg.from}-${leg.to}-${index}`}>
                    {t("outbound.purchase.flight", { from: leg.from, to: leg.to, date: leg.date })}{leg.flight ? ` · ${leg.flight}` : ""}{leg.passenger ? ` · ${leg.passenger}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {done && card.declared && <p className="text-[12px] text-ink-secondary">{t("outbound.purchase.declared")}</p>}
            {done && card.mismatchTotal && <p role="alert" className="text-[12px] text-warning">{t("outbound.purchase.mismatch", { total: formatMoney(card.mismatchTotal, card.currency), amount: formatMoney(card.amount, card.currency) })}</p>}
            {done && card.tracking && <OrderTrackingView tracking={card.tracking} />}
            {card.cardLabel && !done && <p className="text-[12px] text-ink-secondary">{t("outbound.purchase.card", { card: card.cardLabel })}</p>}
            {status === "pending" && <p className="text-[12px] text-ink-secondary">{t("outbound.purchase.never")}</p>}
          </>
        )}
        {state && <p role="status" className="text-[12px] text-ink-secondary">{state}</p>}
        {card.via && status !== "pending" && <p className="text-[12px] text-ink-secondary">{t("outbound.via", { name: card.via })}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        {status === "pending" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" data-outbound-yes disabled={busy !== null || (card.kind === "call" && !confirmed)} onClick={() => void answer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
              {busy === "yes" && <Loader2 size={13} className="animate-spin" />}
              {card.kind === "call" ? t("outbound.call.allow") : t("outbound.purchase.allow")}
            </button>
            <button type="button" data-outbound-no disabled={busy !== null} onClick={() => void answer(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/60 px-3 py-1.5 text-[12.5px] text-ink disabled:opacity-40">
              {busy === "no" && <Loader2 size={13} className="animate-spin" />}
              {card.kind === "call" ? t("outbound.call.deny") : t("outbound.purchase.deny")}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function ConversationCallBody({ card, status, transcriptOpen }: { card: OutboundCardData; status: OutboundCardData["status"]; transcriptOpen: boolean }) {
  const [details, setDetails] = useState(false);
  const language = languageName(card.language);
  const meta = [card.maxMinutes ? t("outbound.call.maxMinutes", { minutes: String(card.maxMinutes) }) : "", language].filter(Boolean).join(" · ");
  const result = card.result;
  const hasDetails = Boolean(card.instructions?.trim() || card.voicemail?.trim());
  return (
    <>
      {card.from && <p className="text-[12px] text-ink-secondary">{t("outbound.call.from", { from: card.from })}</p>}
      {card.objective && <p className="whitespace-pre-wrap"><span className="text-ink-secondary">{t("outbound.call.objective")} </span>{card.objective}</p>}
      {!result && card.script?.trim() && (
        <div>
          <p className="text-[12px] text-ink-secondary">{t("outbound.call.conversation.opening", { bot: card.botName })}</p>
          <blockquote data-outbound-opening className="mt-1 whitespace-pre-wrap border-l-2 border-hairline/60 pl-2 text-[12.5px]">{card.script}</blockquote>
        </div>
      )}
      {!result && meta && <p data-outbound-meta className="text-[12px] text-ink-secondary">{meta}</p>}
      {!result && hasDetails && (
        <div>
          <button type="button" data-outbound-details aria-expanded={details} onClick={() => setDetails((open) => !open)}
            className="inline-flex items-center gap-1 rounded-md text-[12px] text-ink-secondary hover:text-ink">
            {details ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
            {t("outbound.call.details")}
          </button>
          {details && (
            <div className="mt-1.5 space-y-2">
              {card.instructions?.trim() && (
                <div>
                  <p className="text-[12px] text-ink-secondary">{t("outbound.call.instructions")}</p>
                  <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-hairline/60 pl-2 text-[12.5px]">{card.instructions}</blockquote>
                </div>
              )}
              {card.voicemail?.trim() && (
                <div>
                  <p className="text-[12px] text-ink-secondary">{t("outbound.call.voicemail")}</p>
                  <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-hairline/60 pl-2 text-[12.5px]">{card.voicemail}</blockquote>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {card.callback && !result && <p className="text-[12px] text-ink-secondary">{t("outbound.call.callback", { number: card.callback })}</p>}
      {status === "pending" && <p className="text-[12px] text-ink-secondary">{t("outbound.call.conversation.disclosure", { bot: card.botName })}</p>}
      {result && <CallResult result={result} botName={card.botName} initialOpen={transcriptOpen} />}
    </>
  );
}

function CallResult({ result, botName, initialOpen }: { result: OutboundCallResult; botName: string; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const outcome = OUTCOME_LABEL[result.outcome] ? result.outcome : "voicemail";
  const transcript = result.transcript ?? [];
  const points = result.points.filter((point) => point.trim());
  const commitments = result.commitments.filter((item) => item.trim());
  return (
    <div data-outbound-result={result.outcome} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span data-outbound-outcome className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${OUTCOME_TONE[outcome]}`}>{outcomeLabel(result)}</span>
        <span className="text-[12px] text-ink-secondary">{t("outbound.call.duration", { duration: formatCallDuration(result.durationSec) })}</span>
      </div>
      {result.doNotCallAgain && (
        <p role="note" data-outbound-dnc className="rounded-lg bg-warning/10 px-2 py-1.5 text-[12px] text-warning">{t("outbound.call.doNotCallAgain", { bot: botName })}</p>
      )}
      {points.length > 0 && (
        <div>
          <p className="text-[12px] text-ink-secondary">{t("outbound.call.summary")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px]">
            {points.map((point, index) => <li key={index} className="whitespace-pre-wrap">{point}</li>)}
          </ul>
        </div>
      )}
      {commitments.length > 0 && (
        <div data-outbound-commitments>
          <p className="text-[12px] text-ink-secondary">{t("outbound.call.commitments")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px]">
            {commitments.map((item, index) => <li key={index} className="whitespace-pre-wrap">{item}</li>)}
          </ul>
        </div>
      )}
      {result.transcriptExpired ? (
        <p data-outbound-transcript-expired className="text-[12px] text-ink-tertiary">{t("outbound.call.transcriptExpired")}</p>
      ) : transcript.length > 0 && (
        <div>
          <button type="button" data-outbound-transcript-toggle aria-expanded={open} onClick={() => setOpen((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md text-[12px] text-ink-secondary hover:text-ink">
            {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
            {open ? t("outbound.call.hideTranscript") : t("outbound.call.showTranscript")}
          </button>
          {open && (
            <div data-outbound-transcript className="mt-1.5 max-h-72 space-y-1.5 overflow-auto rounded-lg bg-inset px-3 py-2 text-[12.5px]">
              {transcript.map((line, index) => (
                <p key={index} className="whitespace-pre-wrap break-words">
                  <span className={line.speaker === "bot" ? "font-medium text-accent" : "font-medium text-ink-secondary"}>
                    {line.speaker === "bot" ? botName : t("outbound.call.otherParty")}
                  </span>
                  {" "}{line.text}
                </p>
              ))}
              {result.truncated && <p className="text-[12px] text-ink-tertiary">{t("outbound.call.truncated")}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STEP_KEY: Record<OrderStep, LocaleKey> = {
  ordered: "outbound.tracking.step.ordered",
  shipped: "outbound.tracking.step.shipped",
  in_transit: "outbound.tracking.step.inTransit",
  out_for_delivery: "outbound.tracking.step.outForDelivery",
  delivered: "outbound.tracking.step.delivered",
  exception: "outbound.tracking.step.exception",
};

/** Where the parcel is: four steps (ordered, shipped, out for delivery,
 * delivered), the carrier and its number, the expected day, the tracking
 * page. As the bot declared it; a problem shows in the warning ink. */
export function OrderTrackingView({ tracking }: { tracking: OrderTracking }) {
  const at = orderStepIndex(tracking.step);
  const problem = tracking.step === "exception";
  const carrier = [tracking.carrier, tracking.number].filter(Boolean).join(" · ");
  return (
    <section data-order-tracking={tracking.step} aria-label={t("outbound.tracking.title")} className="space-y-2 rounded-lg bg-raised/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
        {problem ? <TriangleAlert size={13} aria-hidden="true" className="text-warning" /> : <Truck size={13} aria-hidden="true" className="text-ink-secondary" />}
        <span className={cn("min-w-0 flex-1 truncate", problem && "text-warning")}>{t(STEP_KEY[tracking.step])}</span>
        {tracking.eta && tracking.step !== "delivered" && <span className="shrink-0 text-ink-secondary">{t("outbound.tracking.eta", { date: formatDay(tracking.eta) })}</span>}
      </div>
      <ol className="grid grid-cols-4 gap-1" aria-label={t("outbound.tracking.progress")}>
        {ORDER_STEPPER.map((step, index) => {
          const reached = !problem && index <= at;
          return (
            <li key={step} aria-current={!problem && index === at ? "step" : undefined} className="min-w-0">
              <span aria-hidden="true" className={cn("block h-1 rounded-full", reached ? "bg-success" : "bg-ink/10")} />
              <span className={cn("mt-1 block truncate text-[11px]", reached ? "text-ink" : "text-ink-tertiary")}>{t(STEP_KEY[step])}</span>
            </li>
          );
        })}
      </ol>
      {(carrier || tracking.note) && (
        <p className="text-[12px] text-ink-secondary">{[carrier, tracking.note].filter(Boolean).join(" · ")}</p>
      )}
      {tracking.url && (
        <button type="button" data-order-tracking-link onClick={() => void openExternalLink(tracking.url!).catch(() => undefined)} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-text hover:underline">
          {t("outbound.tracking.open")}<ExternalLink size={12} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat(activeLocale(), { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, day!)));
  } catch {
    return iso;
  }
}
