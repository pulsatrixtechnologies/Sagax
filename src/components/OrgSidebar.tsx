import { createContext, useContext, type ReactNode } from "react";
import { Users } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

/** The sidebar passes the store dispatch. Static markup has no provider. */
const OrgNavContext = createContext<{
  dispatch: (action: { type: "select"; id: string }) => void;
  selectedId: string | null;
} | null>(null);

function ChannelFaces({ members }: { members: Bot[] }) {
  const shown = members.slice(0, 3);
  if (shown.length === 0) {
    return (
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary">
        <Users size={18} />
      </span>
    );
  }
  if (shown.length === 1) {
    return <BotAvatar bot={shown[0]} state="idle" size={40} animated={false} />;
  }
  const spots = shown.length === 2
    ? ["left-0 top-1", "right-0 bottom-0"]
    : ["left-0 top-0", "left-0.5 bottom-0", "right-0 bottom-0.5"];
  return (
    <span className="relative size-11 shrink-0">
      {shown.map((bot, index) => (
        <span key={bot.id} className={cn("absolute rounded-full ring-2 ring-panel", spots[index])}>
          <BotAvatar bot={bot} state="idle" size={22} animated={false} />
        </span>
      ))}
    </span>
  );
}

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
  channels = [],
}: {
  orgName?: string;
  channels?: { id: string; name: string; preview: string; members?: Bot[] }[];
  directs?: { id: string; name: string }[];
}) {
  const nav = useContext(OrgNavContext);
  const dispatch: (action: { type: "select"; id: string }) => void = nav?.dispatch ?? (() => {});
  const selectedId = nav?.selectedId ?? null;
  return (
    <div className="flex flex-col gap-0.5">
      {channels.length > 0 && (<ul className="flex flex-col gap-0.5">
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
                  "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/60",
                  selected ? "bg-raised/70" : "hover:bg-raised/40",
                )}
              >
                <ChannelFaces members={channel.members ?? []} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{channel.name}</span>
                  {channel.preview ? (
                    <span className="block truncate text-[12px] text-ink-secondary">{channel.preview}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>)}
    </div>
  );
}
