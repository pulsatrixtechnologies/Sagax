// Settings > Models > Keys: the named OpenAI-compatible servers (2026-10-30,
// lot 0 of "Providers, models and voice"). "Other (OpenAI-compatible)" is
// one address; each server added here is a provider of its own in the model
// picker, under its own name (Azure AI Foundry, a vLLM box, a gateway). The
// server keeps them (server/openai-compat-servers.ts): POST, PATCH and
// DELETE /api/instances/openai-compat-servers. A key is write-only: a row
// says whether one is saved, never its value.
import { useState, type FormEvent } from "react";
import { Loader2, Plus, Server } from "lucide-react";

import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PILL } from "../SettingsPrimitives";

export interface CompatServerRow {
  instanceId: string;
  name: string;
  url: string;
  configured: boolean;
}

const FIELD = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none";

/** The add or edit form. `server` set: edit (an empty key keeps the saved one). */
function ServerForm({ server, onDone }: { server?: CompatServerRow; onDone: () => void }) {
  const { refreshInstances } = useStore();
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim() || !url.trim()) return;
    setBusy(true);
    setError(null);
    const body = server
      ? { ...(name.trim() !== server.name ? { displayName: name.trim() } : {}), ...(url.trim() !== server.url ? { url: url.trim() } : {}), ...(key.trim() ? { key: key.trim() } : {}) }
      : { displayName: name.trim(), url: url.trim(), ...(key.trim() ? { key: key.trim() } : {}) };
    if (server && Object.keys(body).length === 0) { setBusy(false); onDone(); return; }
    api(server ? `/api/instances/openai-compat-servers/${encodeURIComponent(server.instanceId)}` : "/api/instances/openai-compat-servers", {
      method: server ? "PATCH" : "POST",
      body: JSON.stringify(body),
    })
      .then(() => Promise.resolve(refreshInstances()).catch(() => {}))
      .then(onDone)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <form onSubmit={submit} data-compat-server-form={server?.instanceId ?? "new"} className="mx-1.5 flex flex-col gap-2 rounded-lg bg-inset/40 px-2 py-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("compatServers.namePlaceholder")} aria-label={t("compatServers.name")} maxLength={80} className={FIELD} />
      <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://my-resource.openai.azure.com/openai/v1" aria-label={t("compatServers.url")} spellCheck={false} className={cn(FIELD, "font-mono")} />
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off"
        placeholder={server?.configured ? t("compatServers.keyKeep") : t("compatServers.keyPlaceholder")} aria-label={t("compatServers.key")} className={cn(FIELD, "font-mono")} />
      <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("compatServers.hint")}</p>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className={PILL}>{t("common.cancel")}</button>
        <button type="submit" disabled={busy || !name.trim() || !url.trim()} className={cn(PILL, "inline-flex items-center gap-1.5")}>
          {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
          {server ? t("common.save") : t("compatServers.add")}
        </button>
      </div>
    </form>
  );
}

/** The named servers, each with Edit and Remove, then "Add an
 * OpenAI-compatible server". */
export function OpenAiCompatServers() {
  const { state, refreshInstances } = useStore();
  const servers: CompatServerRow[] = state.config?.openaiCompatServers ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = (server: CompatServerRow) => {
    setError(null);
    api(`/api/instances/openai-compat-servers/${encodeURIComponent(server.instanceId)}`, { method: "DELETE" })
      .then(() => Promise.resolve(refreshInstances()).catch(() => {}))
      .catch((e: Error) => setError(e.message));
  };
  return (
    <div data-compat-servers="" className="flex flex-col gap-1">
      {servers.map((server) => editing === server.instanceId
        ? <ServerForm key={server.instanceId} server={server} onDone={() => setEditing(null)} />
        : (
          <div key={server.instanceId} data-compat-server={server.instanceId} className="mx-1.5 flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-1.5">
            <Server size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-[18px] text-ink">{server.name}</span>
              <span className="block truncate font-mono text-[11.5px] leading-4 text-ink-secondary" title={server.url}>{server.url}</span>
              <span className={cn("block text-[12px] leading-4", server.configured ? "text-accent-text" : "text-ink-secondary")}>
                {server.configured ? t("providerKeys.saved") : t("providerKeys.none")}
              </span>
            </span>
            <button type="button" onClick={() => setEditing(server.instanceId)} aria-label={`${t("compatServers.edit")} · ${server.name}`} className={cn(PILL, "shrink-0")}>{t("compatServers.edit")}</button>
            <button type="button" onClick={() => remove(server)} aria-label={`${t("compatServers.remove")} · ${server.name}`} className={cn(PILL, "shrink-0")}>{t("compatServers.remove")}</button>
          </div>
        ))}
      {error && <p role="alert" className="mx-3.5 text-[12px] text-danger">{error}</p>}
      {editing === "new" ? <ServerForm onDone={() => setEditing(null)} /> : (
        <button type="button" data-compat-server-add onClick={() => setEditing("new")}
          className="mx-1.5 flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-accent-text hover:bg-hover">
          <Plus size={14} aria-hidden="true" className="shrink-0" />
          {t("compatServers.addTitle")}
        </button>
      )}
    </div>
  );
}
