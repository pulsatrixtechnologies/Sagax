// The reader's bar around a published page (2026-10-28): the wrapper at
// /pages/view/<token> draws the title and the notice itself; this script
// adds the actions the reader has a right to (shared/page-reader.ts). It
// runs in the wrapper only, never in the page's sandboxed frame.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { parseReaderBoot, READER_ACTIONS_ID, READER_BOOT_ID } from "../../shared/page-reader";
import { ReaderActions } from "./ReaderActions";
import { watchPageSize } from "./print";
import "./reader.css";

function boot() {
  try {
    return parseReaderBoot(JSON.parse(document.getElementById(READER_BOOT_ID)?.textContent ?? "null"));
  } catch {
    return null;
  }
}

// Download PDF and the browser's own Print: the page's whole height
watchPageSize(document.querySelector("iframe"));

const config = boot();
const mount = document.getElementById(READER_ACTIONS_ID);
if (config && mount) {
  createRoot(mount).render(<StrictMode><ReaderActions boot={config} /></StrictMode>);
}
