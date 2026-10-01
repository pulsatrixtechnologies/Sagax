// "Character" in the bot's avatar popover: the same per-bot choice as the
// desktop mascot's Mascot tab (src/lib/floating-bots.ts setBotMascot), with
// the registry's thumbnails, the original shapes when that family is chosen,
// the owl's 2D / 3D (preview) style, and, for a character without wings, a
// live preview of the moves it can do. Loaded lazily with the popover, so
// the mascot registry never weighs on the app's first load.
import { useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { botMascots, setBotMascot, subscribeFloatingBots, type FloatingMascotChoice } from "@/lib/floating-bots";
import { mascotMotion, type MascotActivity } from "./behavior";
import { BODY_CHOICES, DEFAULT_MASCOT, MASCOTS, mascotFor } from "./mascots";

export interface CharacterSectionProps {
  botId: string;
  color: string;
  skin: string;
  disabled?: boolean;
}

const KIND_LABEL = {
  owl: "floatingBots.mascot.owl",
  body: "floatingBots.mascot.body",
  trombi: "floatingBots.mascot.trombi",
} satisfies Record<FloatingMascotChoice["kind"], LocaleKey>;

const MOVE_LABEL: Partial<Record<MascotActivity, LocaleKey>> = {
  wave: "floatingBots.move.wave",
  dance: "floatingBots.move.dance",
  jump: "floatingBots.move.jump",
  hop: "floatingBots.move.hop",
  love: "floatingBots.move.love",
  hoot: "floatingBots.move.hoot",
};

const heading = "mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary";
const card = "flex flex-col items-center gap-0.5 rounded-lg bg-inset px-0.5 pb-1 pt-1.5 transition-colors hover:bg-control disabled:opacity-50";

export default function CharacterSection({ botId, color, skin, disabled }: CharacterSectionProps) {
  const all = useSyncExternalStore(subscribeFloatingBots, botMascots, botMascots);
  const choice = all[botId] ?? DEFAULT_MASCOT;
  const choose = (next: FloatingMascotChoice) => setBotMascot(botId, next);
  const entry = mascotFor(choice);
  // a move tried here plays on the small preview below
  const [move, setMove] = useState<{ clip: MascotActivity; at: number } | null>(null);
  const moveRef = useRef(move);
  moveRef.current = move;

  return (
    <div data-character-section="">
      <div className={cn(heading, "mt-0")}>{t("mascot.character.title")}</div>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("mascot.character.title")}>
        {MASCOTS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            disabled={disabled}
            aria-checked={choice.kind === option.id}
            data-character-option={option.id}
            onClick={() => choose({ ...choice, kind: option.id })}
            className={cn(card, choice.kind === option.id && "ring-2 ring-accent-border")}
          >
            <span className="grid size-11 place-items-center overflow-hidden" aria-hidden="true">
              <option.Thumb color={color} skin={skin} choice={{ ...choice, kind: option.id }} size={40} />
            </span>
            <span className="text-[11px] leading-4 text-ink-secondary">{t(KIND_LABEL[option.id])}</span>
          </button>
        ))}
      </div>

      {choice.kind === "body" && (
        <>
          <div className={heading}>{t("floatingBots.mascot.shape")}</div>
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t("floatingBots.mascot.shape")}>
            {BODY_CHOICES.map((body) => {
              const thumb = MASCOTS.find((option) => option.id === "body")!;
              const chosen = (choice.body ?? "cursor") === body;
              return (
                <button
                  key={body}
                  type="button"
                  role="radio"
                  disabled={disabled}
                  aria-checked={chosen}
                  aria-label={t(`floatingBots.body.${body}`)}
                  title={t(`floatingBots.body.${body}`)}
                  data-character-shape={body}
                  onClick={() => choose({ ...choice, kind: "body", body })}
                  className={cn(card, "pt-1", chosen && "ring-2 ring-accent-border")}
                >
                  <thumb.Thumb color={color} skin={skin} choice={{ kind: "body", body }} size={26} />
                </button>
              );
            })}
          </div>
        </>
      )}

      {choice.kind === "owl" && (
        <div className="mt-2 flex gap-1" role="radiogroup" aria-label={t("floatingBots.mascot.style")}>
          {(["2d", "3d"] as const).map((style) => (
            <button
              key={style}
              type="button"
              role="radio"
              disabled={disabled}
              aria-checked={(choice.style ?? "2d") === style}
              data-character-style={style}
              onClick={() => choose({ ...choice, kind: "owl", style })}
              className={cn("rounded-md px-2 py-1 text-[12px]", (choice.style ?? "2d") === style ? "bg-control text-ink" : "text-ink-secondary hover:text-ink")}
            >
              {t(style === "2d" ? "floatingBots.mascot.flat" : "floatingBots.mascot.threeD")}
            </button>
          ))}
        </div>
      )}

      {entry.moves.length > 0 && (
        <>
          <div className={heading}>{t("mascot.moves.title")}</div>
          <div className="flex items-center gap-2">
            <span className="relative grid size-16 shrink-0 place-items-end overflow-visible" aria-hidden="true">
              <entry.Render
                key={`${entry.id}-${move?.at ?? 0}`}
                color={color}
                skin={skin}
                choice={choice}
                size={60}
                activity={move?.clip ?? "idle"}
                pose="idle"
                frame={(now) => mascotMotion({ activity: moveRef.current?.clip ?? "idle", since: moveRef.current?.at ?? 0, facing: 1 }, { now, pose: "idle", reduced: false, gaze: null })}
                fps={() => 30}
                onHitTest={() => undefined}
              />
            </span>
            <div className="flex flex-wrap gap-1">
              {entry.moves.map((clip) => (
                <button
                  key={clip}
                  type="button"
                  disabled={disabled}
                  data-character-move={clip}
                  aria-label={t("mascot.moves.play", { move: t(MOVE_LABEL[clip] ?? "floatingBots.move.hop") })}
                  onClick={() => setMove({ clip, at: performance.now() })}
                  className="rounded-md bg-control px-2 py-1 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
                >
                  {t(MOVE_LABEL[clip] ?? "floatingBots.move.hop")}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
