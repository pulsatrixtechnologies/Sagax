// An .xlsx a bot sends, read for the in-app table preview
// (src/components/TableFilePreview.tsx). The parse runs in a worker
// (xlsx-file.worker.ts) with read-excel-file; this file turns each sheet into
// the same string table the CSV preview shows, with every limit applied
// here so the grid never receives more than it can show.
import type { TextTable } from "./table-data";

/** Rows kept per sheet; the rest are dropped with a note in the preview. */
export const XLSX_MAX_ROWS = 50_000;
/** Columns kept per sheet. */
export const XLSX_MAX_COLUMNS = 200;
/** Cells kept per sheet (rows times columns). */
export const XLSX_MAX_CELLS = 500_000;
/** Sheets shown as tabs; a workbook with more lists the first ones. */
export const XLSX_MAX_SHEETS = 50;

export interface SheetTable extends TextTable {
  name: string;
  /** Data rows in the sheet before the limits (header row excluded). */
  totalRows: number;
  /** Rows or columns were dropped to stay within the limits. */
  truncated: boolean;
}

export function isXlsxName(name: string): boolean {
  return /\.xlsx$/i.test(name.trim());
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** One cell as text: dates as ISO (date only at midnight UTC), booleans as
 * Excel writes them, numbers as JavaScript prints them. */
export function xlsxCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const date = `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
    const time = value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds()
      ? ` ${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}`
      : "";
    return date + time;
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

/** A sheet's rows (first row is the header) as a bounded string table.
 * Trailing empty rows and columns are dropped; short rows are padded. */
export function sheetToTable(name: string, data: readonly (readonly unknown[])[]): SheetTable {
  const text = data.map((row) => row.map(xlsxCellText));
  while (text.length && text.at(-1)!.every((cell) => !cell.trim())) text.pop();
  let width = 0;
  for (const row of text) {
    for (let index = row.length - 1; index >= width; index -= 1) {
      if (row[index]!.trim()) { width = index + 1; break; }
    }
  }
  const columns = Math.min(width, XLSX_MAX_COLUMNS);
  const totalRows = Math.max(0, text.length - 1);
  const rowLimit = Math.min(XLSX_MAX_ROWS, columns ? Math.floor(XLSX_MAX_CELLS / columns) - 1 : XLSX_MAX_ROWS);
  const pad = (row: readonly string[] = []) => Array.from({ length: columns }, (_unused, index) => row[index] ?? "");
  const [head, ...body] = text;
  return {
    name,
    headers: pad(head),
    rows: body.slice(0, rowLimit).map(pad),
    totalRows,
    truncated: width > XLSX_MAX_COLUMNS || totalRows > rowLimit,
  };
}

/** Every sheet of a parsed workbook, in workbook order, at most XLSX_MAX_SHEETS. */
export function workbookToTables(sheets: readonly { sheet: string; data: readonly (readonly unknown[])[] }[]): SheetTable[] {
  return sheets.slice(0, XLSX_MAX_SHEETS).map((sheet) => sheetToTable(sheet.sheet, sheet.data));
}
