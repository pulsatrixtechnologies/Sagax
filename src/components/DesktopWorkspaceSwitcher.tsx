import { useEffect, useState } from "react";
import { ChevronDown, Cloud, Laptop } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

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
    void bridge.menu().catch(() => setError(t("settings.thisComputer.menuError"))).finally(() => setOpen(false));
  };
  return { available: Boolean(bridge), current, open, error, openMenu };
}

export function ThisComputerSettings() {
  const workspace = useDesktopWorkspace();
  if (!workspace.available) return null;
  const name = workspace.current?.name ?? t("settings.thisComputer.title");
  const Icon = workspace.current?.local === false ? Cloud : Laptop;
  return (
    <div className="rounded-xl border border-hairline/40 px-3 py-2.5">
      <div className="text-[13px] font-medium text-ink">{t("settings.thisComputer.title")}</div>
      <p className="mt-1 text-[12px] text-ink-secondary">{workspace.current?.origin || t("settings.thisComputer.local")}</p>
      <button
        type="button"
        aria-label={t("settings.thisComputer.switch", { name })}
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

/** `inline` is the small pill that shares the sidebar's top row with the
 * traffic lights and the header buttons: icon, short name, tiny chevron,
 * truncating to whatever width the row leaves it. Inside a `sidebar-top`
 * container narrower than 164px it drops the name for icon + chevron; the
 * title and aria-label keep the full name.
 *
 * Outside the desktop app there is nothing to switch. */
export function DesktopWorkspaceSwitcher({ compact = false, inline = false }: { compact?: boolean; inline?: boolean }) {
  const { available, current, open, error, openMenu } = useDesktopWorkspace();
  if (!available) return null;
  const name = current?.name ?? t("settings.servers.unnamed");
  const Icon = current?.local === false ? Cloud : Laptop;
  const title = current?.origin ? `${name} · ${current.origin}` : name;
  if (inline) return <div data-workspace-switcher="inline" className="flex min-w-0">
    <button type="button" aria-label={t("settings.thisComputer.switch", { name })} aria-haspopup="menu" aria-expanded={open}
      title={title} onClick={openMenu}
      className="flex h-7 min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-left text-[12.5px] font-medium text-ink hover:bg-control focus-visible:outline focus-visible:outline-accent"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Icon size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <span className="min-w-0 truncate @max-[164px]/sidebar-top:hidden">{name}</span>
      <ChevronDown size={11} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </button>
    {error && <p role="alert" className="absolute right-2 top-full z-40 mt-1 w-56 max-w-[calc(100%-1rem)] rounded-md bg-menu px-2 py-1 text-[11px] text-danger shadow-lg">{error}</p>}
  </div>;
  return <div className={cn("py-1.5", compact ? "px-2" : "px-3")}>
    <button type="button" aria-label={t("settings.thisComputer.switch", { name })} aria-haspopup="menu" aria-expanded={open}
      title={title}
      onClick={openMenu}
      className={cn("flex w-full items-center gap-2 rounded-lg py-2 text-left text-[13px] font-medium text-ink hover:bg-control focus-visible:outline focus-visible:outline-accent", compact ? "justify-center px-1" : "px-2")}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Icon size={16} className="shrink-0 text-ink-secondary" />
      {!compact && <><span className="min-w-0 flex-1 truncate">{name}</span><ChevronDown size={13} className="shrink-0 text-ink-secondary" /></>}
    </button>
    {error && <p role="alert" className="mt-1 text-[11px] text-danger">{error}</p>}
  </div>;
}
