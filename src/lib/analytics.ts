// Usage measure, off until the person turns it on in Settings. Events go
// only to this Sagax server (/api/me/usage-meter), never to another host.
// The schema is closed (shared/usage-meter.ts): a name or a property outside
// it is dropped, and an event has no person name. While the switch is off,
// track() does not call the network.
import { USAGE_EVENTS, usageEvent, usageProps, type UsageEventName } from "../../shared/usage-meter";

let enabled = false;

/** Whether this page may record usage. False until Settings has been read and the person has turned it on. */
export function usageMeterEnabled(): boolean {
  return enabled;
}

/** Reads the person's switch. A failure leaves the measure off. */
export function initAnalytics(): Promise<void> {
  return fetch("/api/me/usage-meter", { headers: { accept: "application/json" } })
    .then((res) => res.ok ? res.json() as Promise<{ enabled?: unknown }> : null)
    .then((body) => { enabled = body?.enabled === true; })
    .catch(() => { enabled = false; });
}

/** The Settings switch. Nothing is recorded until this returns true. */
export async function setUsageMeterEnabled(on: boolean): Promise<boolean> {
  const res = await fetch("/api/me/usage-meter", {
    method: "PUT",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ enabled: on }),
  });
  if (!res.ok) return enabled;
  const body = await res.json() as { enabled?: unknown };
  enabled = body.enabled === true;
  return enabled;
}

/** Records one closed event on this server when the measure is on. Off: no request. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!enabled) return;
  if (!(USAGE_EVENTS as readonly string[]).includes(event)) return;
  const name = event as UsageEventName;
  const clean = usageEvent(name, usageProps(name, props));
  if (!clean) return;
  void fetch("/api/me/usage-meter/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(clean),
  }).catch(() => {});
}

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
