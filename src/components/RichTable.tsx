// One table view for every tabular thing in a message: GFM tables (whose cells
// keep their rendered Markdown: links, mentions, code) and ```csv fences.
// Sticky header, hairline rows, horizontal scroll inside the bubble,
// numeric columns right-aligned with tabular figures, click-to-sort headers,
// a filter box once a table is large, and copy as CSV or Markdown.
import { Children, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Search, Table2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
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

export function RichTable({ model, dir, caption }: { model: TableModel; dir?: "ltr" | "rtl"; caption?: string }) {
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
              className="w-28 min-w-0 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-secondary/70 sm:w-36"
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
        <table dir={dir} className="w-full border-collapse text-[13.5px]">
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
                        <ArrowUpDown size={11} aria-hidden="true" className="shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50 motion-reduce:transition-none" />
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
