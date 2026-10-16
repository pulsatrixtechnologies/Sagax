// "Create a Team Bot from this conversation" (thread menu, 2026-10-16; parity
// with Grok Bot's team bot from a conversation, with or without its memory).
//
// 1. The draft: name, role, description and instructions, written by the
//    conversation's own bot model from the conversation
//    (POST /api/bots/:id/team-bot-draft, server/team-bot-draft.ts); editable.
// 2. What carries over: the source bot's plugins and connectors, one box
//    each, ticked; and its memory, OFF by default. Ticking memory lists
//    exactly what goes (each note, and the conversation summary) before
//    anything is created.
// 3. Create: the ordinary POST /api/bots, then the instructions, the
//    connectors, the plugins (/api/bots/:id/plugins/install) and, only when
//    opted in, the memory (POST /api/bots/:source/team-bot-carry).
// 4. Publish: the existing Team Bot path. On an organization server the new
//    bot's Sharing opens (grants through Perspicax); on this computer alone,
//    the new bot opens. The app adds no multi-person view of its own.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, ShieldCheck, Sparkles, UsersRound, X } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { closeTeamBotFromThread, setTeamBotSources, useTeamBotFromThreadRequest, type TeamBotFromThreadRequest } from "@/lib/teambot-from-thread";
import { viewerCanCreateBots } from "@/lib/viewer";
import { api, useStore, type Bot } from "@/state/store";

export interface TeamBotDraft { name: string; title: string; description: string; instructions: string; source: "model" | "excerpt" }
interface DraftAnswer { draft: TeamBotDraft; memory: { notes: Array<{ path: string; bytes: number }>; summaryPath: string } }
interface SourcePlugin { key: string; name: string; marketplace: string; enabled: boolean }

/** The dialog's starting choices: plugins and connectors ticked, memory
 * off (an explicit opt-in), every note ticked once memory is on. Pure. */
export function initialCarryChoices(input: { plugins: readonly SourcePlugin[]; connectors: readonly string[]; notes: ReadonlyArray<{ path: string }> }) {
  return {
    plugins: new Set(input.plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.key)),
    connectors: new Set(input.connectors),
    includeMemory: false,
    notes: new Set(input.notes.map((note) => note.path)),
    summary: true,
  };
}

/** What memory goes, as the list the person reads before confirming.
 * Nothing at all unless memory is ticked. Pure. */
export function memoryGoing(choices: { includeMemory: boolean; notes: ReadonlySet<string>; summary: boolean }, summaryPath: string): string[] {
  if (!choices.includeMemory) return [];
  return [...[...choices.notes].sort(), ...(choices.summary ? [summaryPath] : [])];
}

/** The carry request: present only when memory was ticked. Pure. */
export function carryRequest(choices: { includeMemory: boolean; notes: ReadonlySet<string>; summary: boolean }, threadId: string, newBotId: string) {
  if (!choices.includeMemory) return null;
  return { threadId, newBotId, includeMemory: true as const, notes: [...choices.notes], summary: choices.summary };
}

function noteLabel(path: string, summaryPath: string): string {
  if (path === summaryPath) return t("teamBotFromThread.memory.summary");
  if (path === "MEMORY.md") return t("teamBotFromThread.memory.index");
  return path.replace(/^memory\//, "").replace(/\.md$/, "");
}

function TeamBotFromThreadDialog({ request, onClose }: { request: TeamBotFromThreadRequest; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const source = state.bots.find((bot) => bot.id === request.botId);
  const { servers } = useMcpServers();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [answer, setAnswer] = useState<DraftAnswer | null>(null);
  const [plugins, setPlugins] = useState<SourcePlugin[] | null>(null);
  const [form, setForm] = useState<TeamBotDraft | null>(null);
  const [choices, setChoices] = useState(() => initialCarryChoices({ plugins: [], connectors: [], notes: [] }));
  const [stage, setStage] = useState<"drafting" | "ready" | "creating" | "done">("drafting");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [created, setCreated] = useState<Bot | null>(null);
  const organization = Boolean(state.config?.viewer?.principalId);
  const connectors = useMemo(
    () => (source && servers ? mcpServersForBot(servers, source.mcpServers).map((server) => server.name) : []),
    [source, servers],
  );

  useEffect(() => {
    let cancelled = false;
    const language = activeLocale().startsWith("fr") ? "fr" : "en";
    Promise.all([
      api<DraftAnswer>(`/api/bots/${request.botId}/team-bot-draft`, { method: "POST", body: JSON.stringify({ threadId: request.threadId, language }), timeoutMs: 60_000 }),
      api<{ plugins: SourcePlugin[] }>(`/api/bots/${request.botId}/plugins`).then((listing) => listing.plugins).catch(() => [] as SourcePlugin[]),
    ]).then(([draft, installed]) => {
      if (cancelled) return;
      setAnswer(draft);
      setForm(draft.draft);
      setPlugins(installed);
      setChoices((current) => ({ ...initialCarryChoices({ plugins: installed, connectors: [], notes: draft.memory.notes }), connectors: current.connectors }));
      setStage("ready");
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [request.botId, request.threadId]);

  // Connectors arrive with the server list: ticked, like plugins.
  useEffect(() => {
    setChoices((current) => ({ ...current, connectors: new Set(connectors) }));
  }, [connectors]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  const toggle = (key: "plugins" | "connectors" | "notes", value: string) => setChoices((current) => {
    const next = new Set(current[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return { ...current, [key]: next };
  });

  const create = async () => {
    if (!form || !source || stage !== "ready") return;
    setStage("creating");
    setError("");
    const notes: string[] = [];
    let bot: Bot | null = null;
    try {
      const response = await api<{ bot: Bot }>("/api/bots", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(), title: form.title.trim(), description: form.description.trim(),
          modelSelection: source.modelSelection, requireAvailableModel: true, useDefaults: false,
        }),
      });
      bot = response.bot;
      const patched = await api<{ bot: Bot }>(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ soul: form.instructions }) });
      bot = { ...bot, ...patched.bot };
    } catch (cause) {
      if (bot) await api(`/api/bots/${bot.id}`, { method: "DELETE" }).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage("ready");
      return;
    }
    // From here the bot exists: what does not carry over is said, not undone.
    const chosenConnectors = connectors.filter((name) => choices.connectors.has(name));
    if (chosenConnectors.length !== connectors.length || source.mcpServers != null) {
      try {
        await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ mcpServers: chosenConnectors }) });
      } catch (cause) {
        notes.push(t("teamBotFromThread.warn.connectors", { reason: cause instanceof Error ? cause.message : String(cause) }));
      }
    }
    for (const plugin of (plugins ?? []).filter((entry) => choices.plugins.has(entry.key))) {
      try {
        await api(`/api/bots/${bot.id}/plugins/install`, { method: "POST", body: JSON.stringify({ marketplace: plugin.marketplace, plugin: plugin.name }), timeoutMs: 120_000 });
      } catch (cause) {
        notes.push(t("teamBotFromThread.warn.plugin", { name: plugin.name, reason: cause instanceof Error ? cause.message : String(cause) }));
      }
    }
    const carry = carryRequest(choices, request.threadId, bot.id);
    if (carry) {
      try {
        await api(`/api/bots/${request.botId}/team-bot-carry`, { method: "POST", body: JSON.stringify(carry), timeoutMs: 60_000 });
      } catch (cause) {
        notes.push(t("teamBotFromThread.warn.memory", { reason: cause instanceof Error ? cause.message : String(cause) }));
      }
    }
    dispatch({ type: "botAdded", bot });
    setCreated(bot);
    setWarnings(notes);
    setStage("done");
  };

  const publish = () => {
    if (!created) return;
    onClose();
    // The existing Team Bot path: Sharing (Perspicax grants) on an
    // organization server; the bot itself on this computer alone.
    if (organization) dispatch({ type: "toggleSettings", open: true, botId: created.id, section: "sharing" });
    else dispatch({ type: "select", id: created.id });
  };

  const summaryPath = answer?.memory.summaryPath ?? "memory/conversation-carry-over.md";
  const going = memoryGoing(choices, summaryPath);
  const field = "mt-1 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13.5px] text-ink disabled:opacity-60";
  const busy = stage === "creating";
  const canCreate = viewerCanCreateBots(state.config);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="teambot-thread-title" tabIndex={-1} data-teambot-from-thread
        className="flex max-h-[90vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-hairline/50 bg-panel text-ink shadow-2xl outline-none"
        onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }}>
        <header className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
          <div>
            <h2 id="teambot-thread-title" className="flex items-center gap-2 text-[17px] font-semibold"><UsersRound size={17} aria-hidden="true" />{t("teamBotFromThread.title")}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("teamBotFromThread.intro", { title: request.title || t("teamBotFromThread.untitled") })}</p>
          </div>
          <button type="button" aria-label={t("common.cancel")} disabled={busy} onClick={onClose} className="rounded-lg p-1.5 text-ink-secondary hover:bg-raised"><X size={18} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-2">
          {!canCreate && <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] text-warning">{t("teamBotFromThread.cannotCreate")}</p>}
          {stage === "done" && created ? (
            <div data-teambot-created>
              <p className="flex items-center gap-2 text-[13.5px] font-medium"><Check size={16} className="text-success" />{t("teamBotFromThread.created", { name: created.name })}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{organization ? t("teamBotFromThread.publishHint") : t("teamBotFromThread.publishHintSolo")}</p>
              {warnings.length > 0 && (
                <ul className="mt-3 list-disc rounded-xl border border-hairline px-4 py-3 pl-8 text-[12.5px] text-ink-secondary">
                  {warnings.map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}
            </div>
          ) : !form ? (
            !error && <div className="flex items-center gap-2 py-6 text-[13px] text-ink-secondary"><Loader2 size={15} className="animate-spin" />{t("teamBotFromThread.drafting")}</div>
          ) : (
            <fieldset disabled={busy} className="space-y-3">
              {form.source === "model" && <p className="flex items-center gap-1.5 text-[12px] text-ink-secondary"><Sparkles size={13} aria-hidden="true" />{t("teamBotFromThread.draftedBy", { name: source?.name ?? "" })}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[12.5px] text-ink-secondary">{t("teamBotFromThread.name")}
                  <input value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} className={field} />
                </label>
                <label className="block text-[12.5px] text-ink-secondary">{t("teamBotFromThread.role")}
                  <input value={form.title} maxLength={120} onChange={(event) => setForm({ ...form, title: event.target.value })} className={field} />
                </label>
              </div>
              <label className="block text-[12.5px] text-ink-secondary">{t("teamBotFromThread.description")}
                <input value={form.description} maxLength={300} onChange={(event) => setForm({ ...form, description: event.target.value })} className={field} />
              </label>
              <label className="block text-[12.5px] text-ink-secondary">{t("teamBotFromThread.instructions")}
                <textarea value={form.instructions} rows={7} maxLength={8000} onChange={(event) => setForm({ ...form, instructions: event.target.value })} className={`${field} font-mono text-[12.5px]`} />
              </label>

              <div data-teambot-carry-plugins>
                <div className="text-[12.5px] font-medium text-ink">{t("teamBotFromThread.plugins")}</div>
                {plugins && plugins.length === 0 && connectors.length === 0 && <p className="mt-1 text-[12px] text-ink-secondary">{t("teamBotFromThread.noPlugins")}</p>}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {(plugins ?? []).map((plugin) => (
                    <label key={plugin.key} className="flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" className="size-3.5 accent-accent" checked={choices.plugins.has(plugin.key)} onChange={() => toggle("plugins", plugin.key)} />
                      {plugin.name}
                    </label>
                  ))}
                  {connectors.map((name) => (
                    <label key={`mcp:${name}`} className="flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" className="size-3.5 accent-accent" checked={choices.connectors.has(name)} onChange={() => toggle("connectors", name)} />
                      {name}
                    </label>
                  ))}
                </div>
              </div>

              <div data-teambot-carry-memory className="rounded-xl border border-hairline/50 px-4 py-3">
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" data-teambot-include-memory className="mt-0.5 size-4 accent-accent" checked={choices.includeMemory}
                    onChange={(event) => setChoices({ ...choices, includeMemory: event.target.checked })} />
                  <span>
                    <span className="block font-medium">{t("teamBotFromThread.memory.include")}</span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-secondary">{t("teamBotFromThread.memory.hint")}</span>
                  </span>
                </label>
                {choices.includeMemory && (
                  <div className="mt-2 pl-6">
                    <div className="text-[12px] font-medium text-ink-secondary">{t("teamBotFromThread.memory.going")}</div>
                    <div className="mt-1 flex flex-col gap-1">
                      {(answer?.memory.notes ?? []).map((note) => (
                        <label key={note.path} className="flex items-center gap-1.5 text-[12.5px]">
                          <input type="checkbox" className="size-3.5 accent-accent" checked={choices.notes.has(note.path)} onChange={() => toggle("notes", note.path)} />
                          {noteLabel(note.path, summaryPath)}
                          <span className="text-ink-tertiary">· {Math.max(1, Math.round(note.bytes / 1024))} KB</span>
                        </label>
                      ))}
                      <label className="flex items-center gap-1.5 text-[12.5px]">
                        <input type="checkbox" className="size-3.5 accent-accent" checked={choices.summary} onChange={(event) => setChoices({ ...choices, summary: event.target.checked })} />
                        {noteLabel(summaryPath, summaryPath)}
                      </label>
                    </div>
                    {going.length === 0 && <p className="mt-1 text-[12px] text-ink-secondary">{t("teamBotFromThread.memory.nothing")}</p>}
                  </div>
                )}
              </div>
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-secondary">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
                <span>{t("teamBotFromThread.never")}</span>
              </p>
            </fieldset>
          )}
        </div>

        {error && <p role="alert" className="mx-6 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
        <footer className="flex justify-end gap-2 border-t border-hairline/35 px-6 py-3">
          {stage === "done" ? (
            <>
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised">{t("teamShare.done")}</button>
              <button type="button" data-teambot-publish onClick={publish} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink">
                {organization ? t("teamBotFromThread.publish") : t("teamBotFromThread.open")}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised">{t("common.cancel")}</button>
              <button type="button" data-teambot-create disabled={busy || stage !== "ready" || !form?.name.trim() || !canCreate} onClick={() => void create()}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-40">
                {busy && <Loader2 size={14} className="animate-spin" />}
                {busy ? t("teamBotFromThread.creating") : t("teamBotFromThread.create")}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Mounted once (App): keeps the menus' list of bots current and shows the
 * dialog a thread menu asked for. */
export function TeamBotFromThreadHost() {
  const { state } = useStore();
  const request = useTeamBotFromThreadRequest();
  const canCreate = viewerCanCreateBots(state.config);
  useEffect(() => {
    setTeamBotSources(canCreate ? state.bots.filter((bot) => !bot.hidden).map((bot) => bot.id) : []);
  }, [state.bots, canCreate]);
  if (!request) return null;
  return <TeamBotFromThreadDialog key={`${request.botId}:${request.threadId}`} request={request} onClose={closeTeamBotFromThread} />;
}
