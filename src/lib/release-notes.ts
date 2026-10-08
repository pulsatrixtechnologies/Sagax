// In-app release notes. Before an update the desktop feed sends the GitHub
// release body (one string, or one entry per skipped version). After an
// update the bundled docs/releases file is split by language. Both paths
// go through the same pure helpers so the rules can be tested without
// Electron or a DOM.

export interface ReleaseNoteEntry {
  version: string;
  note: string;
}

export interface OnboardingSeen {
  launchMode?: string | null;
  completedAt?: string | null;
  hintsSeen?: readonly string[] | null;
  version?: number | null;
  reelSeen?: boolean | null;
  firstTurnAt?: string | null;
}

export interface WhatsNewInput {
  /** Current app version. Anything other than X.Y.Z (optional pre-release) is not a release. */
  version: string;
  /** Unpackaged dev build. Never auto-opens and never writes the seen record. */
  dev: boolean;
  /** Version already recorded on this computer, or null when nothing was recorded. */
  seenVersion: string | null;
  /** The workspace was used before this launch (an update, not a fresh install). */
  previouslyInstalled: boolean;
}

export interface WhatsNewDecision {
  show: boolean;
  /**
   * Version to persist. Null means leave storage untouched (a dev build).
   * A fresh install persists the current version without showing the dialog,
   * so the next update is the first one that opens it.
   */
  seenVersion: string | null;
}

/** localStorage key. The value is JSON `{ version }` so a later field can be added. */
export const RELEASE_NOTES_SEEN_KEY = "sagax.releaseNotes.seen.v1";

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ENGLISH_HEADING = /^## English[ \t]*$/m;

interface ParsedVersion {
  core: [number, number, number];
  pre: string[];
}

function parsedVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

/** Semver compare. An unparsable version sorts before a real one. */
export function compareVersions(left: string, right: string): number {
  const a = parsedVersion(left);
  const b = parsedVersion(right);
  if (!a && !b) return left.localeCompare(right);
  if (!a) return -1;
  if (!b) return 1;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const delta = Number(x) - Number(y);
      if (delta !== 0) return delta;
    } else if (xNum) return -1;
    else if (yNum) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Notes to show before an update, newest version first.
 * A string is the latest release body alone. An array is every skipped
 * version (electron-updater's full changelog).
 */
export function orderedReleaseNotes(
  releaseNotes: string | Array<{ version?: string; note?: string | null }> | null | undefined,
  fallbackVersion = "",
): ReleaseNoteEntry[] {
  if (typeof releaseNotes === "string") {
    return releaseNotes.trim() ? [{ version: fallbackVersion, note: releaseNotes }] : [];
  }
  if (!Array.isArray(releaseNotes)) return [];
  const entries: ReleaseNoteEntry[] = [];
  for (const item of releaseNotes) {
    if (!item || typeof item.version !== "string" || !item.version.trim()) continue;
    entries.push({
      version: item.version.trim(),
      note: typeof item.note === "string" ? item.note : "",
    });
  }
  return entries.sort((a, b) => compareVersions(b.version, a.version) || a.version.localeCompare(b.version));
}

/**
 * French copy is the file up to the `## English` line. Every other language
 * gets the English section. A file with no English section is shown whole.
 * An empty chosen section falls back to the other one.
 */
export function releaseNotesSection(markdown: string, language: string): string {
  const text = markdown.replace(/\r\n/g, "\n");
  const match = ENGLISH_HEADING.exec(text);
  if (!match) return text.trim();
  const french = text.slice(0, match.index).trim();
  const english = text.slice(match.index + match[0].length).trim();
  const lang = language.trim().toLowerCase();
  const wantFrench = lang === "fr" || lang.startsWith("fr-");
  if (wantFrench) return french || english;
  return english || french;
}

/** http(s) and mailto only. javascript:, data: and relative URLs are not opened. */
export function safeReleaseUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!/^(https?:|mailto:)/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

// A real tag name, then space, `/` or `>`. Autolinks such as <https://…> contain
// a colon and are left for the link pass.
const HTML_TAG = /<\/?[A-Za-z!][A-Za-z0-9-]*(?=[\s/>])[^>]*>/g;
const MD_LINK = /(!?)\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g;

/**
 * Release notes are markdown, never HTML. Tags are removed (repeatedly, so
 * a split `<scr<script>ipt>` cannot reassemble), and links whose scheme is
 * not http(s) or mailto become their label. Images become their alt text
 * so the dialog never fetches a remote URL.
 */
export function sanitizeReleaseMarkdown(source: string): string {
  let text = String(source).replaceAll("\u0000", "").replace(/<!--[\s\S]*?-->/g, "");
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(HTML_TAG, "");
  }
  text = text.replace(MD_LINK, (_all, bang: string, label: string, raw: string) => {
    const url = raw.trim().replace(/^<|>$/g, "").replace(/\s+["'][^"']*["']\s*$/, "").trim();
    if (bang === "!") return label;
    return safeReleaseUrl(url) ? `[${label}](${url})` : label;
  });
  text = text.replace(/<([^>\s]+)>/g, (all, url: string) => (safeReleaseUrl(url) ? all : ""));
  text = text.replace(/^[ \t]*\[[^\]]+\]:[ \t]*(\S+)[ \t]*$/gm, (all, url: string) =>
    safeReleaseUrl(url) ? all : "",
  );
  return text;
}

/** True when this workspace was already in use, so this launch is an update. */
export function releaseNotesPriorInstall(onboarding: OnboardingSeen | null | undefined): boolean {
  if (!onboarding) return false;
  if (onboarding.launchMode === "solo" || onboarding.launchMode === "server") return true;
  if (onboarding.completedAt) return true;
  if ((onboarding.hintsSeen?.length ?? 0) > 0) return true;
  if ((onboarding.version ?? 0) > 0) return true;
  if (onboarding.reelSeen) return true;
  if (onboarding.firstTurnAt) return true;
  return false;
}

export function readSeenRelease(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed?.version === "string" && parsed.version ? parsed.version : null;
  } catch {
    return null;
  }
}

/** The version that was installed before the one recorded as seen, when known. */
export function readPreviousRelease(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { previous?: unknown };
    return typeof parsed?.previous === "string" && parsed.previous ? parsed.previous : null;
  } catch {
    return null;
  }
}

export function seenReleaseRecord(version: string, previous?: string | null): string {
  return JSON.stringify(previous && previous !== version ? { version, previous } : { version });
}

/**
 * Whether to open "What's new" on this launch.
 * Fresh install (no seen version, workspace never used): record the version, stay quiet.
 * Same version: stay quiet. A newer version, or the first launch of this
 * feature on a workspace that was already used: show once.
 */
export function whatsNewDecision(input: WhatsNewInput): WhatsNewDecision {
  if (input.dev || !RELEASE_VERSION.test(input.version)) {
    return { show: false, seenVersion: null };
  }
  if (input.seenVersion === input.version) {
    return { show: false, seenVersion: input.seenVersion };
  }
  if (input.seenVersion == null && !input.previouslyInstalled) {
    return { show: false, seenVersion: input.version };
  }
  return { show: true, seenVersion: input.version };
}
