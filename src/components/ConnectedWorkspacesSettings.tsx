import { useEffect, useRef, useState } from "react";
import { Check, Cloud, Laptop, Loader2, Trash2 } from "lucide-react";
import { Card } from "./SettingsPrimitives";
import { t } from "@/lib/i18n";
import { ComputerSharingSettings } from "./ComputerSharingSettings";
import { useStore } from "@/state/store";
import { sharedComputersEnabled } from "@/lib/feature-flags";

type SavedWorkspaces = Awaited<ReturnType<NonNullable<NonNullable<Window["ogb"]>["environments"]>["state"]>>;

/** These are this desktop's connections, not a fleet administration API. */
export function ConnectedWorkspacesSettings() {
  const bridge = window.ogb?.environments;
  // Computer sharing is off unless this workspace's server turned it on. The
  // desktop bridge alone is not enough: never offer access the server refuses.
  const { state } = useStore();
  const sharingOffered = sharedComputersEnabled(state.config) && Boolean(window.ogb?.computerSharing);
  const [saved, setSaved] = useState<SavedWorkspaces | null>(null);
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [computerId, setComputerId] = useState<string | null>(() => new URLSearchParams(window.location?.search ?? "").get("share-computer"));
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    void bridge?.state().then((state) => { if (generation.current === current) setSaved(state); })
      .catch(() => { if (generation.current === current) setError(t("settings.servers.loadError")); });
    return () => { generation.current++; };
  }, [bridge]);
  useEffect(() => {
    const consume = (id?: string | null) => {
      if (id) setComputerId(id);
      const url = new URL(window.location.href);
      url.searchParams.delete("share-computer");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    };
    consume();
    return bridge?.onOpenSettings?.(consume);
  }, [bridge]);
  const perform = async (action: () => Promise<unknown>) => {
    if (pending.current || !bridge) return;
    pending.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      // A successful switch/connect unloads this local renderer. Do not ask
      // for its privileged saved list again after the active origin changes.
      if (await action() === true) return;
      const state = await bridge.state();
      if (generation.current === current) setSaved(state);
    } catch (nextError) {
      if (generation.current === current) setError(String((nextError as Error)?.message ?? nextError)
        .replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ""));
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  };
  if (!bridge) return <p className="text-[13px] text-ink-secondary">{t("settings.servers.desktopOnly")}</p>;
  const computerWorkspace = saved?.environments.find(entry => entry.id === computerId);
  return <>
    <p className="text-[13px] leading-relaxed text-ink-secondary">{t("settings.servers.intro")}</p>
    <Card
      collapsible
      cardId="organization.servers"
      title={t("settings.servers.title")}
      subtitle={t("settings.servers.subtitle")}
      summary={!saved ? t("common.checking") : t("settings.card.current", {
        name: saved.environments.find((entry) => entry.id === saved.activeId)?.name ?? t("settings.thisComputer.title"),
      })}
    >
      {!saved ? <p role="status" className="text-[13px] text-ink-secondary">{error ? t("settings.servers.couldNot") : t("settings.servers.loading")}</p> :
        <ul className="divide-y divide-hairline/40">
          {[{ id: "local", name: t("settings.thisComputer.title"), origin: "" }, ...saved.environments].map((entry) => {
            const active = entry.id === saved.activeId;
            const Icon = entry.id === "local" ? Laptop : Cloud;
            return <li key={entry.id} className="flex items-center gap-3 py-3">
              <Icon size={18} className="shrink-0 text-ink-secondary" />
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-ink">{entry.name}</div>
                <div className="break-all text-[12px] text-ink-secondary">{entry.origin || t("settings.thisComputer.local")}</div></div>
              {active ? <span className="flex shrink-0 items-center gap-1 text-[12px] text-ink-secondary"><Check size={13} />{t("settings.servers.current")}</span> :
                <button type="button" disabled={busy} aria-label={t("settings.servers.switchTo", { name: entry.name })} onClick={() => void perform(async () => { await bridge.switch(entry.id); return true; })}
                  className="rounded-md px-2 py-1.5 text-[12px] text-ink hover:bg-control disabled:opacity-50">{t("settings.servers.switch")}</button>}
              {entry.id !== "local" && sharingOffered && <button type="button" disabled={busy} aria-label={t("settings.servers.accessFor", { name: entry.name })} onClick={() => setComputerId(entry.id)} className="rounded-md px-2 py-1.5 text-[12px] text-ink hover:bg-control">{t("settings.servers.access")}</button>}
              {entry.id !== "local" && <button type="button" disabled={busy} aria-label={t("settings.servers.forget", { name: entry.name })} title={t("settings.servers.forget", { name: entry.name })}
                onClick={() => void perform(() => bridge.forget(entry.id))} className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"><Trash2 size={14} /></button>}
            </li>;
          })}
        </ul>}
    </Card>
    {sharingOffered && computerWorkspace && <ComputerSharingSettings key={computerWorkspace.id} workspace={computerWorkspace} onClose={() => setComputerId(null)} />}
    <Card
      collapsible
      cardId="organization.connectServer"
      defaultOpen={false}
      title={t("settings.servers.connectTitle")}
      subtitle={t("settings.servers.connectSubtitle")}
      summary={t("settings.card.byLink")}
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (address.trim()) void perform(() => bridge.addFromLink(address.trim(), name.trim()));
      }}>
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{t("settings.servers.address")}
          <input required value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)}
            placeholder="https://bots.yourcompany.com" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{t("settings.servers.name")}
          <input value={name} disabled={busy} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={t("settings.servers.namePlaceholder")}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
        </label>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("settings.servers.paste")}</p>
        <details className="text-[12px] text-ink-secondary"><summary className="cursor-pointer">{t("settings.servers.needCode")}</summary>
          <p className="mt-2">{t("settings.servers.run")}</p>
          <code className="mt-1 block select-all break-words rounded-md bg-inset px-2 py-2 text-ink">npx openmausbot pair --label "My desktop"</code>
        </details>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        <button type="submit" disabled={busy || !address.trim()} className="flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />}{t("settings.servers.connect")}
        </button>
      </form>
    </Card>
  </>;
}
