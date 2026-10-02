// Sagax sends no usage analytics. The inherited PostHog client was removed:
// nothing here opens a connection, and track()/identifyEmail() are kept as
// no-ops only so call sites stay unchanged. Do not add a network call here;
// scripts/check-no-phone-home.mjs fails the build if a tracking host or SDK
// lands in a bundle.

/** Kept for call sites; never sends anything. */
export function initAnalytics(): void {}

/** Kept for call sites; never sends anything. */
export function track(_event: string, _props?: Record<string, unknown>): void {}

/** Kept for call sites; the address stays in the local profile only. */
export function identifyEmail(_email: string): void {}

// first-run email gate state (local only)
const GATE_KEY = "omb-email-gate";
export function emailGateDone(): boolean {
  return Boolean(localStorage.getItem(GATE_KEY));
}
export function setEmailGateDone(status: "submitted" | "skipped") {
  localStorage.setItem(GATE_KEY, status);
}
