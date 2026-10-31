/** Isolated gallery for headless screenshots of an outside agent's
 * conversation with a bot (2026-10-29, shared/agent-conversation.ts): the
 * bot's chat with its quiet "Go to conversation" line and the Earlier
 * topics list, an agent row beside a bot row; a click opens "<agent> ⇆
 * <bot>". The agent's name comes from ?agent= (neutral by default); the
 * capture script answers the thread read. Not shipped in the app.
 * ?skin=<id>&lang=<code>&agent=<name> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotConversationLine, EarlierConversationList, type BotConversationRow } from "../components/BotConversations";
import { ExchangeColumnProvider, useExchangeColumn } from "../components/BotExchangeChip";
import { agentCallerLabel, agentOpenerId } from "../../shared/agent-conversation";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const agentName = agentCallerLabel(params.get("agent") ?? "Voice assistant");
const bots = [
  { id: "nova", name: "Nova", color: "blue" },
  { id: "pixel", name: "Pixel", color: "orange" },
] as unknown as Bot[];
const self = { id: "nova", name: "Nova", color: "blue" as const };
const now = Date.now();
const agentRow: BotConversationRow = { threadId: "agent-thread", otherBotId: agentOpenerId(agentName), otherName: agentName, direction: "in", kind: "agent", updatedAt: now, startedAt: now - 120_000 };
const botRow: BotConversationRow = { threadId: "pair-thread", otherBotId: "pixel", otherName: "Pixel", direction: "out", kind: "pair", updatedAt: now - 3_600_000, startedAt: now - 7_200_000 };

function Gallery() {
  const column = useExchangeColumn();
  return (
    <div className="h-screen bg-app text-ink" data-gallery="">
      <div ref={column.ref} className="relative mx-auto flex h-full max-w-3xl flex-col gap-3 px-5 py-6">
        <ExchangeColumnProvider node={column.node}>
          <div className="text-[12px] text-ink-secondary">Earlier topics</div>
          <EarlierConversationList self={self} rows={[agentRow, botRow]} bots={bots} />
          <div className="self-end rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px]">What did you do this morning?</div>
          <div className="self-start rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] text-ink">I sorted the weekly reports and answered two questions.</div>
          <div data-gallery-line="">
            <BotConversationLine self={self} row={agentRow} bots={bots} />
          </div>
        </ExchangeColumnProvider>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
