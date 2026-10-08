import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  orderedReleaseNotes,
  readSeenRelease,
  releaseNotesPriorInstall,
  releaseNotesSection,
  sanitizeReleaseMarkdown,
  readPreviousRelease,
  seenReleaseRecord,
  whatsNewDecision,
} from "./release-notes";

const shipped = readFileSync(new URL("../../docs/releases/0.4.4.md", import.meta.url), "utf8");

describe("sanitizeReleaseMarkdown", () => {
  it("drops raw HTML, including a tag split so it reassembles", () => {
    const cleaned = sanitizeReleaseMarkdown(
      'Hello <script>alert(1)</script> <img src="x" onerror="alert(1)"> <scr<script>ipt>alert(2)</script> <!-- <b>hidden</b> -->',
    );
    expect(cleaned.toLowerCase()).not.toContain("<script");
    expect(cleaned.toLowerCase()).not.toContain("<img");
    expect(cleaned.toLowerCase()).not.toContain("<b");
    expect(cleaned).not.toContain("onerror");
    expect(cleaned).toContain("Hello");
  });

  it("keeps https links and strips javascript, data and bare autolinks", () => {
    const cleaned = sanitizeReleaseMarkdown(
      "[docs](https://example.com/notes) [bad](javascript:alert(1)) [data](data:text/html,hi) <javascript:alert(1)> <https://example.com/ok>",
    );
    expect(cleaned).toContain("[docs](https://example.com/notes)");
    expect(cleaned).toContain("<https://example.com/ok>");
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).not.toContain("data:");
    expect(cleaned).toContain("bad");
    expect(cleaned).toContain("data");
  });

  it("turns images into their alt text so nothing is fetched", () => {
    const cleaned = sanitizeReleaseMarkdown("See ![the diagram](https://cdn.example/a.png) please.");
    expect(cleaned).toBe("See the diagram please.");
    expect(cleaned).not.toContain("https://");
  });

  it("drops a reference definition whose target is not http(s) or mailto", () => {
    const cleaned = sanitizeReleaseMarkdown("[click][x]\n\n[x]: javascript:alert(1)\n[y]: https://example.com/y\n");
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).toContain("[y]: https://example.com/y");
  });
});

describe("orderedReleaseNotes", () => {
  it("lists skipped versions newest first, with 0.4.10 after 0.4.9", () => {
    const ordered = orderedReleaseNotes([
      { version: "0.4.4", note: "four" },
      { version: "0.4.10", note: "ten" },
      { version: "0.4.9", note: "nine" },
      { version: "0.4.10-beta.1", note: "beta" },
    ]);
    expect(ordered.map((entry) => entry.version)).toEqual([
      "0.4.10",
      "0.4.10-beta.1",
      "0.4.9",
      "0.4.4",
    ]);
    expect(ordered[0]?.note).toBe("ten");
  });

  it("treats a single release body as one entry for the version being installed", () => {
    expect(orderedReleaseNotes("Just this release.\n", "0.4.5")).toEqual([
      { version: "0.4.5", note: "Just this release.\n" },
    ]);
    expect(orderedReleaseNotes("   ", "0.4.5")).toEqual([]);
    expect(orderedReleaseNotes(null, "0.4.5")).toEqual([]);
  });

  it("ignores entries with no version and coerces a missing note to empty", () => {
    const ordered = orderedReleaseNotes([
      { note: "no version" },
      { version: "1.0.0", note: null },
      { version: " 1.2.0 ", note: "newer" },
    ]);
    expect(ordered).toEqual([
      { version: "1.2.0", note: "newer" },
      { version: "1.0.0", note: "" },
    ]);
  });
});

describe("releaseNotesSection", () => {
  it("uses the French section for fr and the English section otherwise", () => {
    const source = "Bonjour\n\n## Nouveautés\n\n* Un\n\n## English\n\nHello\n\n* One\n";
    expect(releaseNotesSection(source, "fr")).toBe("Bonjour\n\n## Nouveautés\n\n* Un");
    expect(releaseNotesSection(source, "fr-CA")).toBe("Bonjour\n\n## Nouveautés\n\n* Un");
    expect(releaseNotesSection(source, "FR")).toBe("Bonjour\n\n## Nouveautés\n\n* Un");
    expect(releaseNotesSection(source, "en")).toBe("Hello\n\n* One");
    expect(releaseNotesSection(source, "de")).toBe("Hello\n\n* One");
    expect(releaseNotesSection(source, "pt-BR")).toBe("Hello\n\n* One");
  });

  it("splits the shipped 0.4.4 notes on the English heading", () => {
    const french = releaseNotesSection(shipped, "fr");
    const english = releaseNotesSection(shipped, "en");
    expect(french).toContain("Nouveautés");
    expect(french).not.toContain("Faster voice calls");
    expect(english).toContain("Faster voice calls");
    expect(english).not.toContain("Nouveautés");
    expect(english.startsWith("## English")).toBe(false);
  });

  it("falls back when the chosen section is missing", () => {
    expect(releaseNotesSection("Seulement en français.", "en")).toBe("Seulement en français.");
    expect(releaseNotesSection("## English\n\nEnglish only.", "fr")).toBe("English only.");
  });
});

describe("whatsNewDecision", () => {
  it("stays quiet on a fresh install and records the version", () => {
    expect(whatsNewDecision({
      version: "0.4.5",
      dev: false,
      seenVersion: null,
      previouslyInstalled: false,
    })).toEqual({ show: false, seenVersion: "0.4.5" });
    expect(releaseNotesPriorInstall(null)).toBe(false);
    expect(releaseNotesPriorInstall({ completedAt: "", version: 0, hintsSeen: [] })).toBe(false);
  });

  it("stays quiet in dev and for a non-release version, without writing a record", () => {
    expect(whatsNewDecision({
      version: "0.4.5",
      dev: true,
      seenVersion: null,
      previouslyInstalled: true,
    })).toEqual({ show: false, seenVersion: null });
    expect(whatsNewDecision({
      version: "dev",
      dev: false,
      seenVersion: null,
      previouslyInstalled: true,
    })).toEqual({ show: false, seenVersion: null });
  });

  it("shows once per version after an update, including the first launch of this feature", () => {
    expect(whatsNewDecision({
      version: "0.4.5",
      dev: false,
      seenVersion: "0.4.4",
      previouslyInstalled: true,
    })).toEqual({ show: true, seenVersion: "0.4.5" });
    expect(whatsNewDecision({
      version: "0.4.5",
      dev: false,
      seenVersion: null,
      previouslyInstalled: true,
    })).toEqual({ show: true, seenVersion: "0.4.5" });
    expect(whatsNewDecision({
      version: "0.4.5",
      dev: false,
      seenVersion: "0.4.5",
      previouslyInstalled: true,
    })).toEqual({ show: false, seenVersion: "0.4.5" });
  });

  it("treats a finished launch or welcome as a prior install", () => {
    expect(releaseNotesPriorInstall({ launchMode: "solo" })).toBe(true);
    expect(releaseNotesPriorInstall({ launchMode: "server" })).toBe(true);
    expect(releaseNotesPriorInstall({ completedAt: "2026-10-01T00:00:00.000Z" })).toBe(true);
    expect(releaseNotesPriorInstall({ hintsSeen: ["computer"] })).toBe(true);
    expect(releaseNotesPriorInstall({ version: 1 })).toBe(true);
    expect(releaseNotesPriorInstall({ reelSeen: true })).toBe(true);
    expect(releaseNotesPriorInstall({ firstTurnAt: "2026-10-01T00:00:00.000Z" })).toBe(true);
    expect(releaseNotesPriorInstall({ launchMode: "cloud" })).toBe(false);
  });

  it("round-trips the seen record", () => {
    expect(readSeenRelease(seenReleaseRecord("0.4.5"))).toBe("0.4.5");
    expect(readPreviousRelease(seenReleaseRecord("0.4.5"))).toBeNull();
    expect(readPreviousRelease(seenReleaseRecord("0.4.5", "0.4.2"))).toBe("0.4.2");
    expect(readSeenRelease(seenReleaseRecord("0.4.5", "0.4.2"))).toBe("0.4.5");
    expect(readPreviousRelease("not json")).toBeNull();
    expect(readSeenRelease(null)).toBe(null);
    expect(readSeenRelease("not json")).toBe(null);
    expect(readSeenRelease("{}")).toBe(null);
  });
});
