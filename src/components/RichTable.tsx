// One table view for every tabular thing in a message: GFM tables (whose cells
// keep their rendered Markdown: links, mentions, code) and ```csv fences.
// Sticky header, hairline rows, horizontal scroll inside the bubble,
// numeric columns right-aligned with tabular figures, click-to-sort headers,
// a filter box once a table is large, and copy as CSV or Markdown.
//
// File previews (a .csv or .tsv a bot sends) use the virtualized grid below
// (GridTable): search, wrap, copy, download and an expanded dialog.
// RichTable picks one from its props: a `model` is a message table, `columns`
// and `rows` are a file preview.
import { Children, isValidElement, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Download, Maximize2, Search, Table2, WrapText, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import { isTableNumber, tableCsv, tableRowOrder, type TableSort } from "@/lib/table-data";
import {
  nextSort,
  numericColumns,
  parseDelimited,
  tableToCsv,
  tableToMarkdown,
  visibleRowOrder,
  type ColumnAlign,
  type SortState,
} from "@/lib/rich-blocks";
import { useCopyFeedback } from "./rich-ui";

export interface TableModel {
  header: Array<{ content: ReactNode; text: string }>;
  rows: Array<{ cells: ReactNode[]; text: string[] }>;
  align: ColumnAlign[];
}

/** Tables with more rows than this get a filter box. */
export const FILTER_THRESHOLD = 8;

interface HastLike {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastLike[];
}

/** All text of a hast node, code included (a table cell's code is data). */
export function hastText(node: HastLike | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

function elementChildren(node: ReactNode): ReactElement<{ children?: ReactNode; node?: HastLike; style?: { textAlign?: string } }>[] {
  return Children.toArray(node).filter(isValidElement) as ReactElement<{ children?: ReactNode; node?: HastLike; style?: { textAlign?: string } }>[];
}

function cellAlign(cell: ReactElement<{ node?: HastLike; style?: { textAlign?: string } }>): ColumnAlign {
  const value = cell.props.style?.textAlign ?? cell.props.node?.properties?.align;
  return value === "left" || value === "right" || value === "center" ? value : null;
}

/** Build the model from what react-markdown hands a `table` component:
 * rendered children (thead/tbody > tr > th/td elements) plus, on each cell
 * element, its hast node for the plain text used by sort, filter and copy. */
export function tableModelFromMarkdown(children: ReactNode): TableModel | null {
  const sections = elementChildren(children);
  const rowsOf = (section: ReactElement<{ children?: ReactNode }>) => elementChildren(section.props.children);
  const headRow = sections.length ? rowsOf(sections[0]!)[0] : undefined;
  if (!headRow) return null;
  const headCells = elementChildren(headRow.props.children);
  const header = headCells.map((cell) => ({ content: cell.props.children, text: hastText(cell.props.node).trim() }));
  const align = headCells.map(cellAlign);
  const rows = sections.slice(1).flatMap(rowsOf).map((row) => {
    const cells = elementChildren(row.props.children);
    return { cells: cells.map((cell) => cell.props.children), text: cells.map((cell) => hastText(cell.props.node).trim()) };
  });
  return { header, rows, align };
}

/** A ```csv / ```tsv fence as a table model (first row is the header). */
export function tableModelFromDelimited(code: string, lang = "csv"): TableModel | null {
  const parsed = parseDelimited(code, lang.trim().toLowerCase() === "tsv" ? "\t" : undefined);
  if (parsed.length < 1) return null;
  const [head, ...body] = parsed as [string[], ...string[][]];
  const width = Math.max(head.length, ...body.map((row) => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_unused, index) => row[index] ?? "");
  return {
    header: pad(head).map((text) => ({ content: text, text })),
    rows: body.map((row) => ({ cells: pad(row), text: pad(row) })),
    align: Array.from({ length: width }, () => null),
  };
}

export interface ModelTableProps { model: TableModel; dir?: "ltr" | "rtl"; caption?: string }

/** A message table (`model`) or a file preview (`columns` and `rows`). */
export function RichTable(props: ModelTableProps | RichTableProps) {
  return "model" in props ? <ModelTable {...props} /> : <GridTable {...props} />;
}

function ModelTable({ model, dir, caption }: ModelTableProps) {
  const [sort, setSort] = useState<SortState>(null);
  const [query, setQuery] = useState("");
  const { copied, copy } = useCopyFeedback();
  const width = model.header.length;
  const texts = useMemo(() => model.rows.map((row) => row.text), [model]);
  const numeric = useMemo(() => numericColumns(texts, width), [texts, width]);
  const order = useMemo(() => visibleRowOrder(texts, { query, sort, numeric }), [texts, query, sort, numeric]);
  const alignOf = (column: number): ColumnAlign => model.align[column] ?? (numeric[column] ? "right" : null);
  const headerText = model.header.map((cell) => cell.text);
  const shownText = order.map((index) => texts[index]!);
  const filterable = model.rows.length > FILTER_THRESHOLD;

  return (
    <div className="group/table my-2 min-w-0 overflow-hidden rounded-lg border border-hairline/40">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline/30 bg-raised/25 px-2 py-1 text-[11px] text-ink-secondary">
        <Table2 size={12} aria-hidden="true" className="shrink-0" />
        <span className="me-auto tabular-nums" aria-live="polite">
          {query && order.length !== model.rows.length
            ? t("rich.table.filtered", { shown: order.length, count: model.rows.length })
            : t("rich.table.rows", { count: model.rows.length })}
        </span>
        {filterable && (
          <label className="flex min-w-0 items-center gap-1 rounded border border-hairline/40 bg-panel px-1.5 py-0.5 focus-within:ring-2 focus-within:ring-accent/50">
            <Search size={11} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("rich.table.filter")}
              aria-label={t("rich.table.filter")}
              className="w-28 min-w-0 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-tertiary sm:w-36"
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => void copy("csv", tableToCsv(headerText, shownText))}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label={copied === "csv" ? t("rich.copied") : t("rich.table.copyCsv")}
          title={t("rich.table.copyCsv")}
        >
          {copied === "csv" ? <Check size={11} className="text-success" aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
          CSV
        </button>
        <button
          type="button"
          onClick={() => void copy("md", tableToMarkdown(headerText, shownText, model.align))}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label={copied === "md" ? t("rich.copied") : t("rich.table.copyMarkdown")}
          title={t("rich.table.copyMarkdown")}
        >
          {copied === "md" ? <Check size={11} className="text-success" aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
          Markdown
        </button>
      </div>
      <div className="max-h-[min(70vh,34rem)] overflow-auto overscroll-x-contain" tabIndex={0} role="region" aria-label={caption ?? t("rich.table.region")}>
        <table dir={dir} className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {model.header.map((cell, column) => {
                const active = sort?.column === column ? sort.direction : null;
                const align = alignOf(column);
                return (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined}
                    className={cn(
                      "sticky top-0 z-[1] border-b border-hairline/50 bg-card p-0 font-semibold whitespace-nowrap",
                      align === "right" ? "text-end" : align === "center" ? "text-center" : "text-start",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSort((current) => nextSort(current, column))}
                      title={t("rich.table.sort", { column: cell.text || String(column + 1) })}
                      className={cn(
                        "group/sort inline-flex w-full items-center gap-1 px-2.5 py-1.5 hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
                        align === "right" ? "flex-row-reverse text-end" : align === "center" ? "justify-center" : "text-start",
                      )}
                    >
                      <span className="min-w-0">{cell.content}</span>
                      {active === "asc" ? (
                        <ArrowUp size={11} aria-hidden="true" className="shrink-0 text-accent" />
                      ) : active === "desc" ? (
                        <ArrowDown size={11} aria-hidden="true" className="shrink-0 text-accent" />
                      ) : (
                        <ArrowUpDown size={11} aria-hidden="true" className="shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50 touch:opacity-50 motion-reduce:transition-none" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {order.map((index) => {
              const row = model.rows[index]!;
              return (
                <tr key={index} className="border-b border-hairline/20 last:border-b-0 hover:bg-raised/25">
                  {Array.from({ length: width }, (_unused, column) => {
                    const align = alignOf(column);
                    return (
                      <td
                        key={column}
                        className={cn(
                          "px-2.5 py-1.5 align-top",
                          numeric[column] && "tabular-nums whitespace-nowrap",
                          align === "right" ? "text-end" : align === "center" ? "text-center" : "text-start",
                        )}
                      >
                        {row.cells[column] ?? ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {order.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, width)} className="px-2.5 py-3 text-center text-[12px] text-ink-secondary">
                  {t("rich.table.noMatch")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface TableCell { text: string; content?: ReactNode }
export interface TableColumn extends TableCell { align?: "left" | "center" | "right" }
export interface RichTableProps { columns: TableColumn[]; rows: TableCell[][]; name?: string; expanded?: boolean; direction?: "rtl" | "ltr" }

/** Native modal supplies focus containment, Escape, inert background and focus restoration. */
export function TableDialog({ title, onClose, children, returnFocus }: { title: string; onClose: () => void; children: ReactNode; returnFocus: HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); if (returnFocus?.isConnected) returnFocus.focus(); };
  }, [returnFocus]);
  return createPortal(
    <dialog ref={ref} aria-labelledby={id} onCancel={onClose} onClose={onClose}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
      className="m-auto flex max-h-[94dvh] w-[min(96vw,1400px)] max-w-none flex-col overflow-hidden rounded-2xl border border-hairline bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/55">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline/40 px-4 py-3">
        <h2 id={id} className="min-w-0 truncate text-sm font-medium">{title}</h2>
        <button type="button" autoFocus onClick={onClose} className="table-action" aria-label={t("table.close")}><X size={16} /></button>
      </header>
      <div className="min-h-0 overflow-auto p-3 sm:p-5">{children}</div>
    </dialog>, document.body,
  );
}

function GridTable({ columns, rows, name = t("table.title"), expanded = false, direction = "ltr" }: RichTableProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sort, setSort] = useState<TableSort>(null);
  const [wrap, setWrap] = useState(true);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const values = useMemo(() => rows.map((row) => row.map((cell) => cell.text)), [rows]);
  const order = useMemo(() => tableRowOrder(values, deferredQuery, sort), [values, deferredQuery, sort]);
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);
  const csv = () => tableCsv(columns.map((column) => column.text), order.map((index) => values[index]!));
  const copy = async () => {
    const result = await copyText(csv());
    if (result !== "empty") setCopyState(result);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv()], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/\.(csv|tsv)$/i, "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 150) || "table"}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const surface = (large: boolean) => (
    <div className="rich-table min-w-0 max-w-full overflow-hidden rounded-xl border border-hairline/50 bg-panel text-ink" dir="ltr">
      <div className="flex flex-wrap items-center gap-1 border-b border-hairline/40 px-2 py-1.5">
        <label className="flex min-w-24 flex-1 items-center gap-2 px-1 text-ink-secondary">
          <Search size={13} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("table.search")}
            placeholder={t("table.search")} className="w-full min-w-0 bg-transparent py-1 text-xs text-ink outline-none placeholder:text-ink-tertiary focus-visible:ring-1 focus-visible:ring-accent" />
        </label>
        <button type="button" className="table-action" aria-label={t("table.wrap")} title={t("table.wrap")} aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={14} /></button>
        <button type="button" className="table-action" aria-label={t("table.copy")} title={t("table.copy")} onClick={() => void copy()}>{copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}</button>
        <button type="button" className="table-action" aria-label={t("table.download")} title={t("table.download")} onClick={download}><Download size={14} /></button>
        {!large && <button type="button" className="table-action" aria-label={t("table.expand")} title={t("table.expand")} onClick={(event) => { trigger.current = event.currentTarget; setOpen(true); }}><Maximize2 size={14} /></button>}
      </div>
      <TableViewport columns={columns} rows={rows} order={order} name={name} wrap={wrap} large={large} sort={sort} direction={direction}
        onSort={(column) => setSort(sort?.column !== column ? { column, descending: false } : !sort.descending ? { column, descending: true } : null)} />
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/40 px-3 py-2 text-[11px] text-ink-secondary">
        <span role="status">{t("table.count", { shown: order.length.toLocaleString(), total: rows.length.toLocaleString(), columns: columns.length })}</span>
        {copyState !== "idle" && <span role={copyState === "failed" ? "alert" : "status"}>{t(copyState === "failed" ? "table.copyFailed" : "table.copied")}</span>}
      </footer>
    </div>
  );
  return <><div hidden={open}>{surface(expanded)}</div>{open && <TableDialog title={name} returnFocus={trigger.current} onClose={() => setOpen(false)}>{surface(true)}</TableDialog>}</>;
}

function TableViewport({ columns, rows, order, name, wrap, large, sort, onSort, direction }: RichTableProps & {
  order: number[]; wrap: boolean; large: boolean; sort: TableSort; onSort: (column: number) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLTableSectionElement>(null);
  const [headingHeight, setHeadingHeight] = useState(40);
  useEffect(() => {
    if (!heading.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setHeadingHeight(entry.target.getBoundingClientRect().height); });
    observer.observe(heading.current);
    return () => observer.disconnect();
  }, []);
  const virtual = order.length > 80;
  const widths = useMemo(() => columns.map((column, index) => Math.min(320, Math.max(140,
    Math.max(column.text.length, ...rows.slice(0, 100).map((row) => Math.min(40, row[index]?.text.length ?? 0))) * 7 + 40,
  ))), [columns, rows]);
  const numeric = useMemo(() => columns.map((_, index) => {
    const nonempty = rows.slice(0, 200).map((row) => row[index]?.text.trim() ?? "").filter(Boolean);
    return nonempty.length > 0 && nonempty.every(isTableNumber);
  }), [columns, rows]);
  const virtualizer = useVirtualizer({ count: order.length, getScrollElement: () => scroll.current, estimateSize: () => 42,
    getItemKey: (index) => order[index]!, overscan: 6, enabled: virtual, initialRect: { width: 800, height: 400 }, scrollMargin: headingHeight });
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [order]);
  useEffect(() => { virtualizer.measure(); }, [wrap, widths, virtualizer]);
  const items = virtual ? virtualizer.getVirtualItems() : order.map((id, index) => ({ key: id, index, start: 0, end: 0 }));
  const before = virtual && items.length ? Math.max(0, items[0]!.start - headingHeight) : 0;
  const after = virtual && items.length ? Math.max(0, virtualizer.getTotalSize() - items.at(-1)!.end + headingHeight) : 0;
  const alignment = (column: TableColumn, index: number) => column.align ?? (numeric[index] || direction === "rtl" ? "right" : "left");
  return <div ref={scroll} tabIndex={0} role="region" aria-label={name} className="overflow-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
    style={{ maxHeight: large ? "65dvh" : 400 }}>
    <table dir={direction} aria-label={name} aria-rowcount={order.length + 1} className="w-full table-fixed border-separate border-spacing-0 text-[13px]" style={{ minWidth: widths.reduce((a, b) => a + b, 0) }}>
      <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead ref={heading} className="sticky top-0 z-10 bg-raised"><tr aria-rowindex={1}>
        {columns.map((column, index) => <th key={index} scope="col" aria-sort={sort?.column === index ? sort.descending ? "descending" : "ascending" : "none"}
          className="h-10 border-b border-hairline/60 px-3 py-2 font-medium" style={{ textAlign: alignment(column, index) }}>
          <div className="flex items-center gap-1">
            <span dir="auto" className="min-w-0 flex-1 break-words">{column.content ?? (column.text || t("table.column", { number: index + 1 }))}</span>
            <button type="button" className="table-action shrink-0" aria-label={t("table.sort", { column: column.text || index + 1 })} title={t("table.sort", { column: column.text || index + 1 })} onClick={() => onSort(index)}>
              {sort?.column === index && sort.descending ? <ArrowDown size={12} /> : <ArrowUp size={12} className={sort?.column === index ? "" : "opacity-35"} />}
            </button>
          </div>
        </th>)}
      </tr></thead>
      <tbody>
        {before > 0 && <tr aria-hidden="true"><td colSpan={columns.length} style={{ height: before, padding: 0 }} /></tr>}
        {items.map((item) => <tr key={item.key} data-index={item.index} ref={virtual ? virtualizer.measureElement : undefined} aria-rowindex={item.index + 2}
          className={item.index % 2 ? "bg-inset/35 hover:bg-raised/70" : "hover:bg-raised/70"}>
          {columns.map((column, index) => {
            const cell = rows[order[item.index]!]![index];
            return <td key={index} className="border-b border-hairline/20 px-3 py-2.5 align-top tabular-nums" style={{ textAlign: alignment(column, index) }}>
              <div dir="auto" title={!wrap ? cell?.text : undefined} className={wrap ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "truncate"}>{cell?.content ?? cell?.text}</div>
            </td>;
          })}
        </tr>)}
        {after > 0 && <tr aria-hidden="true"><td colSpan={columns.length} style={{ height: after, padding: 0 }} /></tr>}
      </tbody>
    </table>
    {order.length === 0 && <p className="p-8 text-center text-sm text-ink-secondary">{t(rows.length ? "table.noResults" : "table.empty")}</p>}
  </div>;
}
