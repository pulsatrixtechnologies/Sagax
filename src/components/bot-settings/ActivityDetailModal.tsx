// One Coding entry in full: status, times and duration, who started it, the
// engine and model and whose credentials paid (organization server), the
// tool steps with where each ran (your computer or the server environment),
// files touched and the sub-agents it started, with Stop and Open thread.
// The server decides what this person may read (server/routes/bot-activity.ts):
// a routine run seen without its thread comes with no steps and no thread.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Laptop, Loader2, Server, Square, X } from "lucide-react";

import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  activityStatusActive,
  activityStatusLabel,
  activityViaLabel,
  activityWhereLabel,
  formatActivityDuration,
  loadBotActivityDetail,
  type BotActivityDetail,
  type BotActivityItem,
} from "@/lib/bot-activity";
import { ActivityCard, ActivityStatusIcon } from "./ActivityCard";

const POLL_MS = 3_000;

function formatTime(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[12px] text-ink-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}

/** The body, without fetching: tests render it with a fixed detail. */
export function ActivityDetailBody({ item, detail, error, now, engineName, onStop, onOpenThread, onOpenChild, stopping = false }: {
  item: BotActivityItem;
  detail: BotActivityDetail | null;
  error: boolean;
  now: number;
  engineName?: (instanceId: string) => string | undefined;
  onStop: () => void;
  onOpenThread: (botId: string, threadId: string) => void;
  onOpenChild: (child: BotActivityItem) => void;
  stopping?: boolean;
}) {
  const shown = detail ?? item;
  const running = activityStatusActive(shown.status);
  const duration = (shown.endedAt ?? now) - shown.startedAt;
  return (
    <>
      <div className="flex items-start gap-3 border-b border-hairline/40 px-5 py-4">
        <span className="mt-0.5"><ActivityStatusIcon status={shown.status} size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="activity-detail-title" className="break-words text-[15px] font-semibold leading-snug text-ink">{shown.title}</h2>
          <p data-activity-detail-status className="mt-0.5 text-[12.5px] text-ink-secondary">{activityStatusLabel(shown.status)}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {detail === null && error && <p role="alert" className="py-2 text-[12.5px] text-danger">{t("botPanel.activity.error")}</p>}
        {detail?.note && <p className="mb-2 rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] text-ink">{detail.note}</p>}
        <dl className="divide-y divide-hairline-weak">
          <Fact label={t("botPanel.activity.started")}>{formatTime(shown.startedAt)}</Fact>
          {shown.endedAt !== undefined && <Fact label={t("botPanel.activity.ended")}>{formatTime(shown.endedAt)}</Fact>}
          <Fact label={t("botPanel.activity.duration")}>{formatActivityDuration(duration)}</Fact>
          {shown.startedBy?.name && (
            <Fact label={t("botPanel.activity.startedBy")}>
              {shown.startedBy.kind === "routine" ? t("botPanel.activity.byRoutine", { name: shown.startedBy.name }) : shown.startedBy.name}
            </Fact>
          )}
          {shown.botName && shown.kind === "subagent" && <Fact label={t("botPanel.activity.bot")}>{shown.botName}</Fact>}
          {detail?.engine && (
            <Fact label={t("botPanel.activity.engine")}>
              {[engineName?.(detail.engine.instanceId) ?? detail.engine.instanceId, detail.engine.model].filter(Boolean).join(" · ")}
            </Fact>
          )}
          {detail?.via && <Fact label={t("botPanel.activity.via")}>{activityViaLabel(detail.via)}</Fact>}
        </dl>

        {detail && !detail.threadId && detail.kind === "routine" && (
          <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">{t("botPanel.activity.privateRun")}</p>
        )}

        {detail && detail.children.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 text-[12px] font-medium text-ink-secondary">{t("botPanel.activity.children")}</h3>
            <ul className="flex flex-col gap-1.5">
              {detail.children.map((child) => (
                <li key={child.id}><ActivityCard item={child} onOpen={onOpenChild} /></li>
              ))}
            </ul>
          </section>
        )}

        {detail && (detail.threadId || detail.steps.length > 0) && (
          <section className="mt-4">
            <h3 className="mb-2 text-[12px] font-medium text-ink-secondary">{t("botPanel.activity.steps")}</h3>
            {detail.steps.length === 0 ? (
              <p className="text-[12.5px] text-ink-secondary">{t("botPanel.activity.stepsEmpty")}</p>
            ) : (
              <ol data-activity-steps className="relative flex flex-col gap-0.5 border-l border-hairline-weak pl-3">
                {detail.stepsTruncated && <li className="pb-1 text-[11.5px] text-ink-secondary">{t("botPanel.activity.stepsOlder")}</li>}
                {detail.steps.map((step) => (
                  <li key={step.id} data-activity-step={step.name} className="relative py-1">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute -left-[17px] top-[11px] size-2 rounded-full",
                        step.ok === undefined ? "bg-accent animate-pulse" : step.ok ? "bg-success" : "bg-danger",
                      )}
                    />
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{step.name}</span>
                      {step.where && (
                        <span data-activity-where={step.where} className="flex shrink-0 items-center gap-1 rounded-md bg-inset px-1.5 py-0.5 text-[11px] text-ink-secondary">
                          {step.where === "computer" ? <Laptop size={11} aria-hidden="true" /> : <Server size={11} aria-hidden="true" />}
                          {activityWhereLabel(step.where)}
                        </span>
                      )}
                    </div>
                    {step.summary && <p className="mt-0.5 line-clamp-2 break-words text-[11.5px] leading-snug text-ink-secondary">{step.summary}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {detail && detail.files.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 text-[12px] font-medium text-ink-secondary">{t("botPanel.activity.files")}</h3>
            <ul className="flex flex-col gap-1">
              {detail.files.map((file) => (
                <li key={file} className="flex min-w-0 items-center gap-2 text-[12px] text-ink">
                  <FileText size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                  <span className="min-w-0 truncate font-mono" title={file}>{file}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-hairline/40 px-5 py-3">
        {running && detail?.canStop && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="flex items-center gap-1.5 rounded-lg border border-hairline/50 px-3 py-2 text-[12.5px] font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
          >
            {stopping ? <Loader2 size={13} className="animate-spin" /> : <Square size={12} fill="currentColor" />}
            {t("botPanel.activity.stop")}
          </button>
        )}
        {shown.threadId && (
          <button
            type="button"
            onClick={() => onOpenThread(shown.botId, shown.threadId!)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white hover:opacity-90"
          >
            <ExternalLink size={13} />
            {t("botPanel.activity.openThread")}
          </button>
        )}
      </div>
    </>
  );
}

export function ActivityDetailModal({ item, onClose, onChanged }: {
  item: BotActivityItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { state, dispatch } = useStore();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // A sub-agent opens in place; Back is the list's own card.
  const [current, setCurrent] = useState(item);
  const [detail, setDetail] = useState<BotActivityDetail | null>(null);
  const [error, setError] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    return loadBotActivityDetail(api, current.botId, current.id)
      .then((next) => { setDetail(next); setError(false); })
      .catch(() => setError(true));
  }, [current.botId, current.id]);

  useEffect(() => { setDetail(null); void load(); }, [load]);
  const running = activityStatusActive((detail ?? current).status);
  useEffect(() => {
    if (!running) return;
    // Live: the steps and status follow the run while it goes.
    const timer = window.setInterval(() => { setNow(Date.now()); void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal?.();
    return () => dialog.close?.();
  }, []);

  const stop = () => {
    if (!detail?.threadId) return;
    setStopping(true);
    dispatch({ type: "interrupt", botId: detail.botId, threadId: detail.threadId, onError: () => setStopping(false) });
    window.setTimeout(() => { setStopping(false); void load(); onChanged(); }, 1_500);
  };
  const openThread = (threadBotId: string, threadId: string) => {
    if (threadBotId !== state.selectedId) dispatch({ type: "select", id: threadBotId });
    dispatch({ type: "switchTask", botId: threadBotId, threadId });
    onClose();
  };
  const engineName = (instanceId: string) => state.instances.find((instance) => instance.instanceId === instanceId)?.displayName;

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-labelledby="activity-detail-title"
      data-activity-detail={current.id}
      className="m-auto w-[min(560px,calc(100%-32px))] max-h-[85vh] overflow-hidden rounded-2xl border border-hairline/50 bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        // Escape closes this layer only, never the bot panel under it.
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[85vh] flex-col">
        <button
          type="button"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink"
        >
          <X size={16} />
        </button>
        <ActivityDetailBody
          item={current}
          detail={detail}
          error={error}
          now={now}
          engineName={engineName}
          onStop={stop}
          onOpenThread={openThread}
          onOpenChild={(child) => { if (child.threadId) setCurrent(child); }}
          stopping={stopping}
        />
      </div>
    </dialog>
  );
}
