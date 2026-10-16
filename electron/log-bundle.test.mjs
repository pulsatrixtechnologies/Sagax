import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildLogBundle, formatServerRing, logBundleFileName, sanitizeRendererLines, RENDERER_LINES_MAX } = require("./log-bundle.mjs");

// Fake credentials, built at run time so no scanner mistakes them for real ones.
const OPENAI = `sk-${"a1B2c3D4e5F6g7H8".repeat(2)}`;
const XAI = `xai-${"Z9y8X7w6V5u4T3s2".repeat(2)}`;
const GITHUB = `ghp_${"Q1w2E3r4T5y6U7i8O9p0".repeat(2)}`;
const BEARER = `Bearer ${"tok3nV4lu3".repeat(3)}`;

function ringLine(seq, message, level = "info", area = "engines") {
  return JSON.stringify({ seq, at: Date.UTC(2026, 9, 16, 12, 0, seq), level, area, message });
}

describe("Download logs bundle", () => {
  it("masks credentials in every section: server window, server.log, console, updater, crashes", () => {
    const bundle = buildLogBundle({
      appInfo: { version: "0.5.8", platform: "darwin", arch: "arm64", packaged: true },
      serverRing: [ringLine(1, `started with key ${OPENAI}`), ringLine(2, `Authorization: ${BEARER}`, "warn")].join("\n"),
      serverLogTail: `boot XAI_API_KEY=${XAI}\nready`,
      rendererLines: [`2026-10-16T12:00:00.000Z ERROR fetch failed token=${GITHUB}`],
      updaterLogTail: `GET https://example.com/feed.yml?X-Amz-Signature=abc123secret`,
      desktopLogTail: `event=main-process-failure origin=uncaughtException error=TypeError password=${"hunter2hunter2"}`,
      now: "2026-10-16T12:00:00.000Z",
    });
    for (const secret of [OPENAI, XAI, GITHUB, "tok3nV4lu3tok3nV4lu3", "abc123secret", "hunter2hunter2"]) {
      expect(bundle).not.toContain(secret);
    }
    expect(bundle).toContain("«redacted");
    expect(bundle).toContain("## Server log window (server-log-ring)");
    expect(bundle).toContain("WARN [engines]");
    expect(bundle).toContain("## Window console");
    expect(bundle).toContain("version=0.5.8");
    expect(bundle).toContain("https://example.com/feed.yml?«redacted URL parameters»");
  });

  it("says when a section is empty", () => {
    const bundle = buildLogBundle({ now: "2026-10-16T12:00:00.000Z" });
    expect(bundle).toContain("(no server log window on this computer)");
    expect(bundle).toContain("(no console lines kept)");
    expect(bundle).toContain("(server.log unavailable)");
  });

  it("reads only the ring's own JSON lines, oldest first, never a raw line", () => {
    const lines = formatServerRing([ringLine(1, "one"), `raw ${OPENAI}`, "{not json", JSON.stringify({ message: "no time" }), ringLine(2, "two", "error", "bad area with spaces")].join("\n"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^2026-10-16T12:00:01\.000Z INFO \[engines\] one$/);
    expect(lines[1]).toMatch(/ERROR two$/);
    expect(lines.join("\n")).not.toContain(OPENAI);
  });

  it("keeps only strings from the renderer, bounded in count and length", () => {
    const many = Array.from({ length: RENDERER_LINES_MAX + 5 }, (_, i) => `line ${i}`);
    const kept = sanitizeRendererLines([42, { line: "x" }, ...many, "y".repeat(10_000)]);
    expect(kept).toHaveLength(RENDERER_LINES_MAX);
    expect(kept.at(-1).length).toBeLessThanOrEqual(4_001);
    expect(kept.every((line) => typeof line === "string")).toBe(true);
    expect(sanitizeRendererLines("not a list")).toEqual([]);
  });

  it("names the file with the date and time", () => {
    expect(logBundleFileName(new Date(2026, 9, 16, 8, 5, 9))).toBe("sagax-logs-20261016-080509.txt");
  });
});
