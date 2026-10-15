// The chat widgets lab (PARITY_WIDGETS=1 in fixture-server.mjs), for the
// widget UI tests (ios/UITests/ChatWidgetsUITests.swift). Off by default:
// nothing of the reference dataset changes without it.
//
// Pass one creates a "Widget Lab" bot through the API. Between the passes its
// transcript is written straight into the store: one ask, then every widget
// the server's own fixtures hold (ios/Tests/CompanionCoreTests/Fixtures/
// widget-messages.json, written by scripts/gen-widget-fixtures.ts from
// shared/widget-samples.ts through parseWidgetInput), each its own settled
// turn. A press in the app goes to the real send route, which checks it
// against the stored tree, settles the row and starts a turn on the fake CLI.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const WIDGET_LAB = process.env.PARITY_WIDGETS === "1";
export const WIDGET_LAB_BOT = "Widget Lab";

const HERE = dirname(fileURLToPath(import.meta.url));
const lab = { bot: null };

export async function seedWidgetLabBot(base, api) {
  const { bot } = await api(base, "POST", "/api/bots", {
    name: WIDGET_LAB_BOT,
    title: "Laboratoire des widgets",
    modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
  });
  await api(base, "PATCH", `/api/bots/${bot.id}`, { color: "teal" });
  lab.bot = { id: bot.id, threadId: bot.threadId };
  return lab.bot;
}

/** The order the transcript shows them in, top to bottom. */
const ORDER = [
  "widget-future", "widget-broken", "widget-settled", "widget-answer",
  "widget-sources", "widget-kitchenSink", "widget-tokenChart", "widget-spendTable", "widget-emailDraft",
  "widget-buildStatus", "widget-pullRequests", "widget-bookCall", "widget-routineForm", "widget-dinnerChoice",
];

export function seedWidgetLabTranscript(dataDir) {
  if (!lab.bot) return;
  const fixture = JSON.parse(readFileSync(join(HERE, "../Tests/CompanionCoreTests/Fixtures/widget-messages.json"), "utf8"));
  const byId = new Map(fixture.messages.map((message) => [message.id, message]));
  const db = new DatabaseSync(join(dataDir, "messages.db"));
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const leaf = db.prepare("INSERT OR REPLACE INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?)");
  db.prepare("DELETE FROM messages WHERE thread_id = ?").run(lab.bot.threadId);
  const now = Date.now();
  const records = [
    { id: "widget-ask", role: "user", kind: "text", text: "Montre-moi les widgets." },
    ...ORDER.map((id) => byId.get(id)).filter(Boolean),
  ];
  let parent;
  records.forEach((source, index) => {
    const fields = { ...source };
    if (fields.role === "bot") Object.assign(fields, { turnId: `turn-${fields.id}`, turnTerminal: true, turnSucceeded: true });
    const record = { ...fields, at: now - (records.length - index) * 60_000, ...(parent ? { parentId: parent } : {}) };
    insert.run(lab.bot.threadId, record.id, record.at, record.role, record.kind, record.text ?? "", JSON.stringify(record));
    parent = record.id;
  });
  leaf.run(lab.bot.threadId, parent);
  db.close();
}
