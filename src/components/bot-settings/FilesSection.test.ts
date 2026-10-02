import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ThreadFile } from "@/lib/chat-files";
import { setLocale } from "@/lib/i18n";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { loadingOlder: {} }, dispatch: vi.fn() }),
}));

const { FilesBrowser } = await import("./FilesSection");
setLocale("en");

const file = (name: string, patch: Partial<ThreadFile> = {}): ThreadFile => ({
  id: `${name.replace(/\W/g, "").padEnd(24, "0").slice(0, 24)}`,
  messageId: `m-${name}`,
  source: "written",
  path: `/work/${name}`,
  name,
  at: Date.UTC(2026, 8, 29, 12),
  size: 2048,
  available: true,
  ...patch,
});

const files = [
  file("chart.png", { source: "attachment", mime: "image/png" }),
  file("demo.mp4"),
  file("report.pdf", { source: "upload", path: "/data/attachments/11111111-1111-4111-8111-111111111111.pdf" }),
  file("main.ts", { path: "src/main.ts", localPath: "/work/src/main.ts" }),
  file("bundle.zip"),
  file("remote.png", { available: false, size: null, path: "/home/cua/remote.png" }),
];

const render = (props: Partial<Parameters<typeof FilesBrowser>[0]> = {}) => renderToStaticMarkup(createElement(FilesBrowser, {
  threadId: "thread-1",
  files,
  error: false,
  onRetry: () => undefined,
  onJump: () => undefined,
  initialView: "list",
  ...props,
}));

describe("FilesBrowser", () => {
  it("shows a chip only for kinds that have files, then the files with their origin and size", () => {
    const html = render();
    for (const [label, count] of [["All", 6], ["Images", 2], ["Videos", 1], ["Documents", 1], ["Code", 1], ["Other", 1]] as const) {
      expect(html).toMatch(new RegExp(`aria-pressed="(?:true|false)"[^>]*>${label}<span[^>]*>${count}</span>`));
    }
    // An empty kind gets no chip.
    expect(html).not.toMatch(/aria-pressed="(?:true|false)"[^>]*>Audio<span/);
    expect(html).toContain('data-files-view="list"');
    for (const name of ["chart.png", "demo.mp4", "report.pdf", "main.ts", "bundle.zip", "remote.png"]) expect(html).toContain(name);
    expect(html).toContain("Bot attached · 2.0 KB");
    expect(html).toContain("You sent · 2.0 KB");
    expect(html).toContain("Not on this computer");
  });

  it("loads image thumbnails by opaque id, never by host path", () => {
    const html = render();
    expect(html).toContain(`src="/api/threads/thread-1/files/${files[0]!.id}?preview=1"`);
    expect(html).not.toMatch(/src="[^"]*(?:\/work\/|\/data\/attachments)/);
    // An unavailable image gets an icon, not a request.
    expect(html).not.toContain(`files/${files[5]!.id}?preview=1`);
  });

  it("offers jump, download and copy path, and no download or copy for a file that is not here", () => {
    const html = render();
    expect(html.match(/aria-label="Show in chat"/g)).toHaveLength(6);
    expect(html).toContain('aria-label="Download chart.png"');
    expect(html).toMatch(/<button type="button" disabled="" aria-label="Download remote\.png"/);
    expect(html).toContain('title="/work/src/main.ts"');
    expect(html).not.toContain('title="/home/cua/remote.png"');
  });

  it("renders a grid when asked, and filters by kind", () => {
    const html = render({ initialView: "grid", initialFilter: "image" });
    expect(html).toContain('data-files-view="grid"');
    expect(html).toContain("chart.png");
    expect(html).toContain("remote.png");
    expect(html).not.toContain("report.pdf");
  });

  it("says what is missing per filter, and shows loading and error states", () => {
    expect(render({ initialFilter: "audio" })).toContain("No audio in this chat yet.");
    expect(render({ files: [] })).toContain("Files you send and files this bot makes in this chat show up here.");
    expect(render({ files: null })).toContain("Loading files…");
    const failed = render({ files: null, error: true });
    expect(failed).toContain("Couldn&#x27;t load this chat&#x27;s files.");
    expect(failed).toContain("Retry");
  });
});
