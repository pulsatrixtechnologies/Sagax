// Settings > Credentials, Import and Export: the export starts locked behind
// its warning and typed confirmation; the import takes the managers' files.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { exportFileName } from "@/lib/credential-vault";
import { ExportPanel, ImportPanel, importOutcomeText } from "./CredentialsTransfer";

describe("CredentialsTransfer", () => {
  it("shows the plaintext warning and keeps Export off until confirmed", () => {
    const html = renderToStaticMarkup(createElement(ExportPanel, { onCancel: () => {} }));
    expect(html).toContain("data-credential-export-warning");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-credential-export-run=""/);
    expect(html).toContain("EXPORT");
  });

  it("takes CSV, JSON and 1PUX files and shows no preview before one is chosen", () => {
    const html = renderToStaticMarkup(createElement(ImportPanel, { existing: [], onDone: async () => {}, onCancel: () => {} }));
    expect(html).toContain("accept=\".csv,.json,.1pux,text/csv,application/json\"");
    expect(html).not.toContain("data-credential-import-preview");
    expect(html).not.toContain("data-credential-import-run");
  });

  it("words an import's result in counts", () => {
    expect(importOutcomeText({ created: 3, merged: 1, duplicates: 2, inFile: 0, overLimit: 0, refused: 1 }))
      .toBe("Imported: 3 new, 1 merged. Already in your vault, left as they were: 2. Refused by the vault's rules: 1.");
    expect(exportFileName("json", new Date(2026, 9, 18))).toBe("sagax-credentials-2026-10-18.json");
  });
});
