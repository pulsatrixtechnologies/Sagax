import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThreadCleanupSettings, parseCapMib } from "./ThreadCleanupSettings";

const fixture = vi.hoisted(() => ({
  threads: undefined as { maxConcurrentPerBot: number; eventLogMaxBytes?: number; eventLogRetentionDays?: number } | undefined,
}));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { config: fixture.threads === undefined ? {} : { threads: fixture.threads } }, dispatch: vi.fn() }),
}));

describe("ThreadCleanupSettings", () => {
  it("rejects cap values that are not exact 0.25 MiB steps", () => {
    expect(parseCapMib("0.25")).toBe(256 * 1024);
    expect(parseCapMib("1.5")).toBe(1536 * 1024);
    expect(parseCapMib("50")).toBe(50 * 1024 * 1024);
    expect(parseCapMib("0.251")).toBeNull();
    expect(parseCapMib("0.3")).toBeNull();
  });

  it("keeps both knobs off by default and disables their number entry", () => {
    fixture.threads = undefined;
    const markup = renderToStaticMarkup(createElement(ThreadCleanupSettings));
    expect(markup).toMatch(/id="thread-log-retention-enabled"[^>]*aria-checked="false"/);
    expect(markup).toMatch(/id="thread-log-cap-enabled"[^>]*aria-checked="false"/);
    expect(markup).toContain('id="thread-log-retention-days"');
    expect(markup).toContain('value="30"');
    expect(markup).toContain('value="50"');
    expect(markup).toContain('disabled=""');
    // one short grey line says what is never deleted (0.5.6: no help paragraphs)
    expect(markup).toContain("never the conversations themselves");
    expect(markup).not.toContain("Off by default.");
  });

  it("shows the confirmed server values, cap converted from bytes to MiB", () => {
    fixture.threads = { maxConcurrentPerBot: 3, eventLogRetentionDays: 14, eventLogMaxBytes: 52428800 };
    const markup = renderToStaticMarkup(createElement(ThreadCleanupSettings));
    expect(markup).toMatch(/id="thread-log-retention-enabled"[^>]*aria-checked="true"/);
    expect(markup).toMatch(/id="thread-log-cap-enabled"[^>]*aria-checked="true"/);
    expect(markup).toContain('value="14"');
    expect(markup).toContain('value="50"');
  });

  it("renders a sub-megabyte cap as a fractional MiB value", () => {
    fixture.threads = { maxConcurrentPerBot: 3, eventLogMaxBytes: 262144 };
    const markup = renderToStaticMarkup(createElement(ThreadCleanupSettings));
    expect(markup).toMatch(/id="thread-log-cap-enabled"[^>]*aria-checked="true"/);
    expect(markup).toContain('value="0.25"');
  });

  it("names both number fields and their switches for a screen reader", () => {
    fixture.threads = { maxConcurrentPerBot: 3, eventLogRetentionDays: 7, eventLogMaxBytes: 1048576 };
    const markup = renderToStaticMarkup(createElement(ThreadCleanupSettings));
    expect(markup).toMatch(/id="thread-log-retention-days"[^>]*aria-label="Delete event logs after"/);
    expect(markup).toMatch(/id="thread-log-cap-mib"[^>]*aria-label="Trim each event log to"/);
    expect(markup.match(/role="switch"/g)).toHaveLength(2);
  });
});
