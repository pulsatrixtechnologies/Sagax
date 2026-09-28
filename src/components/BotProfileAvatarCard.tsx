import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { cn } from "@/lib/cn";
import {
  MAUS_COLORS,
  MAUS_COLOR_NAMES,
  type MausMotion,
  type MausState,
} from "@/lib/mascot";
import { botAvatarUrlFromStoredPath } from "../../shared/bot-avatar";
import { MASCOT_BODIES, MASCOT_BODY_IDS } from "../../shared/mascot-bodies";
import { BotAvatar, MausAvatar } from "./Avatar";
import { AvatarImageGenerator } from "./AvatarImageGenerator";

type AvatarPatch = Partial<
  Pick<Bot, "avatarCrop" | "avatarUrl" | "color" | "mascotExpression" | "mascotBody">
>;

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
  const [editorTab, setEditorTab] = useState<"bot" | "generate" | "upload" | "reset">("bot");
  const crop = bot.avatarCrop ?? "mascot";
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
      onPatch({ avatarUrl, avatarCrop: latestCrop === "mascot" ? "circle" : latestCrop });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = () => {
    setError(null);
    onPatch({ avatarUrl: null, avatarCrop: "mascot" });
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
  const pickerBodies = MASCOT_BODY_IDS;

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
          </div>
        )}

        {editorTab === "bot" && crop === "mascot" && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {pickerBodies.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  aria-pressed={(bot.mascotBody ?? "cursor") === id}
                  aria-label={`Use the ${MASCOT_BODIES[id].name} body`}
                  onClick={() => onPatch({ mascotBody: id, avatarCrop: "mascot" })}
                  className="flex items-center justify-center rounded-full p-1 disabled:opacity-50"
                >
                  <span className={cn("rounded-full p-0.5", (bot.mascotBody ?? "cursor") === id && "ring-2 ring-white/80")}>
                    <MausAvatar color={bot.color} bodyId={id} size={36} animated={false} trackPointer={false} showMouth={false} />
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {MAUS_COLOR_NAMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={busy}
                  aria-pressed={bot.color === color}
                  onClick={() => onPatch({ color })}
                  className={cn("size-6 rounded-full disabled:opacity-50", bot.color === color && "ring-2 ring-white/80 ring-offset-2 ring-offset-card")}
                  style={{ backgroundColor: MAUS_COLORS[color] }}
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
