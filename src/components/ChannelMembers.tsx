// Presentational roster. The booleans only hide controls. Ajouter calls the matching callback.

import { Plus, X } from "lucide-react";

import type { MausColor } from "@/lib/mascot";
import { BotAvatar, InitialsAvatar } from "./Avatar";

export function channelRosterActions(input: {
  actorRole: "owner" | "admin" | "member" | null;
  actorId: string;
  bots: { id: string; ownerUserId?: string }[];
}): { canAddHuman: boolean; canAddBot: boolean } {
  const actor = input.actorId.trim().toLowerCase();
  const canAddHuman = input.actorRole === "owner" || input.actorRole === "admin";
  const canAddBot = actor !== "" && input.bots.some((bot) => (bot.ownerUserId ?? "").trim().toLowerCase() === actor);
  return { canAddHuman, canAddBot };
}

function initialsFor(label: string): string {
  const parts = label.trim().split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || label.slice(0, 2)).toUpperCase();
}

export function ChannelMembers(props: {
  humans: { id: string; label?: string; detail?: string; avatarUrl?: string; removable?: boolean }[];
  bots: { id: string; name: string; title?: string; color?: string; avatarUrl?: string | null; mascotBody?: string | null }[];
  canAddHuman: boolean;
  canAddBot: boolean;
  onAddHuman?: () => void;
  onAddBot?: () => void;
  onRemoveHuman?: (id: string) => void;
  onRemoveBot?: (id: string) => void;
  part?: "all" | "humans" | "bots";
}) {
  const part = props.part ?? "all";
  return (
    <div className="flex flex-col gap-3">
      {part !== "bots" && (
      <section>
        {part === "all" && <h2 className="px-2 text-[12px] font-semibold text-ink-secondary">Gens</h2>}
        <ul className="overflow-hidden rounded-xl bg-card">
          {props.humans.map((human) => {
            const label = human.label || human.id;
            return (
              <li key={human.id} className="flex items-center gap-3 border-b border-hairline/30 px-3 py-2 last:border-b-0">
                {human.avatarUrl ? (
                  <img src={human.avatarUrl} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <InitialsAvatar initials={initialsFor(label)} size={32} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-ink">{label}</div>
                  {human.detail && <div className="truncate text-[12px] text-ink-secondary">{human.detail}</div>}
                </div>
                {human.removable && (
                  <button
                    type="button"
                    aria-label={`Retirer ${label}`}
                    onClick={() => props.onRemoveHuman?.(human.id)}
                    className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            );
          })}
          {props.canAddHuman && (
            <li>
              <button type="button" aria-label="Ajouter" onClick={() => props.onAddHuman?.()} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink hover:bg-control/40">
                <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-hairline text-ink-secondary"><Plus size={14} /></span>
                Ajouter
              </button>
            </li>
          )}
        </ul>
      </section>
      )}
      {part !== "humans" && (
      <section>
        {part === "all" && <h2 className="px-2 text-[12px] font-semibold text-ink-secondary">Bots</h2>}
        <ul className="overflow-hidden rounded-xl bg-card">
          {props.bots.map((bot) => (
            <li key={bot.id} className="flex items-center gap-3 border-b border-hairline/30 px-3 py-2 last:border-b-0">
              <BotAvatar
                bot={{
                  name: bot.name,
                  color: (bot.color ?? "green") as MausColor,
                  avatarUrl: bot.avatarUrl,
                  mascotBody: bot.mascotBody as never,
                }}
                size={32}
                state="idle"
                animated={false}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">{bot.name}</div>
                {bot.title && <div className="truncate text-[12px] text-ink-secondary">{bot.title}</div>}
              </div>
              {props.onRemoveBot && (
                <button
                  type="button"
                  aria-label={`Retirer ${bot.name}`}
                  onClick={() => props.onRemoveBot?.(bot.id)}
                  className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
          {props.canAddBot && (
            <li>
              <button type="button" aria-label="Ajouter" onClick={() => props.onAddBot?.()} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink hover:bg-control/40">
                <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-hairline text-ink-secondary"><Plus size={14} /></span>
                Ajouter
              </button>
            </li>
          )}
        </ul>
      </section>
      )}
    </div>
  );
}
