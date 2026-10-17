// Spoken answers to a permission card, shared by both call modes. Anything
// else is read as a reply to the bot, not as consent — an approval must
// never be granted by a sentence that merely contained the word "sure".
export const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|allow|approve|approved|fine|please do)\b/i;
export const NO = /^(no|nope|don'?t|do not|stop|deny|denied|cancel|never|skip it)\b/i;

const FILLER = /^(?:(?:um+|uh+|er+|so|well|hmm+)[\s,.!?-]+)+/i;
/** On a Live call these only hedge: "okay…" then a pause then "wait, what
 * does it delete?", a bystander's "okay", or the voice's own "Okay, I need
 * your permission" heard back through a phone's speaker. They are filler
 * there, never the answer; a clear yes or no after them still counts. */
const LIVE_HEDGES = /^(?:(?:um+|uh+|er+|so|well|hmm+|ok|okay|sure|fine)(?:[\s,.!?-]+|$))+/i;
// A Live approval grants the entire action on the card. Extra conditions,
// questions or corrections are not permission for that unchanged action.
const LIVE_YES = /^(?:yes|yeah|yep|yup|go ahead|do it|allow(?: it)?|approve(?: it)?|approved|please do)(?:[\s,]+(?:please|go ahead|do it))*[.!]*$/i;

// A voice call (voice mode, the take-turns call, a room, the iPhone): the
// card is spoken as a question with its two options, "Allow once, or deny?",
// and the answer must pick one of them. English and French (Québec words
// included). Hedges ("okay", "sure", "d'accord", "ben") never decide: the
// options are asked again. An allow is the whole utterance, nothing more
// ("yes, but rename it first" is not consent for the unchanged action). A
// deny may carry a reason, but not a question, a turn ("no wait, yes") or an
// affirmative word: those are asked again too. Declining is always safe, so
// it is the lenient side; Always allow is never reachable by voice.
const VOICE_HEDGES = /^(?:(?:um+|uh+|er+|euh+|heu+|so|well|hmm+|ben|bon|alors|ok|okay|sure|fine|d'accord|correct|parfait)(?:[\s,.!?-]+|$))+/i;
const VOICE_YES = /^(?:yes|yeah|yep|yup|go ahead|do it|allow(?: it)?(?: once)?|approve(?: it)?|approved|confirm(?: it)?|please do|oui|confirme|je confirme|confirmer|ouais|vas-y|allez-y|autorise(?:-le)?(?: une fois)?|autoriser(?: une fois)?|j'autorise|approuve|j'approuve|j'accepte|accepte)(?:[\s,]+(?:please|go ahead|do it|yes|once|oui|vas-y|allez-y|une fois|merci|s'il te pla[iî]t|s'il vous pla[iî]t))*[.!]*$/i;
const VOICE_NO = /^(?:no|nope|nah|don'?t|do not|stop|deny|denied|cancel|never|skip it|non|nan|refuse|refuser|je refuse|annule|annuler|jamais|pas question|laisse faire|laisse tomber)(?=$|[\s,.!-])/i;
const VOICE_NOT_A_DENY = /\?|(?<![\p{L}\p{N}])(?:but|wait|actually|instead|unless|yes|yeah|allow|approve|confirm|go ahead|mais|attends|en fait|plutôt|sauf|oui|ouais|vas-y|allez-y|autorise|approuve|confirme)(?![\p{L}\p{N}])/iu;

function voiceConsent(text: string): "allow" | "deny" | null {
  const said = text.trim().replace(/[\u2018\u2019\u02BC]/g, "'").replace(VOICE_HEDGES, "");
  if (!said) return null;
  if (VOICE_YES.test(said)) return "allow";
  const no = VOICE_NO.exec(said);
  if (no && !VOICE_NOT_A_DENY.test(said.slice(no[0].length))) return "deny";
  return null;
}

/** "allow", "deny", or null when the words are not a clear decision. The
 * answer must open the utterance; filler before it ("uh, yes") is dropped.
 * `live`: a Live call, whose microphone stays open while the voice speaks
 * and which decides after a short quiet window — hedges never decide there.
 * `turns` (take turns) keeps its own rule: its microphone is closed while
 * the bot talks. `voice`: the strict two-option answer above, for every
 * call that speaks the card as "Allow once, or deny?". */
export function spokenConsent(text: string, mode: "turns" | "live" | "voice" = "turns"): "allow" | "deny" | null {
  if (mode === "voice") return voiceConsent(text);
  const said = text.trim().replace(mode === "live" ? LIVE_HEDGES : FILLER, "");
  if ((mode === "live" ? LIVE_YES : YES).test(said)) return "allow";
  if (NO.test(said)) return "deny";
  return null;
}
