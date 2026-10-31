/** Isolated gallery for headless screenshots (no window) of a 1:1 /goal
 * (#1372): what the person saw before the fix (the internal prompt in their
 * bubble, the marker in the reply, an untranslated status row) and after
 * (their goal only, the reply without the marker, the status row in their
 * language). Not shipped in the app.
 * ?skin=<id>&lang=<code>&only=<sample id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { StatusActivityRow } from "../components/StatusActivityRow";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import { withoutSoloGoalMarker } from "../../shared/solo-goal-line";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const only = params.get("only");

const GOAL = "Rédiger les notes de version 0.9 et les publier dans docs/";
// What the server stored as the person's message before the fix (soloGoalPrompt).
const OLD_PROMPT = [
  `Goal: ${GOAL}`,
  "Work toward this goal in this conversation. Keep going until it is done or you are blocked.",
  "When it is done, end your reply with exactly this line, and put a short detail in it:",
  '<sagax-goal>{"status":"completed","detail":"what you finished"}</sagax-goal>',
  "The rest of your reply stays visible. Do not emit that line before the goal is actually done.",
].join("\n");
const REPLY = 'Les notes de version 0.9 sont rédigées et publiées dans docs/release-notes-0.9.md.\n<sagax-goal>{"status":"completed","detail":"notes 0.9 publiées"}</sagax-goal>';

const userBubble = (text: string) => (
  <div className="max-w-[460px] self-end rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] whitespace-pre-wrap text-ink">{text}</div>
);
const botBubble = (text: string) => (
  <div className="max-w-[460px] self-start rounded-[18px] bg-card px-3 py-[7px] text-[13px] whitespace-pre-wrap text-ink">{text}</div>
);
// Before: the server wrote the English sentence as a plain tool row.
const oldRow = (text: string) => (
  <div className="flex items-center gap-2 self-start text-[12px] text-ink-tertiary"><span className="size-1.5 rounded-full bg-success" />{text}</div>
);
const row = (soloGoal: NonNullable<NonNullable<Message["tool"]>["soloGoal"]>) => (
  <StatusActivityRow message={{ id: `g-${soloGoal.status}`, at: 1, role: "bot", kind: "activity", tool: { name: "Goal", ok: true, soloGoal } }} />
);

const samples: Array<{ id: string; render: () => React.ReactNode }> = [
  {
    id: "before",
    render: () => (
      <div className="flex w-[560px] flex-col gap-2">
        {userBubble(OLD_PROMPT)}
        {botBubble(REPLY)}
        {oldRow(`Done: ${GOAL} (notes 0.9 publiées)`)}
      </div>
    ),
  },
  {
    id: "after",
    render: () => (
      <div className="flex w-[560px] flex-col gap-2">
        {userBubble(GOAL)}
        {botBubble(withoutSoloGoalMarker(REPLY))}
        {row({ status: "completed", goal: GOAL, detail: "notes 0.9 publiées" })}
      </div>
    ),
  },
  {
    id: "after-status",
    render: () => (
      <div className="flex w-[560px] flex-col gap-2">
        {row({ status: "working", goal: GOAL })}
        {row({ status: "blocked", goal: GOAL, detail: "quel dossier ?" })}
        {row({ status: "paused", goal: GOAL, rounds: 8 })}
        {row({ status: "stopped", goal: GOAL })}
        {row({ status: "none" })}
      </div>
    ),
  },
];

function Gallery() {
  return (
    <div className="flex flex-col items-start gap-10 bg-app p-8 text-ink" data-gallery>
      {samples.filter((sample) => !only || sample.id === only).map((sample) => (
        <div key={sample.id} data-gallery-sample={sample.id}>
          {sample.render()}
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
