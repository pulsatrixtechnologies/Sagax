import { describe, expect, it } from "vitest";
import { fetchYoutubeTranscript } from "./youtube-transcript.ts";

describe("fetchYoutubeTranscript", () => {
  it("parses caption tracks from a watch page", async () => {
    const html = `
      "captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=fr","languageCode":"fr"}]
    `;
    const fetchImpl = async (url: string) => {
      if (url.includes("watch?v=")) {
        return { ok: true, text: async () => html };
      }
      if (url.includes("timedtext")) {
        return {
          ok: true,
          text: async () => '<text start="1.5">Bonjour</text><text start="3">le monde</text>',
        };
      }
      throw new Error(`unexpected ${url}`);
    };
    const cues = await fetchYoutubeTranscript("abc12345678", fetchImpl as typeof fetch);
    expect(cues).toEqual([
      { startMs: 1500, text: "Bonjour" },
      { startMs: 3000, text: "le monde" },
    ]);
  });

  it("refuses when no caption tracks exist", async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => "<html></html>" });
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "no_captions" });
  });
});
