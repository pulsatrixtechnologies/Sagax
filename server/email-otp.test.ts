import { describe, expect, it } from "vitest";
import { EmailOtpStore, OTP_TTL_MS, OTP_SEND_WINDOW_MS } from "./email-otp.ts";

function store(start = 1_000) {
  let clock = start;
  let n = 0;
  const codes = ["12345678", "87654321", "11112222", "33334444", "55556666"];
  const s = new EmailOtpStore({ now: () => clock, random: () => codes[n++ % codes.length]! });
  return { s, tick: (ms: number) => { clock += ms; } };
}

describe("email one-time codes", () => {
  it("accepts the code once, for that address only", () => {
    const { s } = store();
    const issued = s.issue("Zach@Gox.ca", "10.0.0.1");
    expect(issued).toEqual({ ok: true, code: "12345678" });
    expect(s.verify("other@gox.ca", "12345678").ok).toBe(false);
    expect(s.verify("zach@gox.ca", "12345678")).toEqual({ ok: true });
    expect(s.verify("zach@gox.ca", "12345678").ok).toBe(false);
  });

  it("expires after ten minutes", () => {
    const { s, tick } = store();
    s.issue("zach@gox.ca", "src");
    tick(OTP_TTL_MS + 1);
    expect(s.verify("zach@gox.ca", "12345678")).toMatchObject({ ok: false, status: 401 });
  });

  it("burns the code after five wrong tries", () => {
    const { s } = store();
    s.issue("zach@gox.ca", "src");
    for (let i = 0; i < 5; i++) expect(s.verify("zach@gox.ca", "00000000").ok).toBe(false);
    expect(s.verify("zach@gox.ca", "12345678")).toMatchObject({ ok: false });
  });

  it("refuses a malformed code without counting it as a guess", () => {
    const { s } = store();
    s.issue("zach@gox.ca", "src");
    expect(s.verify("zach@gox.ca", "12ab")).toMatchObject({ ok: false, status: 400 });
    expect(s.verify("zach@gox.ca", "12345678")).toEqual({ ok: true });
  });

  it("limits sends per address and per source", () => {
    const { s, tick } = store();
    for (let i = 0; i < 3; i++) expect(s.issue("zach@gox.ca", `s${i}`).ok).toBe(true);
    expect(s.issue("zach@gox.ca", "s9")).toMatchObject({ ok: false, status: 429 });
    for (let i = 0; i < 10; i++) s.issue(`p${i}@gox.ca`, "office");
    expect(s.issue("p99@gox.ca", "office")).toMatchObject({ ok: false, status: 429 });
    tick(15 * 60_000 + 1);
    expect(s.issue("zach@gox.ca", "s10").ok).toBe(true);
  });

  it("keeps only the newest code for an address", () => {
    const { s } = store();
    s.issue("zach@gox.ca", "a");
    s.issue("zach@gox.ca", "b");
    expect(s.verify("zach@gox.ca", "12345678").ok).toBe(false);
    expect(s.verify("zach@gox.ca", "87654321")).toEqual({ ok: true });
  });

  it("does not charge address quota when source is full", () => {
    const { s } = store();
    // Fill the source bucket
    for (let i = 0; i < 10; i++) s.issue(`p${i}@gox.ca`, "office");
    // Source is now full; attempt from a new address should not consume its quota
    expect(s.issue("zach@gox.ca", "office")).toMatchObject({ ok: false, status: 429 });
    // Another attempt from different source should succeed
    expect(s.issue("zach@gox.ca", "other").ok).toBe(true);
  });

  it("sweeps expired pending codes and cleans empty buckets", () => {
    const { s, tick } = store();
    // Issue a code
    s.issue("zach@gox.ca", "src");
    let sizes = s.size();
    expect(sizes.pending).toBe(1);
    expect(sizes.buckets).toBeGreaterThan(0);

    // Tick past expiry for both TTL and send window
    tick(OTP_TTL_MS + OTP_SEND_WINDOW_MS + 1);

    // Issue another code to trigger sweep
    s.issue("other@gox.ca", "src");

    // Old pending should be gone, new one exists
    sizes = s.size();
    expect(sizes.pending).toBe(1);
    // After cleanup, buckets should be smaller or zero
    expect(sizes.buckets).toBeLessThanOrEqual(2);
  });

  it("refuses to issue when tracking cap is reached", () => {
    let clock = 1_000;
    let n = 0;
    const codes = ["12345678", "87654321", "11112222", "33334444", "55556666"];
    const s = new EmailOtpStore({
      now: () => clock,
      random: () => codes[n++ % codes.length]!,
      maxTracked: 3
    });

    // Issue codes for 3 distinct addresses from 3 distinct sources
    expect(s.issue("user1@gox.ca", "src1").ok).toBe(true);
    expect(s.issue("user2@gox.ca", "src2").ok).toBe(true);
    expect(s.issue("user3@gox.ca", "src3").ok).toBe(true);
    expect(s.size().pending).toBe(3);

    // 4th attempt should be refused (cap reached)
    expect(s.issue("user4@gox.ca", "src4")).toMatchObject({ ok: false, status: 429 });
    expect(s.size().pending).toBe(3);

    // After TTL passes, sweep frees the slots
    clock += OTP_TTL_MS + 1;
    expect(s.issue("user5@gox.ca", "src5").ok).toBe(true);
    expect(s.size().pending).toBe(1); // Old ones expired, only the new one
  });
});
