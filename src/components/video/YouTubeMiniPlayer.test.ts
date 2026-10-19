import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => {
  class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly body?: Record<string, unknown>) {
      super(message);
    }
  }
  return { api: vi.fn(), ApiError };
});

const { ApiError } = await import("@/state/store");
const { YouTubeMiniPlayer, transcriptErrorMessage } = await import("./YouTubeMiniPlayer");

describe("YouTubeMiniPlayer", () => {
  it("renders fetch transcript control", () => {
    const html = renderToStaticMarkup(
      createElement(YouTubeMiniPlayer, { videoId: "dQw4w9WgXcQ" }),
    );
    expect(html).toContain("dQw4w9WgXcQ");
  });

  it("lays nothing over the embed: title and transcript button sit under the stage", () => {
    const html = renderToStaticMarkup(createElement(YouTubeMiniPlayer, { videoId: "dQw4w9WgXcQ", initialTitle: "Clip" }));
    expect(html).toContain('data-embed-controls="true"');
    expect(html).toMatch(/class="vpc-footer"[\s\S]*Clip[\s\S]*vpc-chip/);
    expect(html).not.toContain('class="vpc-play"');
  });

  it("says why a transcript could not be read, in the app's words", () => {
    const err = (code: string, status: number) => new ApiError(code, status, { error: code });
    expect(transcriptErrorMessage(err("no_captions", 404))).toBe("This video has no public captions, so there is no transcript to show.");
    expect(transcriptErrorMessage(err("unavailable", 422))).toMatch(/private, removed or restricted/);
    expect(transcriptErrorMessage(err("blocked", 502))).toMatch(/did not return the transcript/);
    expect(transcriptErrorMessage(new Error("offline"))).toBe("Could not load the transcript.");
  });
});
