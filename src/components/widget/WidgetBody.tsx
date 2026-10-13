// The inside of a widget's card, under its header: a Card stacks its children
// to the mock's rhythm, a ListView draws its rows and folds the ones past
// `limit` behind "Show all".
import { Fragment, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { widgetNumber, type WidgetNode } from "../../../shared/widget";
import { WidgetListRow, WidgetNodeView } from "./WidgetNodes";
import { fourSides, kids } from "./widget-style";

/** Rows that bring their own height (44px) and are parted by a rule, not by room. */
const isRow = (node: WidgetNode | undefined): boolean => node?.type === "Row" || node?.type === "Checkbox";
/** Rows of any kind sit closer to the card's edge than text does. */
const isRows = (node: WidgetNode | undefined): boolean => isRow(node) || node?.type === "Table" || node?.type === "ListViewItem";

/** The room between two children of a card. A Divider carries its own. */
function roomBetween(above: WidgetNode | undefined, below: WidgetNode | undefined): number {
  if (!above || !below || above.type === "Divider" || below.type === "Divider") return 0;
  return isRow(above) && isRow(below) ? 0 : 12;
}

export function WidgetBody({ root, headed }: { root: WidgetNode; headed: boolean }) {
  const children = kids(root);
  if (root.type === "ListView") return <ListBody root={root} items={children} headed={headed} />;
  if (!children.length) return null;
  // 20 at the sides. Under a header the header's own foot is the room above;
  // without one, rows start 6 from the edge and anything else 18.
  const [top, right, bottom, left] = fourSides(root.padding)
    ?? [headed ? 0 : isRows(children[0]) ? 6 : 18, 20, isRows(children[children.length - 1]) ? 8 : 18, 20];
  return (
    <div className="flex min-w-0 flex-col" style={{ padding: `${top}px ${right}px ${bottom}px ${left}px` }}>
      {children.map((child, index) => {
        const room = roomBetween(children[index - 1], child);
        return (
          <Fragment key={child.id ?? index}>
            {room > 0 && <div aria-hidden="true" className="shrink-0" style={{ height: room }} />}
            <WidgetNodeView
              node={child}
              where={{
                axis: "col",
                gap: roomBetween(child, children[index + 1]),
                card: { top: index === 0 ? top : 0, left, right },
                room: [isRow(children[index - 1]) ? 0 : 12, isRow(children[index + 1]) ? 0 : 12],
              }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

function ListBody({ root, items, headed }: { root: WidgetNode; items: WidgetNode[]; headed: boolean }) {
  const [all, setAll] = useState(false);
  const limit = widgetNumber(root, "limit");
  const shown = limit && !all && items.length > limit ? items.slice(0, limit) : items;
  if (!items.length) return null;
  return (
    <div className={cn("flex min-w-0 flex-col px-2 pb-2", !headed && "pt-2")}>
      <div role="list" className="flex min-w-0 flex-col">
        {shown.map((item, index) => (
          <div role="listitem" key={item.id ?? index} className="flex min-w-0">
            {item.type === "ListViewItem" ? <WidgetListRow node={item} /> : <WidgetNodeView node={item} where={{ axis: "col", gap: 0 }} />}
          </div>
        ))}
      </div>
      {shown.length < items.length && (
        // unfolding is the reader's own: it works on a settled, read-only card too
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex min-h-11 w-full items-center rounded-[12px] px-3 text-start text-[13px] font-medium leading-[18px] text-ink-secondary transition-colors hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t("widget.showAll", { count: items.length })}
        </button>
      )}
    </div>
  );
}
