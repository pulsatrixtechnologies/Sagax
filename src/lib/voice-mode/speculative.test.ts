import { describe, expect, it } from "vitest";

import { discardSpeculation, holdSpeculativePlayback, mayReviseSpeculation, maySpeculate, SPECULATIVE_REVISE_MS } from "./speculative";

describe("maySpeculate", () => {
  it("starts the LLM on four stable words, even without end-of-turn punctuation", () => {
    expect(maySpeculate("What is the weather")).toBe(true);
    expect(maySpeculate("Quelle heure est il")).toBe(true);
    expect(maySpeculate("Say hello in French.")).toBe(true);
  });

  it("waits on three words even after endpoint silence, including a trailing plus", () => {
    expect(maySpeculate("what time now")).toBe(false);
    expect(maySpeculate("What is two")).toBe(false);
    expect(maySpeculate("What is two plus")).toBe(false);
    expect(maySpeculate("What is 2 +")).toBe(false);
    expect(maySpeculate("what time now", true)).toBe(false);
    expect(maySpeculate("What is two plus two")).toBe(true);
  });

  it("starts on a closed clause only after endpoint silence, not mid-speech", () => {
    expect(maySpeculate("What time?")).toBe(false);
    expect(maySpeculate("Say hello.")).toBe(false);
    expect(maySpeculate("What time?", true)).toBe(true);
    expect(maySpeculate("Say hello.", true)).toBe(true);
  });

  it("waits when the partial is short or still an unfinished clause", () => {
    expect(maySpeculate("What is")).toBe(false);
    expect(maySpeculate("What is the")).toBe(false);
    expect(maySpeculate("give me a good prompt to")).toBe(false);
    expect(maySpeculate("")).toBe(false);
  });
});

describe("holdSpeculativePlayback", () => {
  it("holds audio until the endpoint confirms, then releases it", () => {
    expect(holdSpeculativePlayback({ speculative: true, endpointConfirmed: false })).toBe(true);
    expect(holdSpeculativePlayback({ speculative: true, endpointConfirmed: true })).toBe(false);
    expect(holdSpeculativePlayback({ speculative: false, endpointConfirmed: false })).toBe(false);
  });
});

describe("mayReviseSpeculation", () => {
  it("waits SPECULATIVE_REVISE_MS after the last change before replacing", () => {
    expect(mayReviseSpeculation(1000, 1000 + SPECULATIVE_REVISE_MS - 1)).toBe(false);
    expect(mayReviseSpeculation(1000, 1000 + SPECULATIVE_REVISE_MS)).toBe(true);
  });
});

describe("discardSpeculation", () => {
  it("keeps the in-flight send when the next partial is the same question", () => {
    expect(discardSpeculation("What is the weather", "what is the weather?")).toBe(false);
  });

  it("cancels when the person keeps talking and the words change", () => {
    expect(discardSpeculation("What is the weather", "What is the weather in Toronto")).toBe(true);
    expect(discardSpeculation("call Max about", "call Sam about")).toBe(true);
  });
});
