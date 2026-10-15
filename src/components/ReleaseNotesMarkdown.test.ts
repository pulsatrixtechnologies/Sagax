import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { ReleaseNotesBody } from "./ReleaseNotesMarkdown";

// What 0.5.4 really published: the release file (now carried by the feed or
// read from the API) and the atom feed's HTML of the same body.
const NOTES = readFileSync(new URL("../../docs/releases/0.5.4.md", import.meta.url), "utf8");
const ATOM = readFileSync(new URL("../../electron/fixtures/update-feed/releases.atom", import.meta.url), "utf8");
const ATOM_HTML = (/<content type="html">([\s\S]*?)<\/content>/.exec(ATOM)?.[1] ?? "")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .replaceAll("&amp;", "&");

const FRENCH = "Sagax 0.5.4 poursuit la simplification";
const ENGLISH = "Sagax 0.5.4 continues the simplification";

function render(notes: Parameters<typeof ReleaseNotesBody>[0]["notes"], language: string) {
  return renderToStaticMarkup(createElement(ReleaseNotesBody, { notes, fallbackVersion: "0.5.4", language }));
}

describe("ReleaseNotesBody", () => {
  it("shows the French or the English section of the release file", () => {
    const fr = render(NOTES, "fr");
    expect(fr).toContain(FRENCH);
    expect(fr).not.toContain(ENGLISH);
    const en = render(NOTES, "en");
    expect(en).toContain(ENGLISH);
    expect(en).not.toContain(FRENCH);
  });

  it("still shows one language from the atom feed's HTML, never the empty message", () => {
    expect(ATOM_HTML).toContain("<h2>English</h2>");
    const fr = render([{ version: "0.5.4", note: ATOM_HTML }], "fr");
    expect(fr).toContain(FRENCH);
    expect(fr).not.toContain(ENGLISH);
    expect(fr).not.toContain("<script");
    expect(fr).not.toContain(t("releaseNotes.noNotes"));
  });

  it("says so only when there really are no notes", () => {
    expect(render(undefined, "fr")).toContain(t("releaseNotes.noNotes"));
    expect(render([{ version: "0.5.4", note: "  " }], "fr")).toContain(t("releaseNotes.noNotes"));
  });
});
