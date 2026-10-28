import { describe, expect, it } from "vitest";

import { requestSingleUseToken, walletLinkView, walletMissing } from "./single-use-card.ts";

// Fictional. The well-known test number, not a real card.
const PAN = "4242424242424242";
const SPACED = "4242 4242 4242 4242";
const DASHED = "4242-4242-4242-4242";

function blob(value: unknown): string {
  return JSON.stringify(value);
}

describe("one-time card contract", () => {
  it("keeps a card number out of the prompt and the journal", () => {
    const exchanged = requestSingleUseToken({
      wallet: "link",
      chosen: true,
      approval: "once",
      merchant: `Cafe ${SPACED}`,
      amount: "12.50",
      currency: "CAD",
      detail: `memo ${PAN} ${DASHED}`,
      token: PAN,
    });
    const text = blob(exchanged);
    expect(text).not.toContain(PAN);
    expect(text).not.toContain(SPACED);
    expect(text).not.toContain(DASHED);
    expect(text).not.toContain("42424242");
    expect(exchanged.charged).toBe(false);
    expect(exchanged.sent).toBe(false);
    expect(exchanged.code).toBe("number_refused");
    expect(exchanged.prompt).toContain("Nothing was charged");
    expect(exchanged.prompt).toContain("@stripe/link-cli");
    expect(exchanged.journal).not.toMatch(/\d{13,19}/);
    expect(exchanged.prompt).not.toMatch(/\d(?:[\s.\-_/]*\d){12,18}/);
  });

  it("does not treat a missing wallet session as a successful payment", () => {
    const shop = requestSingleUseToken({
      wallet: "shop_pay", chosen: true, approval: "once", merchant: "Example Shop", amount: "9.00", currency: "CAD",
    });
    expect(shop).toMatchObject({ charged: false, sent: false, code: "provider_unconfigured" });
    expect(shop.prompt).toContain("shop CLI");
    expect(shop.prompt).toContain("shop spend-request create");
    expect(shop.prompt).toContain("LINK_API_BASE_URL");
    expect(shop.prompt).not.toMatch(/https?:/);
    const link = requestSingleUseToken({
      wallet: "link", chosen: true, approval: "once", merchant: "Example Shop", amount: "9.00", currency: "CAD",
    });
    expect(link.code).toBe("provider_unconfigured");
    expect(link.prompt).toContain("link-cli spend-request create");
    expect(link.prompt).toContain("no server key");
    const claimed = requestSingleUseToken({
      wallet: "link", chosen: true, approval: "once", merchant: "Example Shop", amount: "9.00", currency: "CAD", token: "spt_opaque_value",
    });
    expect(claimed.code).toBe("provider_unconfigured");
    expect(blob(claimed)).not.toContain("spt_opaque_value");
  });

  it("keeps the existing approval in front of any send, and refuses another wallet", () => {
    const pending = requestSingleUseToken({ wallet: "shop_pay", chosen: true, approval: "pending", merchant: "Shop", amount: "1.00", currency: "CAD" });
    expect(pending).toMatchObject({ code: "approval_required", sent: false, charged: false });
    const always = requestSingleUseToken({ wallet: "link", chosen: true, approval: "always", merchant: "Shop", amount: "1.00", currency: "CAD" });
    expect(always.code).toBe("approval_required");
    expect(always.sent).toBe(false);
    const declined = requestSingleUseToken({ wallet: "link", chosen: true, approval: "deny", merchant: "Shop", amount: "1.00", currency: "CAD" });
    expect(declined.code).toBe("declined");
    const loose = requestSingleUseToken({ wallet: "other_wallet", chosen: true, approval: "once", merchant: `Shop ${PAN}`, detail: PAN, token: "tok_not_a_card" });
    expect(loose.code).toBe("unknown_wallet");
    expect(blob(loose)).not.toContain(PAN);
    expect(blob(loose)).not.toContain("tok_not_a_card");
    const unlinked = requestSingleUseToken({ wallet: PAN, chosen: false, approval: "once", merchant: "Shop" });
    expect(unlinked.code).toBe("unknown_wallet");
    expect(blob(unlinked)).not.toContain(PAN);
    const notChosen = requestSingleUseToken({ wallet: "shop_pay", chosen: false, approval: "once", merchant: "Shop", amount: "3.00", currency: "CAD" });
    expect(notChosen).toMatchObject({ code: "not_connected", sent: false, charged: false });
  });

  it("names the missing CLI and session, and never a live token", () => {
    const view = walletLinkView({ link: { chosen: true } });
    expect(view.link).toMatchObject({ chosen: true, ready: false });
    expect(view.shop_pay).toMatchObject({ chosen: false, ready: false });
    expect(view.link.missing).toBe(walletMissing("link"));
    expect(view.shop_pay.missing).toContain("shop spend-request create");
    expect(blob(view)).not.toMatch(/\d{13,19}/);
    expect(blob(walletLinkView(undefined))).not.toContain("true\", \"ready\": true");
  });
});
