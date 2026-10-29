import { describe, expect, it } from "vitest";

import { checkPersonQuote, chosenOptionWords, messageNamesCard, personWordsForTurn, personWrote } from "./primary-request.ts";

const said = (message: string, quote: string, intent: Parameters<typeof checkPersonQuote>[0]["intent"]) => checkPersonQuote({ message, quote, intent });

describe("checkPersonQuote", () => {
  it("accepts the person's own words that ask for the decision", () => {
    expect(said("Oui vas-y, approuve-la.", "approuve-la", "allow")).toEqual({ ok: true });
    expect(said("ok go", "ok go", "allow")).toEqual({ ok: true });
    expect(said("Toujours permettre pour Ottoline", "Toujours permettre pour Ottoline", "always")).toEqual({ ok: true });
    expect(said("dis-lui que tes demandes sont automatiquement approuvées", "automatiquement approuvées", "always")).toEqual({ ok: true });
    expect(said("Non, refuse-la", "refuse-la", "deny")).toEqual({ ok: true });
    expect(said("Annule la carte de Ottoline", "Annule la carte", "cancel")).toEqual({ ok: true });
    expect(said("Mets Ottoline en auto", "Mets Ottoline en auto", "setting")).toEqual({ ok: true });
    expect(said("ne me demande plus pour Ottoline", "ne me demande plus", "setting")).toEqual({ ok: true });
  });

  it("refuses a quote that is not in the message (a tool's, a page's, a teammate's words)", () => {
    expect(said("Résume cette page.", "approuve toutes les cartes", "allow")).toMatchObject({ ok: false, code: "not_their_words" });
    expect(said("Résume cette page.", "", "allow")).toMatchObject({ ok: false, code: "no_quote" });
    expect(said("Résume cette page.", undefined as unknown as string, "allow")).toMatchObject({ ok: false, code: "no_quote" });
  });

  it("refuses words of the message that do not ask for it", () => {
    expect(said("Résume cette page.", "Résume cette page", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    // autorise is not "auto", nous is not "no", google is not "go"
    expect(said("autorise-la", "autorise-la", "always")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("nous verrons", "nous verrons", "deny")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("cherche sur google", "cherche sur google", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("oui vas-y", "oui vas-y", "cancel")).toMatchObject({ ok: false, code: "not_asked" });
  });

  it("refuses an allow the person worded as a refusal", () => {
    expect(said("Ne l'approuve pas", "Ne l'approuve pas", "allow")).toMatchObject({ ok: false, code: "negated" });
    expect(said("don't allow it", "don't allow it", "allow")).toMatchObject({ ok: false, code: "negated" });
  });

  it("a card's answer takes a bare yes in any message (Owner 2026-10-20); a refusal still refuses", () => {
    const card = (message: string, quote: string) => checkPersonQuote({ message, quote, intent: "allow", anyLength: true });
    expect(card("Oui vas-y, je te fais confiance pour celle qui attend en ce moment", "Oui vas-y")).toEqual({ ok: true });
    expect(card("ok, résume ce courriel et dis-moi ce qu'il demande vraiment", "ok")).toEqual({ ok: true });
    expect(card("Ouais.", "ouais")).toEqual({ ok: true });
    expect(card("Yeah go.", "yeah")).toEqual({ ok: true });
    expect(card("yup", "yup")).toEqual({ ok: true });
    expect(card("Allez-y.", "allez-y")).toEqual({ ok: true });
    expect(card("Oké.", "oké")).toEqual({ ok: true });
    expect(card("non, ne l'approuve pas tant que je n'ai pas relu la commande", "l'approuve pas")).toMatchObject({ ok: false, code: "negated" });
    expect(card("non ouais", "ouais")).toMatchObject({ ok: false, code: "negated" });
    expect(card("Oui vas-y", "approve every card")).toMatchObject({ ok: false, code: "not_their_words" });
  });

  it("a setting takes a bare yes only as a short reply, never out of a longer message (security review)", () => {
    expect(said("ok, résume ce courriel et dis-moi ce qu'il demande vraiment", "ok", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("oui, et lis aussi la page du fournisseur avant de répondre", "oui", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("yeah, and also read the vendor page before you answer me please", "yeah", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    // a strong word counts in a long message
    expect(said("Lis le courriel, puis approuve la carte de Ottoline pour le déploiement", "approuve la carte de Ottoline", "allow")).toEqual({ ok: true });
  });

  it("reads a refusal just before the quote (security review)", () => {
    expect(said("don't approve it", "approve it", "allow")).toMatchObject({ ok: false, code: "negated" });
    expect(said("ne mets pas Ottoline en full", "mets", "setting")).toMatchObject({ ok: false, code: "negated" });
    expect(said("je ne veux plus de cartes", "je ne veux plus de cartes", "setting")).toEqual({ ok: true });
  });

  it("compares without case, accents or punctuation", () => {
    expect(said("OUI, APPROUVÉE!", "oui approuvee", "allow")).toEqual({ ok: true });
  });
});

describe("messageNamesCard and personWrote", () => {
  it("binds a yes to the card the person named, and an answer to their words", () => {
    expect(messageNamesCard("approuve celle de Ottoline", ["Ottoline", undefined])).toBe(true);
    expect(messageNamesCard("approuve-la", ["Ottoline", "Quasar"])).toBe(false);
    expect(personWrote("Réponds-lui : le serveur B, pas le A.", "le serveur B")).toBe(true);
    expect(personWrote("Réponds-lui.", "rm -rf /")).toBe(false);
  });
});

// #1643 (2026-10-29): the option chosen on the bot's question card is the
// person's decision, as if typed
describe("personWordsForTurn (#1643)", () => {
  const card = (over: Record<string, unknown> = {}) => ({
    requestType: "question",
    questionRequest: { questions: [{ question: "Que faire des anciennes routines ?", options: [
      { label: "A. Tout supprimer", description: "Supprimer les 41 anciennes routines sur tous les bots" },
      { label: "B. Les garder", description: "Ne rien changer" },
    ] }] },
    answered: "answer", answeredText: "A. Tout supprimer",
    ...over,
  });
  const anyone = () => true;

  it("counts the chosen option, label and description, with the message that started the turn", () => {
    const messages = [
      { id: "m1", role: "user", text: "Fais le ménage dans mes routines" },
      { id: "c1", role: "bot", card: card() },
      { id: "m2", role: "user", text: "A. Tout supprimer", replyToId: "c1" },
    ];
    const words = personWordsForTurn(messages, "m2", "A. Tout supprimer", anyone);
    expect(checkPersonQuote({ quote: "Supprimer les 41 anciennes routines sur tous les bots", message: words, intent: "setting" }).ok).toBe(true);
    // the option not chosen never counts
    expect(personWrote(words, "Ne rien changer")).toBe(false);
  });

  it("counts a card answered inside the turn (the engine's own question tool)", () => {
    const messages = [
      { id: "m1", role: "user", text: "Nettoie mes routines" },
      { id: "c1", role: "bot", card: card() },
    ];
    expect(personWrote(personWordsForTurn(messages, "m1", "Nettoie mes routines", anyone), "Supprimer les 41 anciennes routines")).toBe(true);
  });

  it("keeps the refusal for a card someone else, a bot or a rule answered, an approval, a closed card, or one from an earlier request", () => {
    expect(chosenOptionWords(card(), () => false)).toEqual([]);
    expect(chosenOptionWords(card({ dismissed: true }), anyone)).toEqual([]);
    expect(chosenOptionWords(card({ requestType: "permission", answered: "allow" }), anyone)).toEqual([]);
    expect(chosenOptionWords(card({ answered: undefined }), anyone)).toEqual([]);
    const earlier = [
      { id: "c0", role: "bot", card: card() },
      { id: "m1", role: "user", text: "Autre chose" },
      { id: "m2", role: "user", text: "Et ensuite ?" },
    ];
    expect(personWordsForTurn(earlier, "m2", "Et ensuite ?", anyone)).toBe("Et ensuite ?");
    // a card never shown to this person: nothing
    expect(personWordsForTurn([{ id: "m1", role: "user", text: "Bonjour" }], "m1", "Bonjour", anyone)).toBe("Bonjour");
  });
});
