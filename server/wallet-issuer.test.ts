// A fake wallet CLI only: no real wallet, no network, nothing charged.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cliWalletIssuer, minorUnits, spendContext, type CommandRunner } from "./wallet-issuer.ts";

// Stripe's documented test number for one-time cards: not a real card.
const TEST_PAN = "4000009990001984";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-wallet-test-"));
  dirs.push(dir);
  return dir;
};
const request = { purchaseId: "pay_0123456789abcdef", merchant: "Cafe", domain: "shop.example.test", amount: "12.50", currency: "CAD" };

function fakeCli(statuses: string[]): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CommandRunner = async (_bin, args) => {
    calls.push(args);
    if (args[0] === "auth") return JSON.stringify({ authenticated: true });
    if (args[1] === "create") return JSON.stringify({ id: "lsrq_001", status: "pending_approval" });
    if (args.includes("--include")) {
      const file = args[args.indexOf("--output-file") + 1]!;
      writeFileSync(file, JSON.stringify({ card: { number: TEST_PAN, cvc: "123", exp_month: 4, exp_year: 2031, billing_address: { name: "Ada Lovelace" } } }), { mode: 0o600 });
      return JSON.stringify({ id: "lsrq_001", status: "approved", card: { brand: "visa", last4: "1984" }, card_output_file: file });
    }
    return JSON.stringify({ id: "lsrq_001", status: statuses.shift() ?? "approved" });
  };
  return { run, calls };
}

describe("wallet issuer", () => {
  it("converts amounts to minor units and writes enough context", () => {
    expect(minorUnits("12.50", "CAD")).toBe(1250);
    expect(minorUnits("1200.00", "JPY")).toBe(1200);
    expect(minorUnits("12.5", "CAD")).toBeNull();
    expect(spendContext(request).length).toBeGreaterThanOrEqual(100);
    expect(spendContext({ ...request, merchant: `Cafe ${TEST_PAN}` })).not.toContain(TEST_PAN);
  });

  it("opens one spend request, waits for the person's approval, reads the card from the 0600 file", async () => {
    const cli = fakeCli(["pending_approval", "approved"]);
    const issuer = cliWalletIssuer({ run: cli.run, findBin: () => "/fake/link-cli", tempDir, approvalWaitMs: 4_000 });
    expect(await issuer.status("link", "local")).toEqual({ installed: true, signedIn: true });
    const first = await issuer.issue("link", "local", request);
    expect(first).toMatchObject({ ok: false, code: "waiting" });
    const second = await issuer.issue("link", "local", request);
    expect(second).toEqual({ ok: true, card: { pan: TEST_PAN, cvc: "123", expMonth: 4, expYear: 2031, holder: "Ada Lovelace" } });
    const creates = cli.calls.filter((args) => args[1] === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual(expect.arrayContaining(["--amount", "1250", "--currency", "cad", "--merchant-url", "https://shop.example.test", "--request-approval"]));
    // the card is never asked on stdout: only into a file
    const reads = cli.calls.filter((args) => args.includes("--include"));
    expect(reads[0]).toEqual(expect.arrayContaining(["--output-file"]));
  });

  it("says provider_unconfigured when the tool is not installed, declined when refused", async () => {
    const missing = cliWalletIssuer({ findBin: () => null });
    expect(await missing.issue("shop_pay", "local", request)).toMatchObject({ ok: false, code: "provider_unconfigured" });
    expect(await missing.status("shop_pay", "local")).toEqual({ installed: false, signedIn: false });
    const cli = fakeCli(["denied"]);
    const issuer = cliWalletIssuer({ run: cli.run, findBin: () => "/fake/shop", tempDir, approvalWaitMs: 2_000 });
    expect(await issuer.issue("shop_pay", "person-1", request)).toMatchObject({ ok: false, code: "declined" });
  });

  it("passes a person's own session file on an organization server", async () => {
    const cli = fakeCli([]);
    const issuer = cliWalletIssuer({ run: cli.run, findBin: () => "/fake/link-cli", authFile: (_wallet, person) => `/data/${person}/link-wallet-auth.json`, tempDir });
    await issuer.status("link", "person-1");
    expect(cli.calls[0]).toEqual(expect.arrayContaining(["--auth", "/data/person-1/link-wallet-auth.json"]));
  });
});
