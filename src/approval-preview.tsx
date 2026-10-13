// Dev gallery for the approval cards (chat card + composer panel), like
// mascot-preview.html. Served by Vite in dev at /approval-preview.html;
// not part of the packaged app. ?lang=fr|en&skin=<id>
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApprovalBox, pendingApprovals } from "@/components/PendingApproval";
import { setLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "@/state/store";
import "./styles.css";

const params = new URLSearchParams(location.search);
// ?scene=coordinate: the agents__coordinate_bots card JC reported (2026-10-13)
const scene = params.get("scene");
setLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "midnight") as SkinId);

const BOT = { id: "preview-bot", name: "Cryptic", color: "green", soul: "" } as unknown as Bot;

const scheduleInput = {
  conditions: "member/identifier='jcproulx' and dateStart >= [2026-10-02T04:00:00Z] and dateStart < [2026-10-04T04:00:00Z]",
  fields: "id,dateStart,dateEnd,member/identifier,objectId,type/name,status/name",
  orderBy: "dateStart asc",
  pageSize: 100,
};
const writeInput = { resource: "time/entries", operation: "create", body: { chargeToType: "ServiceTicket", chargeToId: 287826, member: { identifier: "jcproulx" }, timeStart: "2026-10-02T13:00:00Z", timeEnd: "2026-10-02T14:00:00Z", notes: "Suivi" } };

function card(id: string, tool: string, input: unknown): Message {
  const json = JSON.stringify(input);
  return {
    id,
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: json.length > 200 ? `${json.slice(0, 199)}…` : json,
      toolInput: JSON.stringify(input),
      options: ["Allow", "Deny"],
      requestId: `req-${id}`,
      tool,
      allowSession: true,
    } as Message["card"],
  } as Message;
}

const MESSAGES = [
  card("a", "mcp__perspicax_pulsatrix_flow_jc__cw_psa_schedule__query", scheduleInput),
  card("b", "mcp__perspicax_pulsatrix_flow_jc__cw_psa__write", writeInput),
  card("c", "mcp__claude_ai_Connectwise_PSA__cw_psa__query", { resource: "service/tickets", conditions: "status/name='Nouveau'", pageSize: 25 }),
];
const settledCard = card("d", "mcp__perspicax_pulsatrix_flow_jc__cw_psa__action", { action: "delete", resource: "time/entries", id: 991 });
const SETTLED = [{ ...settledCard, card: { ...settledCard.card!, answered: "allow" } } as Message];

const TEAM = [
  { id: "7669b8f6-1c1e-4f7e-9d61-0a8f4c1b2d01", name: "Atlas", color: "blue" },
  { id: "870a1c5f-5d2b-4b8a-8e2f-3c4d5e6f7a02", name: "Nova", color: "purple" },
  { id: "d48a3619-9e8f-4a7b-b6c5-d4e3f2a1b003", name: "Orion", color: "orange" },
] as unknown as Bot[];
const coordinateInput = {
  bot_ids: TEAM.map((bot) => bot.id),
  message: "Ping from Cryptic, JC is on a voice call and wants a quick status from each of you: what are you working on right now, and is anything blocked? Reply in one or two lines.",
};
function coordinate(id: string, extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  const json = JSON.stringify(coordinateInput);
  return {
    id, role: "bot", kind: "options", at: 1,
    card: {
      title: "Approval needed",
      subtitle: `agents__coordinate_bots ${json}`.slice(0, 200),
      toolInput: json,
      options: ["Allow", "Deny"],
      requestId: `req-${id}`,
      tool: "other",
      mcpTool: "agents__coordinate_bots",
      allowKey: "mcp:agents__coordinate_bots",
      held: "This bot asks before any action that changes something. Always allow stops asking for this one.",
      heldCode: params.get("held") ?? "approval.held.gate",
      ...extra,
    } as Message["card"],
  } as Message;
}
const COORDINATE_PENDING = [coordinate("p")];
const COORDINATE_SETTLED = [
  coordinate("s1", { answered: "allow" }),
  coordinate("s2", { answered: "allow", alwaysAllowed: "mcp:agents__coordinate_bots" }),
  coordinate("s3", { answered: "deny" }),
];

/** The teammates the card names, as the app's store knows them. */
function SeedTeam() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [BOT, ...TEAM], groups: [], computerControl: {} });
  }, [dispatch]);
  return null;
}

function CoordinatePreview() {
  const approvals = pendingApprovals(COORDINATE_PENDING);
  return (
    <>
      <SeedTeam />
      <div className="min-h-screen bg-app p-8 text-ink">
        <div className="mx-auto flex max-w-[840px] flex-col gap-4">
          <div className="text-[12px] text-ink-secondary">Pending:</div>
          {COORDINATE_PENDING.map((message) => <ApprovalCard key={message.id} bot={BOT} message={message} />)}
          <PendingApprovalBox approvals={approvals} threadId="t" botFor={() => BOT} onCancelTurn={() => {}} />
          <div className="mt-4 text-[12px] text-ink-secondary">Settled (allowed once, always allowed, declined):</div>
          {COORDINATE_SETTLED.map((message) => <ApprovalCard key={message.id} bot={BOT} message={message} defaultExpanded={params.has("expand")} />)}
        </div>
      </div>
    </>
  );
}

function Preview() {
  if (scene === "coordinate") return <CoordinatePreview />;
  const approvals = pendingApprovals(MESSAGES);
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-[840px] flex-col gap-4">
        {MESSAGES.map((message) => <ApprovalCard key={message.id} bot={BOT} message={message} />)}
        <div className="mt-6">
          <PendingApprovalBox approvals={approvals} threadId="t" botFor={() => BOT} onCancelTurn={() => {}} />
        </div>
        <div className="mt-2 text-[12px] text-ink-secondary">Settled:</div>
        {SETTLED.map((message) => <ApprovalCard key={message.id} bot={BOT} message={message} />)}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <Preview />
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  </StrictMode>,
);
