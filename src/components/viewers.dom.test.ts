// @vitest-environment happy-dom
// File and diagram viewers (Grok Bot parity, 2026-10-16): Mermaid fits the
// column and opens full screen with pan, zoom and export; long table cells
// expand; tables open full screen and copy as CSV; PDF and XLSX files get an
// in-app preview.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

const pdf = vi.hoisted(() => {
  const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = (text: string) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: renderPage,
    getTextContent: async () => ({ items: [{ str: text, hasEOL: false }] }),
  });
  const pages = [page("Introduction"), page("Facture électrique"), page("Annexe électrique")];
  const destroy = vi.fn();
  const doc = { numPages: pages.length, getPage: vi.fn(async (number: number) => pages[number - 1]), loadingTask: { destroy } };
  const getDocument = vi.fn(() => ({ promise: Promise.resolve(doc), destroy }));
  return { getDocument, renderPage, destroy, GlobalWorkerOptions: { workerPort: null as unknown } };
});
vi.mock("pdfjs-dist", () => ({ getDocument: pdf.getDocument, GlobalWorkerOptions: pdf.GlobalWorkerOptions }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/assets/pdf.worker.js" }));

import { ChatMarkdown } from "./ChatMarkdown";
import { RichTable, tableModelFromDelimited } from "./RichTable";
import { FilePreviewButton, filePreviewKind } from "./TableFilePreview";
import { DiagramViewer } from "./DiagramViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
// The PDF viewer is a lazy chunk (React.lazy and pdfjs): on a busy runner its
// first import takes longer than a few ticks, so wait for what it draws.
const settle = async (ready: () => boolean, ms = 4_000) => {
  const deadline = Date.now() + ms;
  while (!ready() && Date.now() < deadline) await flush();
};
const button = (label: string | RegExp) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => {
  const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
  return typeof label === "string" ? name === label : label.test(name);
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mermaid diagram fits the column", () => {
  it("scales a wide diagram to the column, flags small text and opens full screen", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.stubGlobal("innerHeight", 1000);
    mermaid.render.mockResolvedValue({ svg: '<svg id="d" width="100%" style="max-width: 3000px;" viewBox="0 0 3000 500"><g/></svg>' });
    await act(async () => root.render(createElement(ChatMarkdown, { text: "```mermaid\nflowchart LR\n  Wide-->Diagram\n```" })));
    await flush();
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: "strict",
      themeVariables: expect.objectContaining({ fontSize: expect.stringMatching(/px$/) }),
      flowchart: { useMaxWidth: true },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
    }));
    const fit = host.querySelector<HTMLElement>("[data-mermaid-fit]")!;
    expect(fit.dataset.mermaidFit).toBe("cramped");
    expect(fit.style.width).toBe("600px");
    expect(fit.style.height).toBe("100px");

    await act(async () => button("Open the diagram in full screen")!.click());
    await flush();
    expect(document.querySelector("dialog [data-diagram-content] svg")).not.toBeNull();
    expect(button("Export as SVG")).toBeDefined();
    expect(button("Export as PNG")).toBeDefined();
    expect(button("Copy diagram source")).toBeDefined();
  });

  it("keeps a small diagram at its natural size", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    vi.stubGlobal("innerHeight", 1000);
    mermaid.render.mockResolvedValue({ svg: '<svg width="100%" viewBox="0 0 200 120"><g/></svg>' });
    await act(async () => root.render(createElement(ChatMarkdown, { text: "```mermaid\nflowchart LR\n  Small-->One\n```" })));
    await flush();
    const fit = host.querySelector<HTMLElement>("[data-mermaid-fit]")!;
    expect(fit.dataset.mermaidFit).toBe("fit");
    expect(fit.style.width).toBe("200px");
    expect(fit.style.height).toBe("120px");
  });
});

describe("diagram viewer", () => {
  it("zooms, fits and exports an SVG file", async () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { created.push(blob); return "blob:x"; }), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => root.render(createElement(DiagramViewer, {
      svg: '<svg width="100%" viewBox="0 0 400 200"><g/></svg>', code: "graph TD\nA-->B", onClose: () => {}, returnFocus: null,
    })));
    const zoom = () => document.querySelector("dialog output")!.textContent;
    const before = zoom();
    await act(async () => button("Zoom in")!.click());
    expect(zoom()).not.toBe(before);
    await act(async () => button("Export as SVG")!.click());
    expect(created).toHaveLength(1);
    expect(created[0]!.type).toContain("image/svg+xml");
    expect(await created[0]!.text()).toContain('width="400" height="200"');
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Diagram exported");
  });
});

describe("markdown tables", () => {
  const long = "x".repeat(200);
  it("clamps a long cell and opens it whole", async () => {
    const model = tableModelFromDelimited(`Name,Notes\nAlpha,${long}\nBeta,short`)!;
    await act(async () => root.render(createElement(RichTable, { model })));
    const expand = button(/^Expand the cell value/)!;
    expect(expand).toBeDefined();
    expect(host.querySelectorAll("[aria-label^='Expand the cell value']")).toHaveLength(1);
    await act(async () => expand.click());
    const dialog = document.querySelector("dialog")!;
    expect(dialog.querySelector("h2")!.textContent).toBe("Notes");
    expect(dialog.textContent).toContain(long);
  });

  it("opens the table full screen and copies it as CSV", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const model = tableModelFromDelimited('Item,Price\n"Bolt, small",=1+1\nNut,2')!;
    await act(async () => root.render(createElement(RichTable, { model })));
    await act(async () => button("Open the table in full screen")!.click());
    expect(document.querySelector("dialog table")).not.toBeNull();
    await act(async () => button("Copy as CSV")!.click());
    expect(writeText).toHaveBeenCalledWith('Item,Price\r\n"Bolt, small",\'=1+1\r\nNut,2');
  });
});

describe("file previews", () => {
  const message = { threadId: "t", messageId: "m" };
  it("picks the preview from the file name", () => {
    expect(filePreviewKind("a.csv")).toBe("table");
    expect(filePreviewKind("a.TSV")).toBe("table");
    expect(filePreviewKind("Budget.xlsx")).toBe("xlsx");
    expect(filePreviewKind("Contrat.PDF")).toBe("pdf");
    expect(filePreviewKind("notes.txt")).toBeNull();
    expect(filePreviewKind("download", "/w/report.pdf")).toBe("pdf");
  });

  it("opens a PDF in the in-app viewer: pages, zoom and search", async () => {
    vi.stubGlobal("Worker", class { terminate() {} });
    const fetchMock = vi.fn(async () => new Response(new TextEncoder().encode("%PDF-1.7 test"), { headers: { "content-type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(FilePreviewButton, { path: "/w/Contrat.pdf", name: "Contrat.pdf", message })));
    await act(async () => button("View PDF: Contrat.pdf")!.click());
    await settle(() => document.querySelectorAll("[data-pdf-page]").length === 3);
    expect(fetchMock).toHaveBeenCalledWith("/api/threads/t/messages/m/file", expect.objectContaining({ method: "POST" }));
    expect(pdf.getDocument).toHaveBeenCalledWith(expect.objectContaining({ enableXfa: false }));
    expect(document.querySelectorAll("[data-pdf-page]")).toHaveLength(3);
    expect(document.querySelector("dialog h2")!.textContent).toBe("Contrat.pdf");

    const zoom = () => document.querySelector("dialog output")!.textContent;
    const before = zoom();
    await act(async () => button("Zoom in")!.click());
    expect(zoom()).not.toBe(before);

    const search = document.querySelector<HTMLInputElement>("#pdf-viewer-search")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "electrique");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => search.form!.requestSubmit());
    await flush();
    expect(document.querySelector("dialog form[role=search] [role=status]")!.textContent).toBe("2 found, page 2");
  });

  it("refuses bytes that are not a PDF", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>nope</html>")));
    await act(async () => root.render(createElement(FilePreviewButton, { path: "/w/fake.pdf", name: "fake.pdf", message })));
    await act(async () => button("View PDF: fake.pdf")!.click());
    await settle(() => document.querySelector("dialog [role=alert]") !== null);
    expect(document.querySelector("dialog [role=alert]")!.textContent).toContain("not a readable PDF");
  });

  it("offers a table preview for a workbook and nothing for other files", async () => {
    await act(async () => root.render(createElement("div", null,
      createElement(FilePreviewButton, { path: "/w/Budget.xlsx", name: "Budget.xlsx", message }),
      createElement(FilePreviewButton, { path: "/w/notes.txt", name: "notes.txt", message }))));
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(button("Preview table: Budget.xlsx")).toBeDefined();
  });
});
