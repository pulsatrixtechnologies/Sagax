/** Isolated gallery for Playwright screenshots of the chat's step rows,
 * before (bordered monospace pills) and after (quiet rows like a reasoning
 * line). Not shipped in the app. ?skin=<id>&lang=<code>&view=before|after */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Check, ChevronRight, ClipboardList, X } from "lucide-react";
import { ActivityRun } from "../components/ActivityRun";
import { BotAvatar } from "../components/Avatar";
import { DigestChip } from "../components/DigestChip";
import { StepRow } from "../components/StepRow";
import { ToolActivity } from "../components/ToolActivity";
import { TurnNarrationRun } from "../components/TurnNarrationRun";
import { WorkingDots } from "../components/WorkingIndicator";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { stepLabel } from "../lib/step-label";
import type { Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "after";

const bots = [
  { id: "wren", name: "Wren", color: "green" },
  { id: "olive", name: "Olive", color: "orange" },
];
const nameOf = (id: string) => bots.find((bot) => bot.id === id)?.name;

type Tool = NonNullable<Message["tool"]>;
const coordinate: Tool = {
  name: "agents_coordinate_bots", ok: true, durationMs: 1_200,
  input: JSON.stringify({ bot_ids: ["wren", "olive"], message: "Wren : vérifie les billets ouverts de GECKO. Olive : prépare le résumé des ententes." }),
  output: JSON.stringify({ ok: true, requests: [{ bot: "Wren", status: "queued" }, { bot: "Olive", status: "queued" }] }),
};
const tickets: Tool = {
  name: "mcp__claude_ai_Pulsatrix_Perspicax__cw_psa__find_tickets", ok: true, durationMs: 2_400,
  input: JSON.stringify({ conditions: "company/identifier='GECKO' and closedFlag=false", fields: ["id", "summary", "status"], limit: 25 }),
  output: "[{\"id\":297048,\"summary\":\"Imprimante 2e étage\",\"status\":\"Nouveau\"},{\"id\":297112,\"summary\":\"VPN lent\",\"status\":\"En cours\"},{\"id\":297130,\"summary\":\"Compte Teams\",\"status\":\"Nouveau\"}]",
};
const web: Tool = { name: "WebSearch", ok: true, durationMs: 3_100, input: JSON.stringify({ query: "SentinelOne agent 24.2 release notes" }), output: "5 résultats" };
const running: Tool = { name: "mcp__claude_ai_Pulsatrix_Perspicax__sentinelone__query", input: JSON.stringify({ resource: "threats", filter: { resolved: false } }) };
const failed: Tool = { name: "Bash", ok: false, durationMs: 800, input: JSON.stringify({ command: "pnpm test --run src/chat" }), output: "Error: ENOENT: no such file or directory, open 'src/chat'" };
const resumed: Tool = { name: "Resumed with Wren, Olive results, reviewing", ok: true };
const sentTo: Tool = { name: "Sent to Wren", ok: true };

const runSteps: Message[] = [
  { id: "r1", role: "bot", kind: "activity", at: 1, tool: { name: "Read", ok: true, durationMs: 400, input: JSON.stringify({ file_path: "/srv/docs/gecko/ententes.md" }) } },
  { id: "r2", role: "bot", kind: "activity", at: 2, tool: { name: "Grep", ok: true, durationMs: 900, input: JSON.stringify({ pattern: "renouvellement" }) } },
  { id: "r3", role: "bot", kind: "activity", at: 3, tool: tickets },
  { id: "r4", role: "bot", kind: "activity", at: 4, tool: web },
];
const digest: Message = {
  id: "dg", role: "bot", kind: "digest", at: 5, text: "Travail observé pendant ce tour.",
  digest: {
    turnId: "t", botId: "b", threadId: "th", at: 5, durationMs: 14_000,
    tools: [{ name: "Read", count: 1, failed: 0 }, { name: "Bash", count: 1, failed: 1 }, { name: "WebSearch", count: 1, failed: 0 }],
    toolCalls: 3, files: { changed: ["docs/gecko/ententes.md"], added: [], deleted: [] },
    memory: [], reply: "", hookCoverage: "preview",
  },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="mb-1 text-[11px] font-medium tracking-wide text-ink-tertiary uppercase">{title}</h2>
      {children}
    </section>
  );
}

/* ---- Before: the pills as main drew them (#480) ---- */
function OldTool({ tool }: { tool: Tool }) {
  const failedTool = tool.ok === false;
  return (
    <div className="w-fit max-w-full rounded-xl border border-hairline/40 bg-panel text-[13px]">
      <div className={`flex min-h-8 items-center gap-2 rounded-xl px-3 py-1.5 ${failedTool ? "text-danger" : "text-ink-secondary"}`}>
        <span className="shrink-0">{tool.ok === undefined ? <WorkingDots size={3.5} /> : failedTool ? <X size={13} /> : <Check size={13} className="text-success" />}</span>
        <span className="min-w-0 max-w-[30rem] truncate font-mono">{tool.name}</span>
        <ChevronRight size={13} className="ml-auto shrink-0" />
      </div>
    </div>
  );
}
function OldRun({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <span className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary">
        <Check size={13} className="text-success" /><span className="max-w-[480px] truncate">{label}</span><ChevronRight size={13} />
      </span>
    </div>
  );
}
function OldDigest() {
  return (
    <div className="flex justify-start">
      <span className="ui-chip max-w-[min(480px,100%)] border border-hairline/40 bg-panel text-ink-secondary">
        <ClipboardList size={12} /><span className="truncate">{t("chat.digestChip", { tools: 3, files: 1 })}</span>
      </span>
    </div>
  );
}
function OldComm() {
  return (
    <div className="flex justify-start">
      <span className="ui-pill"><BotAvatar bot={{ name: "Wren", color: "green" }} state="happy" size={16} animated={false} /><span>{sentTo.name}</span><ChevronRight size={13} /></span>
    </div>
  );
}

function Before() {
  return (
    <>
      <Section title="En cours"><OldTool tool={running} /></Section>
      <Section title="Coordination"><OldTool tool={coordinate} /><OldComm /><OldTool tool={resumed} /></Section>
      <Section title="Terminé"><OldTool tool={tickets} /><OldTool tool={web} /></Section>
      <Section title="Échec"><OldTool tool={failed} /></Section>
      <Section title="Groupe"><OldRun label="4 étapes · Read, Grep, mcp__claude_ai_Pulsatrix_Perspicax__cw_psa__find_tickets +1 de plus" /></Section>
      <Section title="Résumé du tour"><OldDigest /><OldRun label={t("chat.run.workedFor", { elapsed: "14s" })} /></Section>
    </>
  );
}

function After() {
  return (
    <>
      <Section title="En cours"><ToolActivity tool={running} /></Section>
      <Section title="Coordination">
        <ToolActivity tool={coordinate} nameOf={nameOf} />
        <StepRow
          label={stepLabel(sentTo)}
          icon={<BotAvatar bot={{ name: "Wren", color: "green" }} state="happy" size={14} animated={false} />}
          onActivate={() => undefined}
        />
        <ToolActivity tool={resumed} />
      </Section>
      <Section title="Terminé"><ToolActivity tool={tickets} /><ToolActivity tool={web} /></Section>
      <Section title="Échec"><ToolActivity tool={failed} /></Section>
      <Section title="Groupe">
        <ActivityRun messages={runSteps} forceOpen={view === "after-open"}>
          {runSteps.map((message) => <ToolActivity key={message.id} tool={message.tool!} />)}
        </ActivityRun>
      </Section>
      <Section title="Résumé du tour">
        <DigestChip message={digest} />
        <TurnNarrationRun label={t("chat.run.workedFor", { elapsed: "14s" })}>
          <div className="self-start rounded-[18px] bg-card px-3 py-2 text-[13px] text-ink">Je regarde les billets de GECKO.</div>
        </TurnNarrationRun>
      </Section>
      <Section title="Détail déplié">
        <ToolActivity tool={tickets} defaultOpen />
      </Section>
    </>
  );
}

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-xl flex-col gap-5" data-gallery={view}>
        <div className="self-end rounded-[18px] bg-bubble-user px-3 py-2 text-[13px] text-ink">Fais le point sur GECKO avec Wren et Olive</div>
        {view === "before" ? <Before /> : <After />}
        <div className="self-start rounded-[18px] bg-card px-3 py-2 text-[13px] text-ink">Voici le résumé : 3 billets ouverts, 1 entente à renouveler.</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
