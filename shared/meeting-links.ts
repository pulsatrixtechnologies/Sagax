// Meeting links a bot may be asked to join as a notetaker
// (docs/superpowers/specs/2026-10-16-meetings-and-maintenance.md).
// Recognition is a strict host allowlist: a link that only looks like a
// meeting (another host, a credential in the URL, a non-https scheme) is no
// meeting link at all.

export type MeetingProvider = "google-meet" | "zoom" | "teams";

export interface MeetingLink {
  provider: MeetingProvider;
  /** The normalized https URL the bot opens. */
  url: string;
  /** Meeting code or id, for display (abc-defg-hij, 123456789). */
  code: string;
}

/** Providers whose join flow ships today. Zoom and Teams links are
 * recognized, and the card says they are not supported yet. */
export const SUPPORTED_MEETING_PROVIDERS: ReadonlySet<MeetingProvider> = new Set(["google-meet"]);

export const MEETING_PROVIDER_LABELS: Readonly<Record<MeetingProvider, string>> = {
  "google-meet": "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
};

const MEET_CODE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/;
const ZOOM_JOIN = /^\/(?:j|wc\/join|wc|s)\/(\d{9,11})(?:\/join)?\/?$/;

function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/** One meeting link from one URL string, or null. */
export function parseMeetingUrl(raw: string): MeetingLink | null {
  if (raw.length > 2_048) return null;
  const url = parseUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (host === "meet.google.com") {
    const match = url.pathname.toLowerCase().match(MEET_CODE);
    if (!match) return null;
    // Only the code is kept: query strings (authuser, hs) carry nothing the
    // guest join needs.
    return { provider: "google-meet", url: `https://meet.google.com/${match[1]}`, code: match[1]! };
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    const match = url.pathname.match(ZOOM_JOIN);
    if (!match) return null;
    const pwd = url.searchParams.get("pwd");
    const safePwd = pwd && /^[A-Za-z0-9._-]{1,128}$/.test(pwd) ? `?pwd=${pwd}` : "";
    return { provider: "zoom", url: `https://${host}/j/${match[1]}${safePwd}`, code: match[1]! };
  }
  if (host === "teams.microsoft.com" || host === "teams.live.com") {
    if (!/^\/(?:l\/meetup-join\/|meet\/)/.test(url.pathname)) return null;
    const code = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return { provider: "teams", url: url.toString(), code: decodeURIComponent(code).slice(0, 40) };
  }
  return null;
}

/** The first meeting link in free text (a message, an event body). */
export function findMeetingLink(text: string): MeetingLink | null {
  for (const match of text.matchAll(/https:\/\/[^\s<>"'()]+/g)) {
    const link = parseMeetingUrl(match[0].replace(/[.,;:!?]+$/, ""));
    if (link) return link;
  }
  return null;
}

/** The name the bot shows in the meeting: "<bot> (transcription)". */
export function meetingDisplayName(botName: string): string {
  const clean = Array.from(botName).filter((ch) => ch.charCodeAt(0) >= 32 && ch !== "\u007f" && ch !== "<" && ch !== ">").join("").trim().slice(0, 50) || "Bot";
  return `${clean} (transcription)`;
}
