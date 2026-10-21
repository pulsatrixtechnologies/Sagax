import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { vaultHandle } from "../shared/credential-vault.ts";
import { luhnOk, purchaseCardText } from "../shared/payment-vault.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";

// Fictional payment values. 4242... is the well-known test number, not a real card.
const PAN = "4242424242424242";
const CVV = "123";
const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 4) };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function vault(now = () => 1_700_000_000_000) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-pay-"));
  dirs.push(dir);
  return new CredentialVault(dir, () => KEY, now);
}

const card = {
  kind: "card" as const,
  name: "Shop card",
  card: { pan: PAN, cvv: CVV, expMonth: 12, expYear: 2030, holder: "Ada Lovelace" },
};
const address = {
  kind: "address" as const,
  name: "Home",
  address: { recipient: "Ada Lovelace", line1: "1 Rue des Tests", city: "Montreal", region: "QC", postal: "H2X 1Y4", country: "CA" },
};

describe("payment vault", () => {
  it("rejects a number that fails Luhn and never stores it", () => {
    expect(luhnOk(PAN)).toBe(true);
    expect(luhnOk("4242424242424241")).toBe(false);
    const store = vault();
    expect(() => store.create(LOCAL_VAULT_PRINCIPAL, { ...card, card: { ...card.card, pan: "4242424242424241" } })).toThrow(/not valid/);
    expect(store.list(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
  });

  it("lists the last four and never the number or the code", () => {
    const store = vault();
    const created = store.create(LOCAL_VAULT_PRINCIPAL, card);
    expect(created.card).toEqual({ brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, holder: "Ada Lovelace" });
    expect(JSON.stringify(created)).not.toContain(PAN);
    expect(JSON.stringify(created)).not.toContain(CVV);
    expect(store.reveal(LOCAL_VAULT_PRINCIPAL, created.id, "pan")).toBe(PAN);
    expect(store.reveal(LOCAL_VAULT_PRINCIPAL, created.id, "cvv")).toBe(CVV);
    const raw = readFileSync(join(dirs[0]!, "credential-vault.enc"), "utf8");
    expect(raw).not.toContain(PAN);
    expect(raw).not.toContain(CVV);
  });

  it("fills a card only after the person allows the purchase, and only on that site", async () => {
    const store = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const home = store.create(LOCAL_VAULT_PRINCIPAL, address);
    const page = "https://shop.example.test/pay";
    const asked = store.openPurchase(LOCAL_VAULT_PRINCIPAL, {
      botId: "bot-a", threadId: "thread-1", merchant: "Example Shop", pageUrl: page,
      amount: "12.5", currency: "cad", cardId: saved.id, addressId: home.id,
    });
    expect(asked.already).toBe(false);
    expect(asked.listing.title).toBe("Pay 12.50 CAD to Example Shop?");
    expect(asked.note).not.toContain(PAN);
    expect(JSON.stringify(asked.listing)).not.toContain(PAN);
    const blocked = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, {
      handle: vaultHandle(saved.id), field: "cardNumber", botId: "bot-a", threadId: "thread-1", pageUrl: page,
    });
    expect(blocked.ok).toBe(false);
    const answered = store.answerPurchase(LOCAL_VAULT_PRINCIPAL, asked.listing.id, "once", "Melonie");
    expect(answered.listing.via).toBe("Melonie");
    expect(answered.note).toContain(vaultHandle(saved.id));
    expect(answered.note).not.toContain(PAN);
    const filled = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, {
      handle: vaultHandle(saved.id), field: "cardNumber", botId: "bot-a", threadId: "thread-1", pageUrl: page,
    });
    expect(filled.ok && filled.value).toBe(PAN);
    const otherSite = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, {
      handle: vaultHandle(saved.id), field: "cardNumber", botId: "bot-a", threadId: "thread-1", pageUrl: "https://evil.example/pay",
    });
    expect(otherSite.ok).toBe(false);
    const street = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, {
      handle: vaultHandle(home.id), field: "addressLine1", botId: "bot-a", threadId: "thread-1", pageUrl: page,
    });
    expect(street.ok && street.value).toBe("1 Rue des Tests");
    expect(purchaseCardText({ merchant: "Example Shop", amount: "12.50", currency: "CAD", last4: "4242", brand: "visa" }).line).not.toContain(PAN);
  });

  it("keeps an always grant and does not ask again", () => {
    const store = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const page = "https://shop.example.test/pay";
    const asked = store.openPurchase(LOCAL_VAULT_PRINCIPAL, {
      botId: "bot-a", threadId: "thread-1", pageUrl: page, amount: "4", currency: "USD", cardId: saved.id,
    });
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, asked.listing.id, "always");
    const again = store.openPurchase(LOCAL_VAULT_PRINCIPAL, {
      botId: "bot-a", threadId: "thread-2", pageUrl: page, amount: "4", currency: "USD", cardId: saved.id,
    });
    expect(again.already).toBe(true);
    expect(store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
  });
});
