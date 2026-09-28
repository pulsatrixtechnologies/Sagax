import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The sidebar passes the store dispatch. Static markup has no provider. */
const OrgNavContext = createContext<{
  dispatch: (action: { type: "select"; id: string }) => void;
  selectedId: string | null;
} | null>(null);

export function OrgSidebarNav({
  dispatch,
  selectedId,
  children,
}: {
  dispatch: (action: { type: "select"; id: string }) => void;
  selectedId: string | null;
  children: ReactNode;
}) {
  return <OrgNavContext.Provider value={{ dispatch, selectedId }}>{children}</OrgNavContext.Provider>;
}

export function OrgSidebar({
  orgName,
  channels,
  directs,
}: {
  orgName: string;
  channels: { id: string; name: string; preview: string }[];
  directs: { id: string; name: string }[];
}) {
  const nav = useContext(OrgNavContext);
  const dispatch: (action: { type: "select"; id: string }) => void = nav?.dispatch ?? (() => {});
  const selectedId = nav?.selectedId ?? null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="truncate px-2 py-1.5 text-[15px] font-medium text-ink">{orgName}</div>
      <ul className="flex flex-col gap-0.5">
        {channels.map((channel) => {
          const selected = selectedId === channel.id;
          return (
            <li key={channel.id}>
              <button
                type="button"
                data-sidebar-group-row={channel.id}
                aria-current={selected ? "page" : undefined}
                onClick={() => dispatch({ type: "select", id: channel.id })}
                className={cn(
                  "flex w-full flex-col rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/60",
                  selected ? "bg-raised/70" : "hover:bg-raised/40",
                )}
              >
                <span className="truncate text-[14px] font-semibold text-ink">{channel.name}</span>
                {channel.preview && (
                  <span className="truncate text-[11px] text-ink-secondary">{channel.preview}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-2 pb-1 pt-3 text-[12px] font-semibold text-ink-secondary">Direct</div>
      <ul className="flex flex-col gap-0.5">
        {directs.map((bot) => {
          const selected = selectedId === bot.id;
          return (
            <li key={bot.id}>
              <button
                type="button"
                data-sidebar-bot-row={bot.id}
                aria-current={selected ? "page" : undefined}
                onClick={() => dispatch({ type: "select", id: bot.id })}
                className={cn(
                  "flex w-full rounded-md px-2 py-1.5 text-left text-[14px] text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent/60",
                  selected ? "bg-raised/70" : "hover:bg-raised/40",
                )}
              >
                <span className="truncate">{bot.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
