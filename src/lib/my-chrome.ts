// My Chrome on the client: the status the server sends (server/routes/my-chrome.ts)
// and the calls that change it. Every call is a POST: on the desktop a loopback
// change needs the app's own capability, so no other local process reads it.
import { api } from "@/state/store";
import type { TeachReplay, TeachStep } from "../../shared/teach-recording";

export const MY_CHROME_PROFILE = "my-chrome";

export interface MyChromeStatus {
  offered: boolean;
  enabled: boolean;
  stopped: boolean;
  sites: Array<{ origin: string; addedAt: number }>;
  chromeAddress: string;
  unavailable: string | null;
  connected: boolean;
  lastActionAt: number;
  /** Bots with a terminal on this computer: they keep their own browser. */
  shellBotIds: string[];
  driving: Array<{ botId: string; botName: string; tabs: Array<{ url: string; title: string }> }>;
}

export function myChromeCall(action: "status" | "enable" | "sites" | "sites/revoke" | "address" | "stop" | "resume", body: Record<string, unknown> = {}): Promise<MyChromeStatus> {
  return api<MyChromeStatus>(`/api/my-chrome/${action}`, { method: "POST", body: JSON.stringify(body) });
}

/** The origin of a tab, for a short label; the URL itself when it has none. */
export function tabOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}

/** Status changed in this window (Settings or the banner): listeners read it again now. */
export const MY_CHROME_CHANGED = "sagax:my-chrome-changed";

export function announceMyChrome(status: MyChromeStatus): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<MyChromeStatus>(MY_CHROME_CHANGED, { detail: status }));
}

/** Show a task in my Chrome (server/browser/my-chrome/recorder.ts): a
 * recording in a new tab of the person's Chrome, as it runs. */
export interface MyChromeRecording {
  recording: boolean;
  startedAt: string;
  steps: number;
  recent: TeachStep[];
  ended: "person" | "tab" | "closed" | "stopped" | "idle" | null;
}

export interface MyChromeRecordingResult {
  steps: TeachStep[];
  recordedAt: string;
  replay: TeachReplay;
  ended: MyChromeRecording["ended"];
}

export function myChromeRecord(action: "start", body: { url?: string }): Promise<{ recording: MyChromeRecording }>;
export function myChromeRecord(action: "status"): Promise<{ recording: MyChromeRecording | null; unavailable: string | null }>;
export function myChromeRecord(action: "note", body: { text: string }): Promise<{ recording: MyChromeRecording | null }>;
export function myChromeRecord(action: "stop"): Promise<{ result: MyChromeRecordingResult | null }>;
export function myChromeRecord(action: "discard"): Promise<{ ok: true }>;
export function myChromeRecord(action: string, body: Record<string, unknown> = {}): Promise<unknown> {
  return api(`/api/my-chrome/record/${action}`, { method: "POST", body: JSON.stringify(body) });
}
