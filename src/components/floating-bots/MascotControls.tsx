// The desktop mascot's ChatGPT-Pets-like extras, drawn beside the character
// and never over it: the hover controls (quick chat, voice, activity) in the
// effects' lane, the activity tray where the chat goes, and the call's
// captions with its status chip. They only draw what the brain sends and
// report clicks; the rules live in hover-controls.ts and captions.ts.
import { useEffect, useState } from "react";
import { Bell, Check, ExternalLink, Loader2, MessageCircle, Phone, PhoneOff, Square, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { phaseLabel } from "@/lib/voice-mode/call-labels";
import { captionFeed, captionLines, captionText, nextWordIn, WORDS_PER_SECOND, type CaptionState } from "./captions";
import type { FloatingCall, FloatingEvent, FloatingTray } from "./protocol";
import type { EffectSide } from "./placement";

type Rect = { x: number; y: number; width: number; height: number };

export interface MascotHoverControlsProps {
  /** The lane beside the character (stage coordinates) and its side. */
  lane: Rect;
  side: EffectSide;
  shown: boolean;
  reduced: boolean;
  chatOpen: boolean;
  trayOpen: boolean;
  /** Voice mode serves this bot (the voice button shows only then). */
  canCall: boolean;
  onCall: boolean;
  onEvent: (event: FloatingEvent) => void;
  /** The pointer is over the controls (they stay while it is). */
  hover: (on: boolean) => void;
  name: string;
}

const ROUND = "flex size-[30px] items-center justify-center rounded-full border border-hairline-weak bg-elevated text-ink-secondary shadow-[0_4px_14px_rgba(0,0,0,0.24)] transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Quick chat, voice and activity: round buttons in the lane beside the character, shown on hover. */
export function MascotHoverControls({ lane, side, shown, reduced, chatOpen, trayOpen, canCall, onCall, onEvent, hover, name }: MascotHoverControlsProps) {
  return (
    <div
      className="fb-controls"
      role="toolbar"
      aria-label={t("floatingBots.controls.label", { name })}
      data-side={side}
      data-shown={shown ? "" : undefined}
      data-reduced={reduced ? "" : undefined}
      aria-hidden={shown ? undefined : true}
      style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height }}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onFocus={() => hover(true)}
      onBlur={() => hover(false)}
    >
      <button
        type="button"
        className={cn(ROUND, chatOpen && "text-accent-text")}
        aria-label={t("floatingBots.controls.chat")}
        title={t("floatingBots.controls.chat")}
        aria-pressed={chatOpen}
        tabIndex={shown ? 0 : -1}
        data-control="chat"
        onClick={() => onEvent(chatOpen ? { type: "dismiss" } : { type: "click" })}
      >
        <MessageCircle size={14} />
      </button>
      {canCall && (
        <button
          type="button"
          className={cn(ROUND, onCall && "border-transparent bg-danger text-white hover:text-white")}
          aria-label={onCall ? t("floatingBots.controls.hangUp") : t("floatingBots.controls.call")}
          title={onCall ? t("floatingBots.controls.hangUp") : t("floatingBots.controls.call")}
          tabIndex={shown ? 0 : -1}
          data-control="voice"
          onClick={() => onEvent({ type: "call", action: onCall ? "end" : "start" })}
        >
          {onCall ? <PhoneOff size={14} /> : <Phone size={14} />}
        </button>
      )}
      <button
        type="button"
        className={cn(ROUND, trayOpen && "text-accent-text")}
        aria-label={t("floatingBots.controls.activity")}
        title={t("floatingBots.controls.activity")}
        aria-pressed={trayOpen}
        tabIndex={shown ? 0 : -1}
        data-control="activity"
        onClick={() => onEvent({ type: "tray", open: !trayOpen })}
      >
        <Bell size={14} />
      </button>
    </div>
  );
}

/** This bot's running work and its approvals, where the chat goes: Allow / Stop, and a row opens its thread in the app. */
export function MascotTray({ tray, name, onEvent, hover, style }: { tray: FloatingTray; name: string; onEvent: (event: FloatingEvent) => void; hover: (on: boolean) => void; style?: React.CSSProperties }) {
  return (
    <section
      className="fb-tray pointer-events-auto overflow-hidden rounded-[18px] border border-hairline-weak bg-elevated text-ink shadow-[0_8px_28px_rgba(0,0,0,0.28)]"
      role="dialog"
      aria-label={t("floatingBots.tray.title", { name })}
      data-tray
      style={style}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
    >
      <header className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <Bell size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-secondary">{t("floatingBots.tray.title", { name })}</h2>
        <button
          type="button"
          aria-label={t("floatingBots.tray.close")}
          title={t("floatingBots.tray.close")}
          onClick={() => onEvent({ type: "tray", open: false })}
          className="flex size-6 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={13} />
        </button>
      </header>
      <div className="max-h-[min(55vh,300px)] overflow-y-auto px-2 pb-2">
        {tray.items.length === 0 ? (
          <p className="flex items-center gap-2 px-1.5 py-2 text-[12.5px] text-ink-tertiary" role="status" data-tray-empty>
            {tray.loading && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            {tray.loading ? t("floatingBots.tray.loading") : t("floatingBots.tray.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label={t("floatingBots.tray.title", { name })}>
            {tray.items.map((item) => (
              <li key={item.id} className="rounded-xl bg-raised/60 px-2.5 py-2" data-tray-item={item.kind}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  disabled={!item.canOpen}
                  title={item.canOpen ? t("floatingBots.tray.open") : undefined}
                  onClick={() => onEvent({ type: "work", action: "open", id: item.id })}
                >
                  {item.kind === "approval" ? (
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                  ) : (
                    <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-ink-tertiary" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] leading-[18px] text-ink">{item.title}</span>
                    {item.detail && <span className="block truncate text-[11.5px] leading-[16px] text-ink-tertiary">{item.detail}</span>}
                  </span>
                  {item.canOpen && <ExternalLink size={12} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden="true" />}
                </button>
                {(item.kind === "approval" || item.canStop) && (
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    {item.canStop && (
                      <button
                        type="button"
                        data-tray-stop
                        onClick={() => onEvent({ type: "work", action: "stop", id: item.id })}
                        className="flex items-center gap-1 rounded-full border border-hairline/50 px-2.5 py-0.5 text-[12px] text-ink hover:bg-hover"
                      >
                        <Square size={10} aria-hidden="true" />
                        {t("floatingBots.tray.stop")}
                      </button>
                    )}
                    {item.kind === "approval" && (
                      <button
                        type="button"
                        data-tray-allow
                        onClick={() => onEvent({ type: "work", action: "allow", id: item.id })}
                        className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[12px] text-accent-ink hover:brightness-110"
                      >
                        <Check size={11} aria-hidden="true" />
                        {t("floatingBots.tray.allow")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The width of the captions' card, px (it sits in the room the window already holds beside the character). */
export const CAPTIONS_WIDTH = 168;
/** About this many characters fit one of its lines. */
export const CAPTIONS_CHARS = 24;

/** The caption state following the call's snapshots; re-renders as the bot's words are revealed. */
export function useCaption(call: FloatingCall | null): { lines: string[]; who: "you" | "bot" | null } {
  const last = call?.transcript[call.transcript.length - 1] ?? null;
  const [state, setState] = useState<CaptionState | null>(() => (call ? captionFeed(null, { phase: call.phase, line: call.line, last, now: performance.now() }) : null));
  const [, tick] = useState(0);
  const phase = call?.phase;
  const line = call?.line ?? "";
  useEffect(() => {
    if (!phase) {
      setState(null);
      return;
    }
    setState((current) => captionFeed(current, { phase, line, last, now: performance.now() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, line, last?.id, last?.text]);
  const pace = WORDS_PER_SECOND * (call?.settings.speed ?? 1);
  const now = performance.now();
  const wait = nextWordIn(state, now, pace);
  useEffect(() => {
    if (wait === null) return;
    const timer = setTimeout(() => tick((n) => n + 1), wait);
    return () => clearTimeout(timer);
  });
  return { lines: captionLines(captionText(state, now, pace), CAPTIONS_CHARS), who: state?.who ?? null };
}

/** The call's status chip and live captions beside the character. */
export function MascotCaptions({ call, box, side, captions }: { call: FloatingCall; box: Rect; side: "left" | "right"; captions: boolean }) {
  const { lines, who } = useCaption(captions ? call : null);
  const status = phaseLabel(call.phase, call.muted);
  return (
    <div
      className="fb-captions"
      data-side={side}
      data-voice-captions
      data-phase={call.muted ? "muted" : call.phase}
      style={{ left: box.x, top: box.y, width: box.width }}
      aria-hidden="true"
    >
      <span className="fb-captions-chip" data-caption-chip>
        <span className="fb-captions-dot" />
        {status}
      </span>
      {captions && lines.length > 0 && (
        <div className="fb-captions-text" data-caption-who={who ?? undefined}>
          {lines.map((text, index) => (
            <span key={index} className="fb-captions-line" data-caption-line>{text}</span>
          ))}
        </div>
      )}
    </div>
  );
}
