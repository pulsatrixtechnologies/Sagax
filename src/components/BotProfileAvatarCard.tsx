import { lazy, Suspense, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { type MausMotion, type MausState } from "@/lib/mascot";
import {
  AVATAR_FOCUS_CENTER,
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  botAvatarUrlFromStoredPath,
  clampAvatarFocus,
  clampAvatarZoom,
} from "../../shared/bot-avatar";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { BotAvatar } from "./Avatar";
import { AvatarImageGenerator } from "./AvatarImageGenerator";
import type { FxMoveRequest } from "./skin-fx/skin-fx";

type AvatarPatch = Partial<
  Pick<Bot, "avatarCrop" | "avatarUrl" | "avatarZoom" | "avatarFocusX" | "avatarFocusY" | "color" | "mascotExpression" | "mascotBody" | "mascotSkin" | "mascotLook">
>;

const FRAME_SIZE = 168;

/** The popover's width: wide enough for the cards in few rows, never wider than the window allows. */
const POPOVER_WIDTH = 452;
const MARGIN = 12;

/** What counts as inside the avatar editor: the avatar button that opened it and its portaled panel. */
export function editorDismissRoot(anchor: RefObject<Node | null>, popover: RefObject<Node | null>) {
  return { contains: (target: unknown) => !!(anchor.current?.contains(target as Node) || popover.current?.contains(target as Node)) };
}

/**
 * Where the popover stands: under the avatar, centered on it, shifted to stay
 * inside the window, flipped above when there is no room below, never taller
 * than the window. Follows resizes and scrolls. Dismissal (Escape, a press
 * outside) is usePopoverDismiss, wired in BotProfileAvatarCard.
 */
function usePopoverPlace(open: boolean, anchor: RefObject<HTMLElement | null>, popover: RefObject<HTMLElement | null>) {
  const [place, setPlace] = useState({ left: 0, top: 0, width: POPOVER_WIDTH, maxHeight: 600, ready: false });
  const measure = () => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - MARGIN * 2);
    const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN);
    const maxHeight = window.innerHeight - MARGIN * 2;
    const height = Math.min(popover.current?.scrollHeight ?? 0, maxHeight);
    let top = box.bottom + 8;
    if (top + height > window.innerHeight - MARGIN) {
      const above = box.top - 8 - height;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - MARGIN - height);
    }
    setPlace({ left, top, width, maxHeight, ready: true });
  };
  useLayoutEffect(() => {
    if (!open) {
      setPlace((current) => ({ ...current, ready: false }));
      return;
    }
    measure();
    const again = () => measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(again);
    if (popover.current) observer?.observe(popover.current);
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
    // measure reads the refs; it only needs to rerun when the popover opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return place;
}

// The character and its look (the mascot registry, its thumbnails and the skin cards): fetched only when the popover opens.
const MascotLookEditor = lazy(() => import("./floating-bots/MascotLookEditor"));


function AvatarFraming({
  bot,
  disabled,
  onPatch,
}: {
  bot: Bot;
  disabled: boolean;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const zoom = clampAvatarZoom(bot.avatarZoom ?? AVATAR_ZOOM_MIN);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? AVATAR_FOCUS_CENTER);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? AVATAR_FOCUS_CENTER);
  const framed = zoom !== AVATAR_ZOOM_MIN || focusX !== AVATAR_FOCUS_CENTER || focusY !== AVATAR_FOCUS_CENTER;
  const drag = useRef<{ x: number; y: number; focusX: number; focusY: number; pointer: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, focusX, focusY, pointer: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointer) return;
    onPatch({
      avatarFocusX: clampAvatarFocus(start.focusX - (event.clientX - start.x) / FRAME_SIZE / zoom),
      avatarFocusY: clampAvatarFocus(start.focusY - (event.clientY - start.y) / FRAME_SIZE / zoom),
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (disabled || event.deltaY === 0) return;
    event.preventDefault();
    onPatch({ avatarZoom: clampAvatarZoom(zoom + (event.deltaY < 0 ? 0.08 : -0.08)) });
  };

  return (
    <div className="py-3">
      <div
        className="mx-auto w-fit cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <BotAvatar bot={bot} size={FRAME_SIZE} animated={false} label={`${bot.name} avatar preview`} />
      </div>
      <div className="mb-1.5 mt-4 flex items-baseline justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("botPanel.avatar.zoom")}</span>
        <span className="tabular-nums text-[12px] text-ink-secondary">{Math.round(zoom * 100)}%</span>
      </div>
      <input
        type="range"
        min={AVATAR_ZOOM_MIN}
        max={AVATAR_ZOOM_MAX}
        step={0.01}
        value={zoom}
        disabled={disabled}
        aria-label={t("botPanel.avatar.zoomAria")}
        aria-valuemin={AVATAR_ZOOM_MIN}
        aria-valuemax={AVATAR_ZOOM_MAX}
        aria-valuenow={zoom}
        aria-valuetext={`${Math.round(zoom * 100)}%`}
        onChange={(event) => onPatch({ avatarZoom: clampAvatarZoom(Number(event.target.value)) })}
        className="w-full accent-accent"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px] text-ink-secondary">
        <span>{t("botPanel.avatar.drag")}</span>
        {framed && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPatch({ avatarZoom: AVATAR_ZOOM_MIN, avatarFocusX: AVATAR_FOCUS_CENTER, avatarFocusY: AVATAR_FOCUS_CENTER })}
            className="shrink-0 rounded-md px-2 py-1 text-ink hover:bg-control disabled:opacity-50"
          >
            {t("botPanel.avatar.resetFrame")}
          </button>
        )}
      </div>
    </div>
  );
}

export function BotProfileAvatarCard({
  bot,
  activeState,
  mascotMotion,
  onPatch,
}: {
  bot: Bot;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const { dispatch, flushBotPatches } = useStore();
  const { request: api, uploadAvatar } = useBotEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const place = usePopoverPlace(editorOpen, anchor, popover);
  // The popover is portaled out of the card, so "inside" is the avatar button
  // (its own click toggles) plus the panel. Focus goes back to the button only
  // when it was inside the panel, so a press on another control keeps its focus.
  const dismissRoot = useRef(editorDismissRoot(anchor, popover));
  usePopoverDismiss(editorOpen, dismissRoot, () => {
    if (popover.current?.contains(document.activeElement)) anchor.current?.focus();
    setEditorOpen(false);
  });
  const crop = bot.avatarCrop ?? "mascot";
  // A custom picture opens on its own tab, where its zoom and framing live.
  const [editorTab, setEditorTab] = useState<"bot" | "generate" | "upload" | "reset">(
    () => (crop !== "mascot" && bot.avatarUrl ? "upload" : "bot"),
  );
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const busy = uploading || generating;
  // A move tried here plays through the store, so the sidebar and chat header
  // react too. An unsaved draft has no store motion to show, so the card also
  // keeps the last move it asked for and plays that when nothing else is.
  const [triedMove, setTriedMove] = useState<{ kind: Exclude<MausMotion, "none">; nonce: number } | null>(null);
  const previewMotion = mascotMotion ?? triedMove;
  const playMove = (kind: Exclude<MausMotion, "none">) => {
    setTriedMove((last) => ({ kind, nonce: (last?.nonce ?? 0) + 1 }));
    dispatch({ type: "playMascotMotion", botId: bot.id, kind });
  };
  // A shape's or Trombi's move plays on the avatar above the popover, its preview.
  const [characterMove, setCharacterMove] = useState<FxMoveRequest | null>(null);
  const playCharacterMove = (clip: string) => setCharacterMove((last) => ({ clip, key: (last?.key ?? 0) + 1 }));

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setUploading(true);
    setError(null);
    try {
      const saved = uploadAvatar ? null : await imageAttachmentFromFile(file);
      const avatarUrl = uploadAvatar ? await uploadAvatar(file) : saved ? botAvatarUrlFromStoredPath(saved.path) : null;
      if (!avatarUrl) throw new Error(t("botPanel.avatar.badImage"));
      const latestCrop = cropRef.current;
      onPatch({
        avatarUrl,
        avatarCrop: latestCrop === "mascot" ? "circle" : latestCrop,
        avatarZoom: AVATAR_ZOOM_MIN,
        avatarFocusX: AVATAR_FOCUS_CENTER,
        avatarFocusY: AVATAR_FOCUS_CENTER,
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = () => {
    setError(null);
    onPatch({
      avatarUrl: null,
      avatarCrop: "mascot",
      avatarZoom: AVATAR_ZOOM_MIN,
      avatarFocusX: AVATAR_FOCUS_CENTER,
      avatarFocusY: AVATAR_FOCUS_CENTER,
    });
  };

  const generate = async (direction: string) => {
    if (busy) return;
    setGenerating(true);
    setError(null);
    try {
      // Generation reads the bot's identity and crop server-side. Commit any
      // debounced profile edits first, then feed the generated avatar back
      // through the same serialized mutation lane as upload/remove.
      const cropAtStart = cropRef.current;
      await flushBotPatches(bot.id);
      const result: { avatarUrl: string; bot: Bot } = await api(`/api/bots/${bot.id}/avatar/generate`, {
        method: "POST",
        body: JSON.stringify({ prompt: direction.trim() }),
      });
      const latestCrop = cropRef.current;
      onPatch({
        avatarUrl: result.avatarUrl,
        // The server owns this crop for generate (server/index.ts picks
        // "circle" for a mascot bot). The fallback below is never actually
        // reached, since the server always assigns a crop; "circle" is kept
        // only as the truthful default if it ever were.
        avatarCrop:
          latestCrop === cropAtStart
            ? (result.bot.avatarCrop ?? "circle")
            : latestCrop,
      });
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : String(generateError));
    } finally {
      setGenerating(false);
    }
  };

  const resetMascot = () =>
    onPatch({ avatarCrop: "mascot", color: "green", mascotExpression: null, mascotBody: "cursor", mascotSkin: "none", mascotLook: { character: "owl" } });

  const body = (
    <>
        <div className="mb-3 flex items-center gap-1 text-[12px]">
          {(["bot", "generate", "upload"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={editorTab === tab}
              onClick={() => setEditorTab(tab)}
              className={cn("rounded-md px-2 py-1 capitalize", editorTab === tab ? "bg-control text-ink" : "text-ink-secondary hover:text-ink")}
            >
              {tab === "bot" ? t("botPanel.avatar.bot") : tab === "generate" ? t("botPanel.avatar.generate") : t("botPanel.avatar.upload")}
            </button>
          ))}
          <button type="button" onClick={resetMascot} className="ml-auto px-2 py-1 text-ink-secondary hover:text-ink">{t("botPanel.avatar.reset")}</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        {editorTab === "upload" && (
          <div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {t("botPanel.avatar.uploadImage")}
              </button>
              {bot.avatarUrl && (
                <button
                  type="button"
                  onClick={removeImage}
                  disabled={busy}
                  aria-label={t("botPanel.avatar.removeAria")}
                  title={t("botPanel.avatar.removeTitle")}
                  className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="mt-1.5 text-[11.5px] text-ink-secondary">{t("botPanel.avatar.types")}</div>
            {crop !== "mascot" && bot.avatarUrl && <AvatarFraming bot={bot} disabled={busy} onPatch={onPatch} />}
          </div>
        )}

        {editorTab === "bot" && crop === "mascot" && editorOpen && (
          <Suspense fallback={<div className="h-[320px]" />}>
            <MascotLookEditor bot={bot} disabled={busy} onPatch={onPatch} onOwlMove={playMove} onMove={playCharacterMove} />
          </Suspense>
        )}
        {editorTab === "bot" && crop !== "mascot" && (
          <button type="button" onClick={() => onPatch({ avatarCrop: "mascot" })} className="text-[13px] text-ink-secondary hover:text-ink">{t("botPanel.avatar.useMascot")}</button>
        )}
        {editorTab === "generate" && (
          <AvatarImageGenerator
            botLabel={bot.title || bot.name}
            disabled={uploading}
            generating={generating}
            onGenerate={generate}
          />
        )}

        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
    </>
  );

  return (
    <div className="relative">
      {/* room above for a move's jump and effects: the panel scrolls, so anything past its top is cut by a straight edge */}
      <div className="flex justify-center pb-3 pt-6">
        <button
          ref={anchor}
          type="button"
          aria-label={t("botPanel.avatar.edit")}
          aria-expanded={editorOpen}
          onClick={() => setEditorOpen((open) => !open)}
          className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent", crop === "mascot" && "mascot-plinth p-2")}
        >
          <BotAvatar
            bot={bot}
            state={activeState}
            size={112}
            motion={previewMotion?.kind ?? "none"}
            motionKey={previewMotion?.nonce ?? 0}
            characterMove={characterMove}
          />
        </button>
      </div>
      {editorOpen && typeof document !== "undefined" ? (
        // a portal above the whole window: no panel's overflow can clip it
        createPortal(
          <div
            ref={popover}
            data-avatar-popover=""
            role="dialog"
            aria-label={t("botPanel.avatar.edit")}
            className="fixed z-[1000] overflow-y-auto overscroll-contain rounded-2xl border border-hairline/50 bg-card p-3.5 shadow-2xl shadow-black/50"
            style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight, visibility: place.ready ? "visible" : "hidden" }}
          >
            {body}
          </div>,
          document.body,
        )
      ) : (
        <div hidden data-avatar-popover="">
          {body}
        </div>
      )}
    </div>
  );
}