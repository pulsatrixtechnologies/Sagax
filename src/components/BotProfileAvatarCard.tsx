import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { cn } from "@/lib/cn";
import {
  MAUS_COLOR_NAMES,
  swatchStyle,
  type MausMotion,
  type MausState,
} from "@/lib/mascot";
import {
  AVATAR_FOCUS_CENTER,
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  botAvatarUrlFromStoredPath,
  clampAvatarFocus,
  clampAvatarZoom,
} from "../../shared/bot-avatar";
import { BotAvatar } from "./Avatar";
import { AvatarImageGenerator } from "./AvatarImageGenerator";

type AvatarPatch = Partial<
  Pick<Bot, "avatarCrop" | "avatarUrl" | "avatarZoom" | "avatarFocusX" | "avatarFocusY" | "color" | "mascotExpression" | "mascotBody">
>;

const FRAME_SIZE = 168;

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
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Zoom</span>
        <span className="tabular-nums text-[12px] text-ink-secondary">{Math.round(zoom * 100)}%</span>
      </div>
      <input
        type="range"
        min={AVATAR_ZOOM_MIN}
        max={AVATAR_ZOOM_MAX}
        step={0.01}
        value={zoom}
        disabled={disabled}
        aria-label="Zoom avatar"
        aria-valuemin={AVATAR_ZOOM_MIN}
        aria-valuemax={AVATAR_ZOOM_MAX}
        aria-valuenow={zoom}
        aria-valuetext={`${Math.round(zoom * 100)}%`}
        onChange={(event) => onPatch({ avatarZoom: clampAvatarZoom(Number(event.target.value)) })}
        className="w-full accent-accent"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px] text-ink-secondary">
        <span>Drag the picture to reposition it. Scroll to zoom.</span>
        {framed && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPatch({ avatarZoom: AVATAR_ZOOM_MIN, avatarFocusX: AVATAR_FOCUS_CENTER, avatarFocusY: AVATAR_FOCUS_CENTER })}
            className="shrink-0 rounded-md px-2 py-1 text-ink hover:bg-control disabled:opacity-50"
          >
            Reset framing
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
  const { flushBotPatches } = useStore();
  const { request: api, uploadAvatar } = useBotEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [savingConnection, setSavingConnection] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const crop = bot.avatarCrop ?? "mascot";
  // A custom picture opens on its own tab, where its zoom and framing live.
  const [editorTab, setEditorTab] = useState<"bot" | "generate" | "upload" | "reset">(
    () => (crop !== "mascot" && bot.avatarUrl ? "upload" : "bot"),
  );
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const busy = uploading || generating || savingConnection;

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setUploading(true);
    setError(null);
    try {
      const saved = uploadAvatar ? null : await imageAttachmentFromFile(file);
      const avatarUrl = uploadAvatar ? await uploadAvatar(file) : saved ? botAvatarUrlFromStoredPath(saved.path) : null;
      if (!avatarUrl) throw new Error("The uploaded image could not be used as an avatar");
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

  const resetMascot = () => onPatch({ avatarCrop: "mascot", color: "green", mascotExpression: null, mascotBody: "cursor" });

  return (
    <div className="relative">
      <div className="flex justify-center py-3">
        <button
          type="button"
          aria-label="Edit avatar"
          aria-expanded={editorOpen}
          onClick={() => setEditorOpen((open) => !open)}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <BotAvatar
            bot={bot}
            state={activeState}
            size={112}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
          />
        </button>
      </div>
      <div hidden={!editorOpen} className="absolute left-1/2 top-full z-30 mt-2 w-[280px] -translate-x-1/2 rounded-2xl border border-hairline/50 bg-card p-3 shadow-2xl shadow-black/50">
        <div className="mb-3 flex items-center gap-1 text-[12px]">
          {(["bot", "generate", "upload"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={editorTab === tab}
              onClick={() => setEditorTab(tab)}
              className={cn("rounded-md px-2 py-1 capitalize", editorTab === tab ? "bg-control text-ink" : "text-ink-secondary hover:text-ink")}
            >
              {tab === "bot" ? "Bot" : tab === "generate" ? "Generate" : "Upload"}
            </button>
          ))}
          <button type="button" onClick={resetMascot} className="ml-auto px-2 py-1 text-ink-secondary hover:text-ink">Reset</button>
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
                Upload image
              </button>
              {bot.avatarUrl && (
                <button
                  type="button"
                  onClick={removeImage}
                  disabled={busy}
                  aria-label="Remove custom avatar image"
                  title="Remove custom image"
                  className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="mt-1.5 text-[11.5px] text-ink-secondary">PNG, JPEG, GIF, or WebP · up to 10 MB</div>
            {crop !== "mascot" && bot.avatarUrl && <AvatarFraming bot={bot} disabled={busy} onPatch={onPatch} />}
          </div>
        )}

        {editorTab === "bot" && crop === "mascot" && (
          <>
            <div className="flex flex-wrap justify-center gap-2">
              {MAUS_COLOR_NAMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={busy}
                  aria-pressed={bot.color === color}
                  onClick={() => onPatch({ color })}
                  className={cn("size-6 rounded-full disabled:opacity-50", bot.color === color && "ring-2 ring-white/80 ring-offset-2 ring-offset-card")}
                  style={swatchStyle(color)}
                  title={color}
                  aria-label={`Use ${color} mascot color`}
                />
              ))}
            </div>
          </>
        )}
        {editorTab === "bot" && crop !== "mascot" && (
          <button type="button" onClick={() => onPatch({ avatarCrop: "mascot" })} className="text-[13px] text-ink-secondary hover:text-ink">Use the mascot</button>
        )}
        {editorTab === "generate" && (
          <AvatarImageGenerator
            botLabel={bot.title || bot.name}
            disabled={uploading}
            generating={generating}
            onGenerate={generate}
            onSavingChange={setSavingConnection}
          />
        )}

        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
