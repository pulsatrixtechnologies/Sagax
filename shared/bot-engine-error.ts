/** What a bot is told when a teammate has no engine. Older chats stored
 * this sentence on a failed turn; the app translates it for the reader. */
export const NO_ENGINE_MESSAGE = "Ce bot n'a pas de moteur : choisis-en un dans Modifier le bot > Modèle";

/** What a bot is told when the named engine is gone. */
export const ENGINE_REMOVED_MESSAGE = "Le moteur de ce bot n'est plus disponible : choisis-en un autre dans Modifier le bot > Modèle";

/** Person-facing refusal. The `error` text is the English fallback (a phone
 * that only shows that field). Clients that know the code translate it. */
export const NO_ENGINE_CODE = "no_engine";

/** English the server sends for {@link NO_ENGINE_CODE}. Keep it identical to
 * `composer.error.noEngine`. */
export const NO_ENGINE_PERSON = "This bot has no engine: choose one in Edit bot > Model";

/** English for a removed engine, identical to `composer.error.engineRemoved`. */
export const ENGINE_REMOVED_PERSON = "This bot's engine is no longer available: choose another in Edit bot > Model";
