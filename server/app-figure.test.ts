import { describe, expect, it } from "vitest";

import { citeAppFigures, noteAppRead } from "./app-figure.ts";

describe("app figures in the bot's text", () => {
  it("names the piece and the date, and does not invent a number", () => {
    expect(noteAppRead("send_mail", "3 invoices on 2026-10-26")).toBeNull();
    expect(noteAppRead("browser_open", "3 invoices on 2026-10-26")).toBeNull();
    expect(noteAppRead("list_messages", "3 invoices arrived")).toBeNull();
    const piece = noteAppRead("mcp__inbox__list_messages", JSON.stringify({ subject: "Monday note", text: "3 invoices arrived", asOf: "2026-10-26" }));
    expect(piece).toMatchObject({ piece: "Monday note", asOf: "2026-10-26" });
    const cited = citeAppFigures("3 invoices arrived.", piece ? [piece] : []);
    expect(cited).toContain("3 invoices arrived.");
    expect(cited).toContain("Monday note, 2026-10-26");
    expect(cited).not.toMatch(/\b9\b/);
    expect(citeAppFigures("3 invoices arrived (Monday note, 2026-10-26).", piece ? [piece] : [])).toBe("3 invoices arrived (Monday note, 2026-10-26).");
    expect(citeAppFigures("No count here.", piece ? [piece] : [])).toBe("No count here.");
  });
});
