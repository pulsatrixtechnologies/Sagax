// 2026-10-27 (#1220): the products a custom rule may name come from what the
// servers declare (Perspicax api_list, the bot's MCP server ids), never from
// a list in the code. A rule is a guard: these cases keep "never write in X"
// applied whether or not the names are known yet.
import { describe, expect, it } from "vitest";

import { callFacts, compileRule, compileSavedRule, evaluateCustomRules, productWordsOf, type CustomRule, type RuleProduct } from "./custom-rules.ts";

const DECLARED: RuleProduct[] = [
  { id: "acme_desk", name: "Acme Desk" },
  { id: "acme_guard", name: "Acme Guard" },
  { id: "example_wiki", name: "Example Wiki" },
];

let seq = 0;
function rule(when: string, behavior: CustomRule["behavior"], extra: Partial<CustomRule> = {}): CustomRule {
  seq += 1;
  return { id: `p${seq}`, ownerId: "me", botId: null, when, behavior, riskScope: [], enabled: true, createdAt: seq, updatedAt: seq, ...extra };
}

const gateway = (api: string, verb: string, input: Record<string, unknown> = {}) =>
  callFacts({ tool: `mcp__perspicax_lab__${api}__${verb}`, input: JSON.stringify(input) });
const deskWrite = gateway("acme_desk", "ticket_update", { id: 1, summary: "x" });
const deskRead = gateway("acme_desk", "ticket_get", { id: 1 });
const guardWrite = gateway("acme_guard", "policy_update", { id: 1 });
const guardRead = gateway("acme_guard", "policy_get", { id: 1 });

describe("declared product words", () => {
  it("a declared product is named by its id's parts and its name's words, not by common words", () => {
    expect(productWordsOf({ id: "acme_desk", name: "Acme Desk" })).toEqual(["acme", "desk"]);
    expect(productWordsOf({ id: "acme_cloud_api", name: "Acme Cloud API" })).toEqual(["acme"]);
    // an action or object word never names a product: "files" stays a file
    expect(productWordsOf({ id: "files_hub", name: "Files Hub" })).toEqual([]);
  });

  it("without a declaration, a word names no product", () => {
    expect(compileRule("utiliser Acme Desk").recognized).toBe(false);
    // the whole name names that product, not another one sharing a word
    expect(compileRule("utiliser Acme Desk", undefined, undefined, DECLARED).products).toEqual(["acme_desk"]);
    expect(compileRule("utiliser acme_desk", undefined, undefined, DECLARED).products).toEqual(["acme_desk"]);
    // one shared word names every product that holds it
    expect(compileRule("utiliser Acme", undefined, undefined, DECLARED).products).toEqual(["acme_desk", "acme_guard"]);
    expect(compileRule("utiliser Acme Desk", undefined, undefined, DECLARED).recognized).toBe(true);
    expect(compileRule("utiliser le desk", undefined, undefined, DECLARED).products).toEqual(["acme_desk"]);
  });

  it("a bare server id is named only whole, its parts in order", () => {
    const servers: RuleProduct[] = [{ id: "example_chat" }, { id: "evil_acme" }, { id: "files" }];
    expect(compileRule("envoyer avec example chat", undefined, undefined, servers).products).toEqual(["example_chat"]);
    expect(compileRule("envoyer avec example", undefined, undefined, servers).products).toEqual([]);
    expect(compileRule("lire avec acme", undefined, undefined, servers).products).toEqual([]);
    expect(compileRule("lire les files", undefined, undefined, servers).products).toEqual([]);
  });
});

describe("kinds named by a common word", () => {
  it("a calendar is named by its common word, whatever the brand", () => {
    const calendarWrite = callFacts({ tool: "mcp__example_calendar__create_event", input: "{}" });
    expect(calendarWrite.products).toEqual(["example_calendar", "calendar"]);
    expect(evaluateCustomRules([rule("ne jamais modifier mon agenda", "deny")], calendarWrite).kind).toBe("deny");
    expect(evaluateCustomRules([rule("ne jamais modifier mon agenda", "deny")], deskWrite, { products: DECLARED }).kind).toBe("none");
  });
});

describe("never write in X stays applied", () => {
  const deny = rule("ne jamais écrire dans Acme Desk", "deny");

  it("refuses a write in X, and only in X, when the names are declared", () => {
    expect(evaluateCustomRules([deny], deskWrite, { products: DECLARED }).kind).toBe("deny");
    expect(evaluateCustomRules([deny], guardWrite, { products: DECLARED }).kind).toBe("none");
    // "Acme" alone names both: the deny holds for both
    expect(evaluateCustomRules([rule("ne jamais écrire dans Acme", "deny")], guardWrite, { products: DECLARED }).kind).toBe("deny");
    expect(evaluateCustomRules([deny], deskRead, { products: DECLARED }).kind).toBe("none");
  });

  it("still refuses the write before the names are read (it then reads as every write)", () => {
    expect(evaluateCustomRules([deny], deskWrite, { products: [], gatewayNamesUnknown: true }).kind).toBe("deny");
    expect(evaluateCustomRules([deny], deskWrite).kind).toBe("deny");
  });

  it("a rule saved with its product keeps it when the product is no longer declared", () => {
    const pinned = rule("ne jamais écrire dans Acme Desk", "deny", { products: ["acme_desk"] });
    expect(compileSavedRule(pinned).products).toEqual(["acme_desk"]);
    expect(evaluateCustomRules([pinned], deskWrite, { gatewayNamesUnknown: true }).kind).toBe("deny");
    expect(evaluateCustomRules([pinned], guardWrite, { gatewayNamesUnknown: true }).kind).toBe("none");
  });

  it("a deny wins over an allow of the same product", () => {
    const allow = rule("toujours permettre les modifications dans Acme Desk", "allow");
    expect(evaluateCustomRules([allow, deny], deskWrite, { products: DECLARED }).kind).toBe("deny");
  });
});

describe("an allow naming X never widens", () => {
  const allow = rule("toujours permettre la lecture dans Acme Desk", "allow");

  it("covers reads of X only", () => {
    expect(evaluateCustomRules([allow], deskRead, { products: DECLARED }).kind).toBe("allow");
    expect(evaluateCustomRules([allow], guardRead, { products: DECLARED }).kind).toBe("none");
    expect(evaluateCustomRules([allow], gateway("example_wiki", "page_get"), { products: DECLARED }).kind).toBe("none");
  });

  it("covers no gateway call while the names are not read, unless it pinned its product", () => {
    expect(evaluateCustomRules([allow], deskRead, { gatewayNamesUnknown: true }).kind).toBe("none");
    expect(evaluateCustomRules([allow], guardRead, { gatewayNamesUnknown: true }).kind).toBe("none");
    const pinned = { ...allow, products: ["acme_desk"] };
    expect(evaluateCustomRules([pinned], deskRead, { gatewayNamesUnknown: true }).kind).toBe("allow");
    expect(evaluateCustomRules([pinned], guardRead, { gatewayNamesUnknown: true }).kind).toBe("none");
  });

  it("a product no longer declared still binds a pinned allow", () => {
    const pinned = rule("toujours permettre la lecture dans Example Wiki", "allow", { products: ["example_wiki"] });
    expect(evaluateCustomRules([pinned], deskRead, { products: [{ id: "acme_desk", name: "Acme Desk" }] }).kind).toBe("none");
  });
});
