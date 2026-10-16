import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("General > Advanced > Diagnostics: logs and feedback", () => {
  it("offers Download logs only where the desktop app answers", async () => {
    vi.stubGlobal("window", { ogb: { exportLogs: async () => null } });
    const { DownloadLogsRow } = await import("./AdvancedSettings");
    expect(renderToStaticMarkup(createElement(DownloadLogsRow))).toContain("Download logs…");
    vi.stubGlobal("window", {});
    expect(renderToStaticMarkup(createElement(DownloadLogsRow))).toBe("");
  });

  it("drafts feedback to the public mailbox with the version, attaching nothing", async () => {
    vi.stubGlobal("window", {});
    const { SendFeedbackRow } = await import("./AdvancedSettings");
    const html = renderToStaticMarkup(createElement(SendFeedbackRow));
    expect(html).toContain('href="mailto:hello@pulsatrix.ca?subject=');
    expect(html).toContain("Send feedback…");
    expect(html).toContain("Nothing is attached.");
  });
});
