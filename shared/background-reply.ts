// Background replies: on a request that takes more than a quick answer, the
// bot says what it will do first, then finishes the work as its own task
// while the conversation stays free. The server owns the handoff
// (server/index.ts). What lives here needs no I/O: which requests leave the
// conversation, the one-sentence acknowledgement (the person's own words,
// never a result), and which later sentences are worth posting as milestones.
//
// Absent `backgroundReplies` means on. A bot sets it false to wait for the
// whole answer in one turn.

export function backgroundRepliesEnabled(bot: { backgroundReplies?: boolean } | undefined): boolean {
  return Boolean(bot) && bot!.backgroundReplies !== false;
}

export type RequestPace = "quick" | "work";

/** A greeting, thanks, or a yes/no that is the whole message. */
const QUICK_EXACT = /^(?:bonjour|salut|allo|allô|hello|hi|hey|merci|thanks|thank you|oui|non|yes|no|ok|okay|d'accord|ça va|ca va|parfait|super|cool|bye|au revoir|bonne journée|good morning|good night)[.!?\s]*$/iu;

const WORK_VERB_LIST = [
  "énumérer", "énumère", "enumerer", "enumere",
  "afficher", "affiche", "montrer", "montre", "donner", "donne",
  "lister", "liste", "chercher", "cherche", "trouver", "trouve",
  "vérifier", "vérifie", "verifier", "verifie",
  "résumer", "résume", "resumer", "resume",
  "préparer", "prépare", "preparer", "prepare",
  "rédiger", "rédige", "rediger", "redige",
  "analyser", "analyse", "comparer", "compare", "calculer", "calcule",
  "exporter", "exporte", "envoyer", "envoie", "créer", "crée", "creer", "cree", "faire", "fais",
  "summarizing", "summarizes", "summarize", "summarising", "summarise",
  "preparing", "prepares", "prepare", "drafting", "drafts", "draft",
  "writing", "writes", "write", "creating", "creates", "create",
  "listing", "lists", "list",
  "checking", "checks", "check", "showing", "shows", "show",
  "displaying", "displays", "display", "finding", "finds", "find",
  "searching", "searches", "search", "reading", "reads", "read",
  "opening", "opens", "open", "reviewing", "reviews", "review",
  "compiling", "compiles", "compile", "exporting", "exports", "export",
  "sending", "sends", "send", "calculating", "calculates", "calculate",
  "comparing", "compares", "analyzing", "analyzes", "analyze",
  "analysing", "analyses", "fetching", "fetches", "fetch",
  "downloading", "downloads", "download", "uploading", "uploads", "upload",
  "updating", "updates", "update", "looking", "looks", "look",
  "getting", "gets", "get",
];

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORK_VERB_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...WORK_VERB_LIST].sort((a, b) => b.length - a.length).map(escapeReg).join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

/** quick: a short question or a greeting. work: a lookup, a file, a link,
 * or anything long enough that the answer will not be the first sentence. */
export function classifyRequest(text: string): RequestPace {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || QUICK_EXACT.test(cleaned)) return "quick";
  if (/https?:\/\//i.test(cleaned)) return "work";
  if (/<attached|\[attachment|attached-archive/i.test(cleaned)) return "work";
  if (/(?:^|\s)(?:\.\.?\/|~\/|\/[\w.-]{2,}|[\w.-]+\/[\w./-]{2,})/.test(cleaned)) return "work";
  if (WORK_VERB_RE.test(cleaned)) return "work";
  if (cleaned.length > 240) return "work";
  return "quick";
}

export function shouldBackgroundReply(input: {
  bot: { backgroundReplies?: boolean } | undefined;
  text: string;
  voice?: boolean;
  hidden?: boolean;
  nested?: boolean;
  /** Teammate work this conversation already handed out and still waits on.
   * A follow-up has to stay here so it can see those assignments. */
  outstanding?: number;
}): boolean {
  if (!backgroundRepliesEnabled(input.bot)) return false;
  if (input.voice || input.hidden || input.nested) return false;
  if ((input.outstanding ?? 0) > 0) return false;
  const text = input.text.trim();
  if (!text || text.startsWith("/")) return false;
  return classifyRequest(text) === "work";
}

/** The conversation a background task's handoff belongs to. The person is
 * reading the parent thread; the task's own thread is only where the work
 * runs. A parallel task that is not a background reply keeps its own thread. */
export function backgroundConversationThread(
  task: { parallelOf?: { background?: boolean; threadId?: string } } | null | undefined,
  threadId: string,
): string {
  const parent = task?.parallelOf;
  if (parent?.background && parent.threadId) return parent.threadId;
  return threadId;
}

const FRENCH_CUE = /[àâäéèêëïîôùûüçœæ]/i;
const FRENCH_WORD = /(?<![\p{L}\p{N}])(?:peux|pourrais|pouvez|tu|des|affiche|montre|donne|cherche|trouve|vérifie|verifie|prépare|prepare|résume|resume|liste|comptes|bonjour|salut|merci|est-ce|s'il|svp)(?![\p{L}\p{N}])/iu;

function isFrench(text: string): boolean {
  return FRENCH_CUE.test(text) || FRENCH_WORD.test(text);
}

const FR_LEADS: Array<[string, string]> = [
  ["énumérer", "Je dresse la liste de"], ["enumerer", "Je dresse la liste de"],
  ["énumère", "Je dresse la liste de"], ["enumere", "Je dresse la liste de"],
  ["lister", "Je dresse la liste de"], ["liste", "Je dresse la liste de"],
  ["chercher", "Je cherche"], ["cherche", "Je cherche"],
  ["trouver", "Je cherche"], ["trouve", "Je cherche"],
  ["vérifier", "Je vérifie"], ["verifier", "Je vérifie"],
  ["vérifie", "Je vérifie"], ["verifie", "Je vérifie"],
  ["résumer", "Je résume"], ["resumer", "Je résume"],
  ["résume", "Je résume"], ["resume", "Je résume"],
  ["afficher", "Je vérifie"], ["affiche", "Je vérifie"],
  ["montrer", "Je vérifie"], ["montre", "Je vérifie"],
  ["donner", "Je vérifie"], ["donne", "Je vérifie"],
  ["préparer", "Je prépare"], ["preparer", "Je prépare"],
  ["prépare", "Je prépare"], ["prepare", "Je prépare"],
  ["rédiger", "Je prépare"], ["rediger", "Je prépare"],
  ["rédige", "Je prépare"], ["redige", "Je prépare"],
  ["analyser", "Je prépare"], ["analyse", "Je prépare"],
  ["comparer", "Je prépare"], ["compare", "Je prépare"],
  ["calculer", "Je prépare"], ["calcule", "Je prépare"],
  ["exporter", "Je prépare"], ["exporte", "Je prépare"],
  ["envoyer", "Je prépare"], ["envoie", "Je prépare"],
  ["créer", "Je prépare"], ["creer", "Je prépare"],
  ["crée", "Je prépare"], ["cree", "Je prépare"],
  ["faire", "Je prépare"], ["fais", "Je prépare"],
];

const EN_LEADS: Array<[string, string]> = [
  ["summarizing", "I'm summarizing"], ["summarizes", "I'm summarizing"],
  ["summarize", "I'm summarizing"], ["summarising", "I'm summarizing"],
  ["summarise", "I'm summarizing"],
  ["preparing", "I'm preparing"], ["prepares", "I'm preparing"], ["prepare", "I'm preparing"],
  ["drafting", "I'm preparing"], ["drafts", "I'm preparing"], ["draft", "I'm preparing"],
  ["writing", "I'm preparing"], ["writes", "I'm preparing"], ["write", "I'm preparing"],
  ["creating", "I'm preparing"], ["creates", "I'm preparing"], ["create", "I'm preparing"],
  ["listing", "I'm listing"], ["lists", "I'm listing"], ["list", "I'm listing"],
  ["checking", "I'm checking"], ["checks", "I'm checking"], ["check", "I'm checking"],
  ["showing", "I'm checking"], ["shows", "I'm checking"], ["show", "I'm checking"],
  ["displaying", "I'm checking"], ["displays", "I'm checking"], ["display", "I'm checking"],
  ["finding", "I'm checking"], ["finds", "I'm checking"], ["find", "I'm checking"],
  ["searching", "I'm checking"], ["searches", "I'm checking"], ["search", "I'm checking"],
  ["reading", "I'm checking"], ["reads", "I'm checking"], ["read", "I'm checking"],
  ["opening", "I'm checking"], ["opens", "I'm checking"], ["open", "I'm checking"],
  ["reviewing", "I'm checking"], ["reviews", "I'm checking"], ["review", "I'm checking"],
  ["compiling", "I'm checking"], ["compiles", "I'm checking"], ["compile", "I'm checking"],
  ["exporting", "I'm checking"], ["exports", "I'm checking"], ["export", "I'm checking"],
  ["sending", "I'm checking"], ["sends", "I'm checking"], ["send", "I'm checking"],
  ["calculating", "I'm checking"], ["calculates", "I'm checking"], ["calculate", "I'm checking"],
  ["comparing", "I'm checking"], ["compares", "I'm checking"], ["compare", "I'm checking"],
  ["analyzing", "I'm checking"], ["analyzes", "I'm checking"], ["analyze", "I'm checking"],
  ["analysing", "I'm checking"], ["analyses", "I'm checking"],
  ["fetching", "I'm checking"], ["fetches", "I'm checking"], ["fetch", "I'm checking"],
  ["downloading", "I'm checking"], ["downloads", "I'm checking"], ["download", "I'm checking"],
  ["uploading", "I'm checking"], ["uploads", "I'm checking"], ["upload", "I'm checking"],
  ["updating", "I'm checking"], ["updates", "I'm checking"], ["update", "I'm checking"],
  ["looking", "I'm checking"], ["looks", "I'm checking"], ["look", "I'm checking"],
  ["getting", "I'm checking"], ["gets", "I'm checking"], ["get", "I'm checking"],
];

function firstVerb(text: string, table: ReadonlyArray<readonly [string, string]>): { lead: string; object: string } | null {
  const sorted = [...table].sort((a, b) => b[0].length - a[0].length);
  let best: { index: number; lead: string; object: string } | null = null;
  for (const [verb, lead] of sorted) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeReg(verb)}(?![\\p{L}\\p{N}])`, "iu");
    const match = re.exec(text);
    if (!match) continue;
    if (best && match.index >= best.index) continue;
    best = { index: match.index, lead, object: text.slice(match.index + match[0].length).trim() };
  }
  return best ? { lead: best.lead, object: best.object } : null;
}

function accentAge(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])([Aa])ge(?![\p{L}\p{N}])/gu, (_whole, letter: string) => (letter === "A" ? "Âge" : "âge"));
}

/** "de Alubar" → "d'Alubar". "des" stays "des". */
function elideDe(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])de\s+(?=[aeiouhéèêëàâîïôûùh])/giu, "d'");
}

function tidyObject(object: string, french: boolean): string {
  let text = object.replace(/^[-–]?\s*(?:moi|me|m')\s+/iu, "").trim();
  if (french) text = accentAge(elideDe(text));
  text = text.replace(/[.!?…,;:\s]+$/u, "").trim();
  if (text.length > 140) {
    const cut = text.slice(0, 140);
    const space = cut.lastIndexOf(" ");
    text = `${(space > 80 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return text;
}

function joinLead(lead: string, object: string): string {
  let head = lead;
  let rest = object;
  if (head.endsWith(" de")) {
    if (/^les\b/iu.test(rest)) {
      head = head.slice(0, -3);
      rest = rest.replace(/^les\b/iu, "des");
    } else if (/^(?:des|du|de la|de l'|d')/iu.test(rest)) {
      head = head.slice(0, -3);
    }
  }
  return `${head} ${rest}`.replace(/\s+/g, " ").trim();
}

function endSentence(text: string): string {
  const trimmed = text.replace(/[.!?…\s]+$/u, "").trim();
  return trimmed ? `${trimmed}.` : "";
}

/** One sentence naming the first step, built only from the person's words.
 * A `[gate:…]` marker is a test hold and is left out of the sentence. */
export function stepAcknowledgement(text: string): string {
  const cleaned = text.replace(/\s*\[gate:[^\]]*\]/gi, " ").replace(/\s+/g, " ").trim();
  const french = isFrench(cleaned);
  const verb = firstVerb(cleaned, french ? FR_LEADS : EN_LEADS);
  if (verb) {
    const object = tidyObject(verb.object, french);
    if (!object) return french ? "Je vérifie." : "I'm checking.";
    return endSentence(joinLead(verb.lead, object));
  }
  if (/https?:\/\//i.test(cleaned)) return french ? "Je vérifie ce lien." : "I'm checking that link.";
  if (/<attached|\[attachment|attached-archive/i.test(cleaned)) return french ? "Je lis la pièce jointe." : "I'm reading the attachment.";
  if (cleaned.length > 240) return french ? "Je commence par le début de ta demande." : "I'll start from the beginning of your request.";
  return french ? "Je vérifie." : "I'm checking.";
}

const RESULT_PHRASES = ["voici", "here are", "here is", "the answer is", "la réponse", "l'âge moyen", "l'age moyen"];

/** True when a sentence states a result (a number, a list, "here is") rather
 * than the step the bot is about to take. */
export function ackClaimsResult(sentence: string): boolean {
  const lower = sentence.trim().toLowerCase();
  if (!lower) return false;
  if (RESULT_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  if (/:\s*\d/.test(lower)) return true;
  if (/\d+\s*(?:ans|années|years|year)\b/iu.test(sentence)) return true;
  if (/\d+\s*,\s*\d+/.test(lower)) return true;
  const digit = lower.search(/\d/);
  if (digit >= 0) {
    const window = lower.slice(Math.max(0, digit - 40), Math.min(lower.length, digit + 40));
    if (/(?<![\p{L}\p{N}])(?:est|sont|is|are|ont|have|has)(?![\p{L}\p{N}])/u.test(window)) return true;
  }
  return false;
}

const ANGLICISMS = ["checker", "update", "background", "loading", "display", "show", "please", "email", "report", "check"];

/** Anglicisms a Québec French acknowledgement must not use. */
export function frenchAnglicisms(sentence: string): string[] {
  return ANGLICISMS.filter((word) => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "iu").test(sentence));
}

/** The first sentence, or the template when that sentence is empty, too
 * long, claims a result, or uses an anglicism in French. */
export function acceptAck(raw: string, request: string): string {
  const first = raw.trim().split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  const french = isFrench(first) || isFrench(request);
  if (!first || first.length > 200 || ackClaimsResult(first) || (french && frenchAnglicisms(first).length > 0)) {
    return stepAcknowledgement(request);
  }
  return endSentence(first);
}

/** Milliseconds from the person's message to the acknowledgement. A clock
 * that went backwards, or a missing timestamp, reads as zero. */
export function timeToFirstMessageMs(requestedAt: number, ackedAt: number): number {
  if (!Number.isFinite(requestedAt) || !Number.isFinite(ackedAt)) return 0;
  return Math.max(0, Math.round(ackedAt - requestedAt));
}

/** A milestone is one short sentence. A report, a table, or a second
 * sentence stays in the task until the result. */
export function isMilestone(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12 || trimmed.length > 180) return false;
  if (/[\n\r]/.test(trimmed) || trimmed.includes("```") || trimmed.includes("|")) return false;
  const marks = trimmed.match(/[.!?]/g);
  return Boolean(marks && marks.length === 1);
}

export interface MilestoneGate {
  lastAt: number;
  count: number;
  last: string;
}

const MILESTONE_GAP_MS = 15_000;
const MILESTONE_CAP = 6;

function sameWords(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

/** At most one milestone every 15 seconds, six per task, never the
 * acknowledgement again and never the same sentence twice. */
export function milestoneGate(
  state: MilestoneGate | undefined,
  text: string,
  now: number,
  ack: string,
): { accept: boolean; state: MilestoneGate } {
  const current: MilestoneGate = state ?? { lastAt: 0, count: 0, last: "" };
  const trimmed = text.trim();
  if (!isMilestone(trimmed) || sameWords(trimmed, ack) || (current.last && sameWords(trimmed, current.last))) {
    return { accept: false, state: current };
  }
  if (current.count >= MILESTONE_CAP) return { accept: false, state: current };
  if (current.lastAt && now - current.lastAt < MILESTONE_GAP_MS) return { accept: false, state: current };
  return { accept: true, state: { lastAt: now, count: current.count + 1, last: trimmed } };
}

/** Safety net for a direct turn the server did not hand off itself (the
 * model noticed the work only after it started reading). The server already
 * hands off requests it can see are long, and that acknowledgement is
 * already in the conversation. */
export const BACKGROUND_REPLY_PROMPT = [
  "Quick questions: answer directly, in the person's language, with no acknowledgement.",
  "When you discover the request needs a lookup or more than one step, your first message is exactly one sentence naming the first concrete step, in the person's language.",
  "In French, use Québec French and tutoiement, with no anglicisms (never checker, update, background, loading, display, show, please, email, or report).",
  "That sentence is not an answer: never a result, a number, or a claim you have not checked.",
  "Then call start_thread with report_back true on yourself and end the turn.",
  "The server already does this for requests it can see are long; do not repeat an acknowledgement already in the conversation.",
].join(" ");

/** The task that does the work. Its last message is posted back into the
 * conversation; the acknowledgement the person already saw is not an answer. */
export const BACKGROUND_WORKER_PROMPT = [
  "The person already saw a one-sentence acknowledgement of the first step. It is not an answer.",
  "Do the work. Send a one-sentence status only when something meaningful changed.",
  "Your last message is the full result and is delivered separately.",
  "Do not repeat the acknowledgement. Do not state a result you have not checked.",
  "Write in the person's language. In French, use Québec French and tutoiement, with no anglicisms.",
].join(" ");
