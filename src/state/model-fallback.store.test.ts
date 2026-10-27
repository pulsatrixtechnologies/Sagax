// #1154: the model menu keeps what a turn really ran on, with its engine
// when it moved to another one, and only for the person it ran for.
import { describe, expect, it } from "vitest";

import { initialState, reducer, type AppState } from "./store";

const base = (viewer: string | null): AppState => ({
  ...initialState,
  config: { ...initialState.config, ...(viewer ? { viewer: { principalId: viewer } } : {}) } as AppState["config"],
});
const fallback = (extra: Record<string, unknown> = {}) => ({
  type: "modelVariantRuntime" as const,
  event: {
    type: "session.model-fallback", eventId: "e1", provider: "grokAgent", providerInstanceId: "grok", threadId: "t1", turnId: "u1",
    createdAt: "2026-10-27T00:00:00.000Z", requested: "grok-4.7", actual: "claude-opus-5", ...extra,
  } as never,
});

describe("session.model-fallback in the store (#1154)", () => {
  it("keeps the other engine the turn ran on", () => {
    const next = reducer(base("pr_bob"), fallback({ actualInstanceId: "claude", principalId: "pr_bob" }));
    expect(next.modelFallbacks?.t1).toEqual({ instanceId: "grok", requested: "grok-4.7", actual: "claude-opus-5", actualInstanceId: "claude" });
  });

  it("ignores another person's turn in a group", () => {
    const next = reducer(base("pr_alice"), fallback({ principalId: "pr_bob" }));
    expect(next.modelFallbacks?.t1).toBeUndefined();
  });
});
