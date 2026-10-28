// #1450: a provider account that has one model turned off (OpenCode Zen's
// workspace model settings answer "Model access is disabled"). The turn's
// row keeps this one English sentence, so a phone reads it whole and the
// app says it in the reader's language (src/lib/engine-error-text.ts).
// Retrying cannot help: the person picks another model, or whoever manages
// that account turns the model on.

/** The provider's own words for a model turned off on the paying account. */
export const MODEL_ACCESS_DISABLED_TEXT = /\bmodel access is disabled\b|\bmodel (?:is )?disabled\b|\baccess to (?:this|the) model is disabled\b/i;

/** The sentence a failed turn's row keeps. */
export const MODEL_ACCESS_DISABLED_MESSAGE =
  "OpenCode has this model turned off for the account that pays for it. Pick another model, or ask whoever manages that account to turn it on.";
