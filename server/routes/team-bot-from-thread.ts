// "Create a Team Bot from this conversation" (server/team-bot-draft.ts).
//
//   POST /api/bots/:id/team-bot-draft   { threadId, language? }
//        { draft, memory: { notes: [{ path, bytes }] } }: the new bot's name,
//        role, description and instructions drafted by this bot's model from
//        the conversation (or from its title and lines when the model cannot),
//        and the memory notes that MAY go along, for the dialog to list.
//        Reading the conversation is the only right it needs.
//   POST /api/bots/:id/team-bot-carry   { threadId, newBotId, includeMemory: true, notes?, summary? }
//        Copies the ticked notes of this bot's memory, and a summary of the
//        conversation (memory/conversation-carry-over.md), into the new bot.
//        Without `includeMemory: true` it answers 400 and writes nothing:
//        memory carry-over is an explicit opt-in. Needs to read this
//        conversation and to change the new bot.
//
// The bot itself is created by the ordinary POST /api/bots, its plugins by
// /api/bots/:id/plugins/install, and it is shared with the team through the
// existing Team Bot path (bot settings > Sharing on an organization server,
// grants through Perspicax). Nothing here adds a multi-person view.
import { z } from "zod";

import { draftSummary } from "../compaction-summary.ts";
import type { RequestAuth } from "../request-auth.ts";
import {
  CARRY_SUMMARY_PATH,
  carryOverNote,
  carryOverPlan,
  conversationLines,
  excerptText,
  fallbackTeamBotDraft,
  parseTeamBotDraft,
  teamBotDraftPrompt,
  type DraftMessage,
} from "../team-bot-draft.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Generate = (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;

export interface TeamBotFromThreadDeps {
  bot(id: string): { id: string; name: string } | undefined;
  /** The conversation, when this caller may read it; null otherwise. */
  thread(auth: RequestAuth, botId: string, threadId: string): { title: string; messages: readonly DraftMessage[] } | null;
  /** Whether this caller may change that bot (the new one). */
  mayChange(auth: RequestAuth, botId: string): boolean;
  /** The bot's one-shot when its model may be asked now; null otherwise. */
  generate(botId: string): Generate | null;
  /** The source bot's memory notes that may travel (index and topics). */
  memoryNotes(botId: string): Array<{ path: string; bytes: number }>;
  readNote(botId: string, path: string): string;
  writeNote(auth: RequestAuth, botId: string, path: string, text: string): void;
  now?(): number;
  /** The one-shot's limit (tests shorten it). */
  timeoutMs?: number;
}

const draftBody = z.object({ threadId: z.string().regex(/^[\w-]{1,128}$/), language: z.enum(["fr", "en"]).optional() }).strict();
const carryBody = z.object({
  threadId: z.string().regex(/^[\w-]{1,128}$/),
  newBotId: z.string().regex(/^[\w-]{1,128}$/),
  includeMemory: z.boolean().optional(),
  notes: z.array(z.string().max(300)).max(200).optional(),
  summary: z.boolean().optional(),
}).strict();

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timed out")); }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createTeamBotFromThreadRoutes(deps: TeamBotFromThreadDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const draft = path.match(/^\/api\/bots\/([\w-]{1,128})\/team-bot-draft$/);
    if (draft && method === "POST") {
      const parsed = draftBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { threadId, language? }" });
      const bot = deps.bot(draft[1]!);
      const thread = bot ? deps.thread(auth, bot.id, parsed.data.threadId) : null;
      if (!bot || !thread) return json(res, 404, { error: "Conversation not found" });
      const language = parsed.data.language ?? "en";
      const lines = conversationLines(thread.messages);
      const fallback = fallbackTeamBotDraft(lines, { threadTitle: thread.title, language });
      let result = fallback;
      const generate = lines.length ? deps.generate(bot.id) : null;
      if (generate) {
        try {
          const prompt = teamBotDraftPrompt(excerptText(lines), { botName: bot.name, threadTitle: thread.title, language });
          result = parseTeamBotDraft(await withTimeout((signal) => generate(prompt, { signal }), deps.timeoutMs ?? 30_000), fallback);
        } catch {
          result = fallback;
        }
      }
      return json(res, 200, { draft: result, memory: { notes: deps.memoryNotes(bot.id), summaryPath: CARRY_SUMMARY_PATH } });
    }
    const carry = path.match(/^\/api\/bots\/([\w-]{1,128})\/team-bot-carry$/);
    if (carry && method === "POST") {
      const parsed = carryBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { threadId, newBotId, includeMemory: true, notes?, summary? }" });
      const plan = carryOverPlan(parsed.data, deps.memoryNotes(carry[1]!).map((note) => note.path));
      if (!plan.includeMemory) return json(res, 400, { error: "Memory carry-over is opt-in: send includeMemory: true.", code: "memory_opt_in" });
      const bot = deps.bot(carry[1]!);
      const thread = bot ? deps.thread(auth, bot.id, parsed.data.threadId) : null;
      if (!bot || !thread) return json(res, 404, { error: "Conversation not found" });
      const target = deps.bot(parsed.data.newBotId);
      if (!target || target.id === bot.id || !deps.mayChange(auth, target.id)) return json(res, 404, { error: "New bot not found" });
      const written: string[] = [];
      for (const note of plan.notes) {
        const text = deps.readNote(bot.id, note);
        if (!text.trim()) continue;
        deps.writeNote(auth, target.id, note, text);
        written.push(note);
      }
      if (plan.summary) {
        const lines = conversationLines(thread.messages);
        if (lines.length) {
          const generate = deps.generate(bot.id) ?? undefined;
          const summary = await draftSummary(lines, { signal: new AbortController().signal, generateText: generate, timeoutMs: deps.timeoutMs ?? 20_000 });
          deps.writeNote(auth, target.id, CARRY_SUMMARY_PATH, carryOverNote(summary, { threadTitle: thread.title, botName: bot.name, at: deps.now?.() ?? Date.now() }));
          written.push(CARRY_SUMMARY_PATH);
          // The index points at it, so the new bot finds it.
          const index = deps.readNote(target.id, "MEMORY.md");
          if (!index.includes(CARRY_SUMMARY_PATH)) {
            deps.writeNote(auth, target.id, "MEMORY.md", `${index.trimEnd()}${index.trim() ? "\n" : ""}- [Conversation carried over](${CARRY_SUMMARY_PATH}): where this bot comes from.\n`);
          }
        }
      }
      return json(res, 200, { written });
    }
    return PASS;
  };
}
