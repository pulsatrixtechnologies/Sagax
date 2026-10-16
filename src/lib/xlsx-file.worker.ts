import readXlsxFile from "read-excel-file/universal";
import { workbookToTables } from "./xlsx-data";

// The workbook bytes arrive already bounded by TABLE_FILE_MAX_BYTES; parsing
// here keeps a large sheet from freezing the window.
self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const sheets = await readXlsxFile(event.data.buffer);
    self.postMessage({ sheets: workbookToTables(sheets) });
  } catch {
    self.postMessage({ error: "format" });
  }
};
