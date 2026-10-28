// One-time card for a purchase. The person connects a wallet they already
// have: Shop Pay or Link. Sagax asks that wallet for a one-time token only
// after the existing purchase approval. This build ships neither CLI and
// holds no session, so the ask never becomes a charge and never returns a
// card number. A number never enters the prompt or the journal.
//
// Still missing, names only (no secret is read or stored):
//   Shop Pay: shop CLI, `shop spend-request create`, and the person's own
//     Shop Pay session. LINK_API_BASE_URL and LINK_AUTH_BASE_URL are the
//     documented names for pointing that CLI at Shop Pay. Sagax does not
//     set them.
//   Link: @stripe/link-cli, `link-cli spend-request create`, and the
//     person's own Link session. There is no server key to add.

export const SINGLE_USE_WALLETS = ["shop_pay", "link"] as const;
export type SingleUseWallet = (typeof SINGLE_USE_WALLETS)[number];

export function isSingleUseWallet(value: unknown): value is SingleUseWallet {
  return value === "shop_pay" || value === "link";
}

/** What is still missing before a live token can be asked. Names only. */
export const SINGLE_USE_GAP = {
  shop_pay: {
    wallet: "Shop Pay",
    sdk: "shop CLI",
    command: "shop spend-request create",
    session: "the Shop Pay account the person already has",
    key: "LINK_API_BASE_URL and LINK_AUTH_BASE_URL are unset",
  },
  link: {
    wallet: "Link",
    sdk: "@stripe/link-cli",
    command: "link-cli spend-request create",
    session: "the Link account the person already has",
    key: "no server key; the Link session is missing",
  },
} as const;

export type SingleUseCode =
  | "unknown_wallet"
  | "not_connected"
  | "approval_required"
  | "declined"
  | "provider_unconfigured"
  | "number_refused";

export interface SingleUseExchange {
  /** This build never charges. A token is not a completed payment. */
  charged: false;
  /** A token would leave only after approval, and only from the wallet. */
  sent: false;
  code: SingleUseCode;
  prompt: string;
  journal: string;
}

export interface WalletLinkState {
  chosen: boolean;
  /** Live session. False until the missing CLI and session exist. */
  ready: false;
  missing: string;
}

export type WalletLinkView = Record<SingleUseWallet, WalletLinkState>;

const CARD_RUN = /(?:\d[\s.\-_/]*){13,19}/;

/** Drop a card-like run. The replacement is not a number. */
export function redactCardNumbers(text: string): string {
  return text.replace(new RegExp(CARD_RUN.source, "g"), "[card]");
}

function hasCardNumber(text: string): boolean {
  return new RegExp(CARD_RUN.source).test(text);
}

export function walletName(wallet: SingleUseWallet): string {
  return SINGLE_USE_GAP[wallet].wallet;
}

export function walletMissing(wallet: SingleUseWallet): string {
  const gap = SINGLE_USE_GAP[wallet];
  return `${gap.sdk} (${gap.command}). ${gap.key}. ${gap.session} is not connected.`;
}

export function walletLinkView(stored: Partial<Record<SingleUseWallet, { chosen: true }>> | undefined): WalletLinkView {
  return {
    shop_pay: { chosen: stored?.shop_pay?.chosen === true, ready: false, missing: walletMissing("shop_pay") },
    link: { chosen: stored?.link?.chosen === true, ready: false, missing: walletMissing("link") },
  };
}

function safePiece(value: unknown, max: number, fallback: string): string {
  const text = typeof value === "string" ? redactCardNumbers(value).replace(/\[card\]/g, " ") : "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
}

function gapSentence(wallet: SingleUseWallet): string {
  const gap = SINGLE_USE_GAP[wallet];
  return `${gap.wallet} did not return a one-time card. Missing: ${gap.sdk} (${gap.command}). ${gap.key}. Nothing was charged.`;
}

/** Ask the connected wallet for a one-time token. Never a successful charge.
 * A caller-supplied token is ignored. A card number is not copied out. */
export function requestSingleUseToken(input: {
  wallet: unknown;
  chosen: boolean;
  approval: unknown;
  merchant?: unknown;
  amount?: unknown;
  currency?: unknown;
  /** Text a caller tried to put in the prompt or the journal. */
  detail?: unknown;
  /** A value someone claims is a token. Never accepted, never copied. */
  token?: unknown;
}): SingleUseExchange {
  const merchant = safePiece(input.merchant, 80, "the shop");
  const amount = safePiece(input.amount, 16, "");
  const currency = safePiece(input.currency, 8, "");
  const detail = typeof input.detail === "string" ? input.detail : "";
  const finish = (code: SingleUseCode, prompt: string): SingleUseExchange => {
    const approval = typeof input.approval === "string" ? input.approval : "none";
    const journal = redactCardNumbers([
      "single-use",
      isSingleUseWallet(input.wallet) ? input.wallet : "refused",
      merchant,
      amount,
      currency,
      `approval=${redactCardNumbers(approval)}`,
      `result=${code}`,
      "charged=false",
      "sent=false",
      detail,
    ].filter(Boolean).join(" "));
    return { charged: false, sent: false, code, prompt: redactCardNumbers(prompt), journal };
  };

  if (!isSingleUseWallet(input.wallet)) {
    return finish("unknown_wallet", "Sagax purchase update: that wallet is not Shop Pay or Link. Nothing was asked or charged. Do not type a card number.");
  }
  const name = walletName(input.wallet);
  if (!input.chosen) {
    return finish("not_connected", `Sagax purchase update: ${name} is not connected. The person connects the ${name} account they already have in Settings. Nothing was charged. Do not type a card number.`);
  }
  if (input.approval === "deny") {
    return finish("declined", `Sagax purchase update: the person declined to pay ${amount} ${currency} at ${merchant} with ${name}. Do not ask for a card number. Nothing was charged.`);
  }
  if (input.approval !== "once") {
    return finish("approval_required", `Sagax purchase update: Pay ${amount} ${currency} at ${merchant} with ${name}? A one-time card is asked only after the person allows this purchase. Nothing was charged. You never receive a card number.`);
  }
  if (typeof input.token === "string" && hasCardNumber(input.token)) {
    return finish("number_refused", `Sagax purchase update: a card number is not a one-time token. ${gapSentence(input.wallet)} Do not type a card number.`);
  }
  return finish("provider_unconfigured", `Sagax purchase update: the person allowed the payment of ${amount} ${currency} at ${merchant} this time. ${gapSentence(input.wallet)} Do not type a card number. The next payment asks again.`);
}
