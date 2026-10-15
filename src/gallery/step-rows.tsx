/** Isolated gallery for Playwright screenshots of the chat's step rows on a
 * long turn: before (one row per step, as #488 drew them: "Used 6 tools",
 * "Could not use mcp" ten times over) and after (one group per turn, the
 * steps inside, the same step merged with a count). Not shipped in the app.
 * ?skin=<id>&lang=<code>&view=before|after|after-open|after-live */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ActivityRun } from "../components/ActivityRun";
import { BotAvatar } from "../components/Avatar";
import { DigestChip } from "../components/DigestChip";
import { StepRow } from "../components/StepRow";
import { ToolActivity } from "../components/ToolActivity";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { stepLabel, stepDuration } from "../lib/step-label";
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

// The long turn of the capture (2026-10-14): Pi's `mcp` gateway, a ticket
// and its notes read in ConnectWise, five calls refused, narration between.
const gateway = (id: string, at: number, ok: boolean | undefined, args: Record<string, unknown>, tool = "cw_psa__query", output?: string): Message => ({
  id, role: "bot", kind: "activity", at,
  tool: { name: "mcp", ...(ok === undefined ? {} : { ok }), durationMs: ok === undefined ? undefined : 2_000, input: JSON.stringify({ server: "pulsatrix-psa", tool, args }), output },
});
const said = (id: string, at: number, text: string): Message => ({ id, role: "bot", kind: "text", at, text, turnId: "turn-long" });
const refused = "{\"code\":\"params_invalid\",\"hint\":\"parent is the id of the object the sub-resource belongs to\"}";
const longTurn: Message[] = [
  said("n1", 1_000, "Je lis le billet #296221."),
  { id: "l1", role: "bot", kind: "activity", at: 2_000, tool: { name: "Read", ok: true, durationMs: 400, input: JSON.stringify({ file_path: "/srv/notes/296221.md" }) } },
  gateway("l2", 3_000, true, { resource: "service.tickets", id: "296221" }),
  gateway("l3", 6_000, true, { resource: "service.tickets", id: "296221", fields: "summary" }),
  gateway("l4", 9_000, false, { parent: ["service.tickets", "296221"], resource: "service.notes" }, "cw_psa__query", refused),
  gateway("l5", 12_000, false, { parent: ["service.tickets", "296221"], resource: "service.notes" }, "cw_psa__query", refused),
  said("n2", 20_000, "Les notes demandent un autre format, je réessaie."),
  gateway("l6", 30_000, true, { resource: "service.notes", parent: "296221" }),
  gateway("l7", 60_000, false, { action: "get", resource: "ticket", id: "296221" }, "cw_psa__query", refused),
  gateway("l8", 90_000, false, { id: "296221" }, "cw_psa_ticket_get", refused),
  { id: "l9", role: "bot", kind: "activity", at: 120_000, tool: { name: "Bash", ok: true, durationMs: 800, input: JSON.stringify({ command: "jq '.items[0].summary' ticket.json" }) } },
  { id: "l10", role: "bot", kind: "activity", at: 121_000, tool: { name: "Bash", ok: true, durationMs: 700, input: JSON.stringify({ command: "jq '.items | length' notes.json" }) } },
  gateway("l11", 150_000, false, { resource: "service.notes", parent: "296221", fields: "*" }, "cw_psa__query", refused),
  gateway("l12", 170_000, true, { resource: "service.notes", parent: "296221", orderBy: "id desc" }),
];
const LONG_ELAPSED = 173_000;
const liveTurn: Message[] = [...longTurn.filter((message) => message.kind === "activity").slice(0, 8), gateway("l13", 172_000, undefined, { resource: "service.notes", parent: "296221" })];
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

/* ---- Before: one row per step, as #488 drew them ---- */
const groupOf = (steps: Message[]) => {
  // #488 folded only finished steps and broke a run at every failure
  const rows: Array<{ label: string; failed?: boolean }> = [{ label: t("chat.run.workedFor", { elapsed: stepDuration(LONG_ELAPSED)! }) }];
  let done = 0;
  const flush = () => {
    if (done > 1) rows.push({ label: t("step.group.many", { count: done }) });
    else if (done === 1) rows.push({ label: t("step.use.done", { name: "mcp" }) });
    done = 0;
  };
  for (const step of steps) {
    if (step.kind !== "activity") continue;
    if (step.tool?.ok === false) {
      flush();
      rows.push({ label: t("step.use.failed", { name: "mcp" }), failed: true });
    } else done += 1;
  }
  flush();
  return rows;
};

function Before() {
  return (
    <Section title="Avant : une ligne par étape">
      {groupOf(longTurn).map((row, i) => (
        <StepRow key={i} label={row.label} phase={row.failed ? "failed" : "done"}>{() => null}</StepRow>
      ))}
    </Section>
  );
}

function Long({ messages, elapsedMs, open = false }: { messages: Message[]; elapsedMs?: number; open?: boolean }) {
  return (
    <ActivityRun
      messages={messages}
      elapsedMs={elapsedMs}
      focusedId={open ? messages.find((message) => message.kind === "activity")?.id : undefined}
      nameOf={nameOf}
      renderStep={(message) => <ToolActivity tool={message.tool!} nameOf={nameOf} />}
      renderMessage={(message) => <div className="self-start rounded-[18px] bg-card px-3 py-2 text-[13px] text-ink">{message.text}</div>}
    />
  );
}

function After() {
  return (
    <>
      <Section title="Après : un groupe par tour">
        <Long messages={longTurn} elapsedMs={LONG_ELAPSED} open={view === "after-open"} />
      </Section>
      {view === "after-live" && (
        <Section title="En cours"><Long messages={liveTurn} /></Section>
      )}
      <Section title="Coordination">
        <ToolActivity tool={coordinate} nameOf={nameOf} />
        <StepRow
          label={stepLabel(sentTo)}
          icon={<BotAvatar bot={{ name: "Wren", color: "green" }} state="happy" size={14} animated={false} />}
          onActivate={() => undefined}
        />
        <ToolActivity tool={resumed} />
      </Section>
      <Section title="Seules">
        <ToolActivity tool={running} />
        <ToolActivity tool={tickets} />
        <ToolActivity tool={web} />
        <ToolActivity tool={failed} />
      </Section>
      <Section title="Résumé du tour"><DigestChip message={digest} /></Section>
      <Section title="Détail déplié"><ToolActivity tool={tickets} defaultOpen /></Section>
    </>
  );
}

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-xl flex-col gap-5" data-gallery={view}>
        <div className="self-end rounded-[18px] bg-bubble-user px-3 py-2 text-[13px] text-ink">Résume le billet #296221</div>
        {view === "before" ? <Before /> : <After />}
        <div className="self-start rounded-[18px] bg-card px-3 py-2 text-[13px] text-ink">Voici le résumé du billet #296221 : gabarit de courriel dans Bamboo, 4 notes.</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
