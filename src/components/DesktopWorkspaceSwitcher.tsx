import { useEffect, useState } from "react";
import { ChevronDown, Cloud, Laptop } from "lucide-react";
import { cn } from "@/lib/cn";

/** The dropdown is native: a remote workspace cannot choose a destination
 * itself or read the other workspaces saved on this computer. */
export function useDesktopWorkspace() {
  const bridge = window.ogb?.workspaces;
  const [current, setCurrent] = useState<{ local: boolean; name: string; origin?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void bridge?.state().then((state) => { if (alive) setCurrent(state); }).catch(() => {});
    return () => { alive = false; };
  }, [bridge]);
  const openMenu = () => {
    if (!bridge || open) return;
    setError("");
    setOpen(true);
    void bridge.menu().catch(() => setError("Could not open the server list. Try the Server menu.")).finally(() => setOpen(false));
  };
  return { available: Boolean(bridge), current, open, error, openMenu };
}

export function ThisComputerSettings() {
  const workspace = useDesktopWorkspace();
  if (!workspace.available) return null;
  const name = workspace.current?.name ?? "This computer";
  const Icon = workspace.current?.local === false ? Cloud : Laptop;
  return (
    <div className="rounded-xl border border-hairline/40 px-3 py-2.5">
      <div className="text-[13px] font-medium text-ink">This computer</div>
      <p className="mt-1 text-[12px] text-ink-secondary">{workspace.current?.origin || "Local bots and conversations"}</p>
      <button
        type="button"
        aria-label={`Switch server: ${name}`}
        aria-haspopup="menu"
        aria-expanded={workspace.open}
        onClick={workspace.openMenu}
        className="mt-3 flex w-full items-center gap-2 rounded-lg border border-hairline/40 px-3 py-2 text-left text-[13px] font-medium text-ink hover:bg-raised/40"
      >
        <Icon size={16} className="shrink-0 text-ink-secondary" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ChevronDown size={13} className="shrink-0 text-ink-secondary" />
      </button>
      {workspace.error && <p role="alert" className="mt-2 text-[12px] text-danger">{workspace.error}</p>}
    </div>
  );
}

export function DesktopWorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { available, current, open, error, openMenu } = useDesktopWorkspace();
  if (!available) return null;
  const name = current?.name ?? "Servers";
  const Icon = current?.local === false ? Cloud : Laptop;
  return <div className={cn("py-1.5", compact ? "px-2" : "px-3")}>
    <button type="button" aria-label={`Switch server: ${name}`} aria-haspopup="menu" aria-expanded={open}
      title={current?.origin ? `${name} · ${current.origin}` : name}
      onClick={openMenu}
      className={cn("flex w-full items-center gap-2 rounded-lg py-2 text-left text-[13px] font-medium text-ink hover:bg-control focus-visible:outline focus-visible:outline-accent", compact ? "justify-center px-1" : "px-2")}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Icon size={16} className="shrink-0 text-ink-secondary" />
      {!compact && <><span className="min-w-0 flex-1 truncate">{name}</span><ChevronDown size={13} className="shrink-0 text-ink-secondary" /></>}
    </button>
    {error && <p role="alert" className="mt-1 text-[11px] text-danger">{error}</p>}
  </div>;
}
