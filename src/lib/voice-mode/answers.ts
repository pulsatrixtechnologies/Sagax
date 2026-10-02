// Spoken answers to a permission card, shared by every call. Anything else
// is read as a reply to the bot, not as consent: an approval must never be
// granted by a sentence that merely contained the word "sure".
export const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|allow|approve|approved|fine|please do|oui|ouais|d'accord|vas-y|allez-y|j'approuve)\b/i;
export const NO = /^(no|nope|don'?t|do not|stop|deny|denied|cancel|never|skip it|non|refuse|annule|jamais)\b/i;
