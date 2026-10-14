// One recursive renderer for every node a chat widget can hold
// (docs/superpowers/specs/2026-10-13-chat-widgets-design.md, "Nodes"). It
// reads canonical trees only and never throws on one: a type this build does
// not know draws its children, or nothing.
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { widgetNumber, widgetString, type WidgetNode } from "../../../shared/widget";
import { ChatMarkdown } from "../ChatMarkdown";
import { WidgetChart } from "./WidgetChart";
import { WidgetBadge, WidgetImage, WidgetProgress } from "./WidgetContent";
import {
  useWidgetForm, widgetActionUrl, widgetCanPress, widgetFieldId, WidgetButton, WidgetCheckbox, WidgetDatePicker, WidgetGlyph, WidgetInput,
  WidgetRadioGroup, WidgetSelect, WidgetTextarea, type WidgetForm,
} from "./WidgetControls";
import {
  ALIGN, BACKGROUND, boxStyle, CAPTION_SIZE, COL_SIZE, ICON_SIZE, INK, JUSTIFY, kids, TEXT_ALIGN, TEXT_SIZE, TITLE_SIZE, WEIGHT, widthStyle,
} from "./widget-style";

/** What a node needs to know about where it is drawn. */
export interface WidgetWhere {
  /** The direction its parent lays its children out in. */
  axis: "row" | "col";
  /** The room its parent leaves under it, before the next child. */
  gap: number;
  /** Inside a list row, where every line is one line. */
  item?: boolean;
  /** The first thing in a list row: an icon or image there is its thumbnail. */
  lead?: boolean;
  /** A direct child of the card, with the card's padding: a Row there is a
   * key-value row, and a flush node runs out to these edges. */
  card?: { top: number; left: number; right: number };
  /** The room a Divider leaves before and after itself when it names none. */
  room?: readonly [number, number];
  /** Already inside a Form: a Form further in is a plain box. */
  form?: boolean;
}

const FIELDS = new Set(["Select", "DatePicker", "Checkbox", "RadioGroup", "Input", "Textarea"]);
/** On a card these lines are a tint of the ink: the hairline token sits one
 * shade off the composer tone in the dark skins and would not show. */
const RULE = "bg-ink/[0.08]";

export function WidgetChildren({ nodes, where }: { nodes: WidgetNode[]; where: WidgetWhere }) {
  return <>{nodes.map((child, index) => <WidgetNodeView key={child.id ?? index} node={child} where={where} />)}</>;
}

export function WidgetNodeView({ node, where }: { node: WidgetNode; where: WidgetWhere }): ReactNode {
  // beside its label in a row, a field drops its box unless it asks for the full width
  const bare = where.axis === "row" && node.block !== true;
  switch (node.type) {
    case "Box": case "Row": case "Col": case "Form":
      return <Layout node={node} where={where} />;
    case "ListViewItem":
      return <WidgetListRow node={node} />;
    case "Spacer": {
      const min = widgetNumber(node, "minSize");
      return <div aria-hidden="true" className="min-h-0 min-w-0 flex-1" style={min === undefined ? undefined : where.axis === "row" ? { minWidth: min } : { minHeight: min }} />;
    }
    case "Divider":
      return <Divider node={node} where={where} />;
    case "Table":
      return <Table node={node} />;
    case "Text": case "Title": case "Caption":
      return <TextNode node={node} where={where} />;
    case "Label":
      return <LabelNode node={node} where={where} />;
    case "Markdown":
      // the app's own renderer, with the chat's 1.75 line box brought down to the card's
      return <div className="min-w-0 text-[14px] text-ink [&_.chat-md]:leading-[21px]!"><ChatMarkdown text={widgetString(node, "value") ?? ""} /></div>;
    case "Image":
      return <WidgetImage node={node} where={where} />;
    case "Icon": {
      const size = ICON_SIZE[widgetString(node, "size") ?? "md"] ?? ICON_SIZE.md;
      const ink = INK[widgetString(node, "color") ?? ""];
      if (!(where.item && where.lead)) return <WidgetGlyph name={node.name} size={size} className={ink} />;
      return (
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-inset group-hover/row:bg-composer group-aria-checked/row:bg-composer", ink ?? "text-ink-secondary")}>
          <WidgetGlyph name={node.name} size={size} />
        </span>
      );
    }
    case "Chart":
      return <WidgetChart node={node} />;
    case "Badge":
      return <WidgetBadge node={node} />;
    case "Progress":
      return <WidgetProgress node={node} />;
    case "Button":
      return (
        <WidgetButton
          actionRef={node.id}
          label={widgetString(node, "label")}
          look={widgetString(node, "style") ?? "secondary"}
          iconStart={node.iconStart}
          iconEnd={node.iconEnd}
          block={node.block === true}
          disabled={node.disabled === true}
        />
      );
    case "Select":
      return <WidgetSelect node={node} bare={bare} />;
    case "DatePicker":
      return <WidgetDatePicker node={node} bare={bare} />;
    case "Checkbox":
      return <WidgetCheckbox node={node} />;
    case "RadioGroup":
      return <WidgetRadioGroup node={node} />;
    case "Input":
      return <WidgetInput node={node} bare={bare} />;
    case "Textarea":
      return <WidgetTextarea node={node} />;
    // Transition draws its one child. So does anything else that has children.
    default:
      return <WidgetChildren nodes={kids(node)} where={where} />;
  }
}

/** The first submit Button under a Form: what Enter in one of its fields presses. */
function submitRef(node: WidgetNode, form: WidgetForm): string | undefined {
  for (const child of kids(node)) {
    const entry = child.type === "Button" && child.submit === true ? form.actions.get(child.id) : undefined;
    // never a link: a keystroke in a field must not open an address the bot chose
    if (entry?.tone === "submit" && !entry.client) return child.id;
    const inner = submitRef(child, form);
    if (inner) return inner;
  }
  return undefined;
}

function Layout({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const form = useWidgetForm();
  const axis = node.type === "Row" || (node.type !== "Col" && node.direction === "row") ? "row" : "col";
  const gap = widgetNumber(node, "gap") ?? (axis === "row" ? 8 : node.type === "Form" ? 12 : 0);
  const isForm = node.type === "Form";
  const className = cn(
    "flex min-w-0",
    axis === "row" ? "flex-row" : "flex-col",
    ALIGN[widgetString(node, "align") ?? (axis === "row" ? "center" : "stretch")],
    JUSTIFY[widgetString(node, "justify") ?? ""],
    node.wrap === true && "flex-wrap",
    BACKGROUND[widgetString(node, "background") ?? ""],
    widgetNumber(node, "border") ? "border-solid border-ink/[0.12]" : null,
    // label on one side, value on the other: the mock's 44px row
    where.card && node.type === "Row" && "min-h-[44px]",
  );
  const style: CSSProperties = { gap, ...boxStyle(node) };
  const children = <WidgetChildren nodes={kids(node)} where={{ axis, gap, item: where.item, form: where.form || isForm, room: gap > 0 ? [0, 0] : [8, 8] }} />;
  if (!isForm || where.form) return <div className={className} style={style}>{children}</div>;
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const target = event.target;
    if (event.key !== "Enter" || event.nativeEvent.isComposing || !(target instanceof HTMLInputElement) || target.type === "checkbox" || target.type === "radio") return;
    event.preventDefault();
    const ref = submitRef(node, form);
    if (ref) form.press(ref);
  };
  return <form noValidate onSubmit={(event) => event.preventDefault()} onKeyDown={onKeyDown} className={className} style={style}>{children}</form>;
}

/** The box of a list row, and what inside one takes a click of its own. */
export const WIDGET_ROW = "flex min-h-[60px] w-full min-w-0 rounded-[12px] px-3 py-2.5 text-start";
export const WIDGET_ROW_CONTROLS = "button, a, input, select, textarea, label, [role='button']";

/** A list row: 60px, the whole of it the target when it has an action. A row
 * that holds a control of its own cannot be a button around a button, so it
 * takes the button's role and keys instead. */
export function WidgetListRow({ node }: { node: WidgetNode }) {
  const form = useWidgetForm();
  const entry = form.actions.get(node.id);
  const live = widgetCanPress(form, entry);
  const style: CSSProperties = { gap: widgetNumber(node, "gap") ?? 12 };
  const shape = cn(WIDGET_ROW, ALIGN[widgetString(node, "align") ?? "center"]);
  const content = kids(node).map((child, index) => (
    <WidgetNodeView key={child.id ?? index} node={child} where={{ axis: "row", gap: style.gap as number, item: true, lead: index === 0 }} />
  ));
  if (!entry) return <div className={shape} style={style}>{content}</div>;
  const pressed = form.pendingRef === node.id
    ? <LoaderCircle aria-hidden="true" size={14} className="shrink-0 animate-spin text-ink-tertiary" />
    : form.sentRef === node.id ? <Check aria-hidden="true" size={14} className="shrink-0 text-success" /> : null;
  // `group/row` only while the row can be pressed: it is what turns the thumbnail to the card's tone on the hover fill
  const className = cn(shape, "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", live ? "group/row cursor-pointer hover:bg-inset active:bg-inset" : "cursor-default");
  const shared = { "data-widget-ref": node.id, "aria-busy": form.pendingRef === node.id || undefined, title: widgetActionUrl(entry), className, style };
  if (!holdsControl(node)) {
    return <button type="button" {...shared} disabled={!live} onClick={() => form.press(node.id)}>{content}{pressed}</button>;
  }
  return (
    <div
      role="button"
      tabIndex={live ? 0 : -1}
      aria-disabled={!live || undefined}
      {...shared}
      onClick={(event) => {
        // a press on a button, field, link or row inside this one is that control's, not this row's
        const inner = (event.target as Element).closest(WIDGET_ROW_CONTROLS);
        if (live && (!inner || inner === event.currentTarget)) form.press(node.id);
      }}
      onKeyDown={(event) => {
        if (!live || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        form.press(node.id);
      }}
    >
      {content}{pressed}
    </div>
  );
}

/** Whether a row holds something that takes a click of its own: a button, a field, a gated image, a row inside
 * it, or Markdown (which may hold a link). Such a row cannot be a real button around them. */
const CLICKABLE = new Set(["Button", "Image", "ListViewItem", "Markdown"]);
function holdsControl(node: WidgetNode): boolean {
  return kids(node).some((child) => CLICKABLE.has(child.type) || FIELDS.has(child.type) || holdsControl(child));
}

function Divider({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const spacing = widgetNumber(node, "spacing");
  const [before, after] = spacing === undefined ? where.room ?? [0, 0] : [spacing, spacing];
  if (where.axis === "row") {
    return <div role="separator" aria-orientation="vertical" className={cn("w-px shrink-0 self-stretch", RULE)} style={{ marginInlineStart: before, marginInlineEnd: after }} />;
  }
  const edge = node.flush === true ? where.card : undefined;
  return <div role="separator" className={cn("h-px shrink-0", RULE)} style={{ marginTop: before, marginBottom: after, ...(edge ? { marginLeft: -edge.left, marginRight: -edge.right } : {}) }} />;
}

const V_ALIGN: Record<string, string> = { start: "align-top", center: "align-middle", end: "align-bottom" };

function Table({ node }: { node: WidgetNode }) {
  const rows = kids(node);
  const head = rows.findIndex((row) => row.header !== true);
  const split = head < 0 ? rows.length : head;
  const draw = (row: WidgetNode, ruled: boolean) => (
    <tr key={row.id} className={cn(row.header === true ? "h-8 text-[12px] leading-4 text-ink-tertiary" : "h-10", ruled && "border-t border-ink/[0.08]")}>
      {kids(row).map((cell, index) => {
        const Cell = row.header === true ? "th" : "td";
        const column = COL_SIZE[widgetString(cell, "colSize") ?? ""];
        return (
          <Cell
            key={cell.id ?? index}
            scope={row.header === true ? "col" : undefined}
            colSpan={widgetNumber(cell, "colSpan")}
            rowSpan={widgetNumber(cell, "rowSpan")}
            className={cn("py-1.5 font-normal", index > 0 && "ps-3", TEXT_ALIGN[widgetString(cell, "align") ?? "start"], V_ALIGN[widgetString(cell, "vAlign") ?? "center"])}
            // a width of its own wins over the column's size token
            style={{ ...(column ? { width: column } : {}), ...boxStyle(cell) }}
          >
            <WidgetChildren nodes={kids(cell)} where={{ axis: "col", gap: 0 }} />
          </Cell>
        );
      })}
    </tr>
  );
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-[14px] leading-5 tabular-nums text-ink">
        {split > 0 && <thead>{rows.slice(0, split).map((row) => draw(row, false))}</thead>}
        <tbody>{rows.slice(split).map((row, index) => draw(row, index > 0 || split > 0))}</tbody>
      </table>
    </div>
  );
}

const TYPE: Record<string, { sizes: Record<string, readonly [string, number]>; weight?: string; ink: string }> = {
  Text: { sizes: TEXT_SIZE, ink: "text-ink" },
  Title: { sizes: TITLE_SIZE, weight: "font-semibold", ink: "text-ink" },
  Caption: { sizes: CAPTION_SIZE, ink: "text-ink-secondary" },
};

function TextNode({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const face = TYPE[node.type] ?? TYPE.Text!;
  const [size, line] = face.sizes[widgetString(node, "size") ?? "md"] ?? face.sizes.md!;
  const maxLines = widgetNumber(node, "maxLines");
  const minLines = widgetNumber(node, "minLines");
  // a list row never wraps: its lines are one line each unless one asks for more
  const oneLine = node.truncate === true || (where.item === true && maxLines === undefined);
  const value = widgetString(node, "value") ?? "";
  const style: CSSProperties = {
    ...(maxLines && !oneLine ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: maxLines, overflow: "hidden" } : {}),
    ...(minLines ? { minHeight: minLines * line } : {}),
    ...widthStyle(node),
  };
  return (
    <div
      dir="auto"
      title={oneLine ? value : undefined}
      className={cn(
        "min-w-0", size, WEIGHT[widgetString(node, "weight") ?? ""] ?? face.weight, INK[widgetString(node, "color") ?? ""] ?? face.ink,
        TEXT_ALIGN[widgetString(node, "textAlign") ?? ""], node.italic === true && "italic", node.lineThrough === true && "line-through",
        oneLine ? "truncate" : "whitespace-pre-line break-words",
      )}
      style={style}
    >
      {value}
    </div>
  );
}

/** Above its field a label is 12/500 and sits 6px off it, whatever room the
 * stack leaves; beside it, in a row, it is the row's 14px in the secondary ink. */
function LabelNode({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const form = useWidgetForm();
  const field = form.fields.get(widgetString(node, "fieldName") ?? "");
  const above = where.axis === "col";
  return (
    <label
      // a radio group goes by its own name: a click on its label must not pick the first option
      htmlFor={field && field.type !== "RadioGroup" ? widgetFieldId(form, field.name) : undefined}
      dir="auto"
      className={cn(
        "min-w-0", above ? "ms-0.5 block" : "shrink-0",
        TEXT_SIZE[widgetString(node, "size") ?? ""]?.[0] ?? (above ? "text-[12px] leading-4" : "text-[14px] leading-5"),
        WEIGHT[widgetString(node, "weight") ?? ""] ?? (above ? "font-medium" : null), INK[widgetString(node, "color") ?? ""] ?? "text-ink-secondary",
        TEXT_ALIGN[widgetString(node, "textAlign") ?? ""],
      )}
      style={{ ...widthStyle(node), ...(above ? { marginBottom: 6 - where.gap } : {}) }}
    >
      {widgetString(node, "value") ?? ""}
    </label>
  );
}
