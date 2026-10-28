/** Isolated gallery for headless screenshots of one turn whose tool calls
 * were approved with no card (2026-10-28): the receipts of calls an Always
 * allow answered, a failed call, and the conversation's
 * turn counters. Not shipped in the app. ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalCard } from "../components/ApprovalCard";
import { ToolActivity } from "../components/ToolActivity";
import { TurnTimingLine } from "../components/TurnTimingLine";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

const bot = { id: "bot-scout", name: "Scout", color: "violet", approvalMode: "full" } as unknown as Bot;
const store = { state: { bots: [bot] }, dispatch: () => {}, flushBotPatches: async () => null } as unknown as ReturnType<typeof useStore>;

const HINTS = { product: "Help desk", productId: "desk" };
const receipt = (id: string, tool: string, description: string) => ({
  id, role: "bot", kind: "options", at: 0, text: "", from: { botId: bot.id },
  card: {
    requestId: `req-${id}`, requestType: "permission", tool: `mcp__hub__${tool}`, mcpTool: `mcp__hub__${tool}`,
    title: "Approval needed", subtitle: description, options: [], toolInput: JSON.stringify({ assigned: "me", days: 7 }),
    toolHints: HINTS, answered: "allow", ruleSaved: { id: `rule-${id}`, behavior: "allow", description },
  },
}) as unknown as Message;

const RECEIPTS = [
  receipt("a", "desk__time_entries_query", "View time entries in Help desk"),
  receipt("b", "desk__tickets_query", "View tickets in Help desk"),
  receipt("c", "desk__activities_query", "View activities in Help desk"),
];
const tool = (name: string, ok: boolean, output: string) => ({
  name: `mcp__hub__${name}`, ok, input: JSON.stringify({ assigned: "me", days: 7 }), output, durationMs: 1_400, ...HINTS,
  autoApproval: { source: "full-access" },
});
// the one call that failed: shown whatever the "show tool calls" setting
const TOOLS = [tool("desk__activities_query", false, "params_invalid: conditions")];

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div data-shot="turn" className="mx-auto flex max-w-[760px] flex-col gap-1 rounded-2xl bg-card py-3">
        <TurnTimingLine timing={{ queueMs: 421_900, firstResponseMs: 29_779 }} />
        <div className="flex flex-col gap-1 px-5 pt-2">
          {RECEIPTS.map((message) => <ApprovalCard key={message.id} bot={bot} message={message} threadId="t1" />)}
          {TOOLS.map((item) => <ToolActivity key={item.name} tool={item} />)}
          <p className="pt-2 text-[14px] text-ink">You have 3 open tickets and 2 hours logged this week.</p>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <Gallery />
    </BotEditorStore>
  </StrictMode>,
);
