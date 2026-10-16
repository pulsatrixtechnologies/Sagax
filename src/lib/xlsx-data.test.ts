import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/universal";
import { isXlsxName, sheetToTable, workbookToTables, xlsxCellText, XLSX_MAX_CELLS, XLSX_MAX_COLUMNS } from "./xlsx-data";

describe("xlsx preview data", () => {
  it("turns cells into the text the grid shows", () => {
    expect(xlsxCellText(null)).toBe("");
    expect(xlsxCellText(true)).toBe("TRUE");
    expect(xlsxCellText(1.5)).toBe("1.5");
    expect(xlsxCellText(Number.NaN)).toBe("");
    expect(xlsxCellText(new Date(Date.UTC(2026, 9, 16)))).toBe("2026-10-16");
    expect(xlsxCellText(new Date(Date.UTC(2026, 9, 16, 13, 5, 9)))).toBe("2026-10-16 13:05:09");
    expect(xlsxCellText("00123")).toBe("00123");
  });
  it("pads short rows and drops trailing empty rows and columns", () => {
    const table = sheetToTable("S", [["A", "B", null], ["1"], ["2", "3", ""], [null, null]]);
    expect(table.headers).toEqual(["A", "B"]);
    expect(table.rows).toEqual([["1", ""], ["2", "3"]]);
    expect(table.totalRows).toBe(2);
    expect(table.truncated).toBe(false);
  });
  it("caps columns and cells and says so", () => {
    const wide = sheetToTable("W", [Array.from({ length: XLSX_MAX_COLUMNS + 5 }, (_unused, index) => `c${index}`)]);
    expect(wide.headers).toHaveLength(XLSX_MAX_COLUMNS);
    expect(wide.truncated).toBe(true);
    const rows = Array.from({ length: 6000 }, (_unused, index) => Array.from({ length: 100 }, () => index));
    const tall = sheetToTable("T", rows);
    expect((tall.rows.length + 1) * tall.headers.length).toBeLessThanOrEqual(XLSX_MAX_CELLS);
    expect(tall.truncated).toBe(true);
    expect(tall.totalRows).toBe(5999);
  });
  it("recognizes xlsx names", () => {
    expect(isXlsxName("Rapport.XLSX")).toBe(true);
    expect(isXlsxName("rapport.xls")).toBe(false);
  });
  it("reads every sheet of a real workbook in order", async () => {
    const file = readFileSync(new URL("./__fixtures__/two-sheets.xlsx", import.meta.url));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const sheets = workbookToTables(await readXlsxFile(buffer));
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Clients", "Totaux"]);
    expect(sheets[0]).toMatchObject({ headers: ["Nom", "Heures", "Actif"], rows: [["Alpha", "1.5", "TRUE"], ["Bêta", "12", ""]] });
    expect(sheets[1]).toMatchObject({ headers: ["Total", "13.5"], rows: [] });
  });
});
