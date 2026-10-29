import { describe, expect, it } from "vitest";
import { AGENT_CALLER_FALLBACK, AGENT_LABEL_MAX, agentCallerLabel, agentConversationNotifies, agentOpenerId, isAgentConversation } from "./agent-conversation.ts";
import { isStreamSegment } from "./single-stream.ts";

describe("an outside agent's conversation with a bot", () => {
  it("is named after the client, one clean line, else the fallback", () => {
    expect(agentCallerLabel("  Voice   assistant (phone) ")).toBe("Voice assistant (phone)");
    expect(agentCallerLabel("Line\nbreak\u0007")).toBe("Line break");
    expect(agentCallerLabel("x".repeat(200))).toHaveLength(AGENT_LABEL_MAX);
    expect(agentCallerLabel("")).toBe(AGENT_CALLER_FALLBACK);
    expect(agentCallerLabel(undefined)).toBe(AGENT_CALLER_FALLBACK);
    expect(agentCallerLabel(42)).toBe(AGENT_CALLER_FALLBACK);
  });
  it("has one opener id per client name, never a bot id", () => {
    expect(agentOpenerId("Voice assistant (phone)")).toBe("agent:voice-assistant-phone");
    expect(agentOpenerId("  voice  ASSISTANT (PHONE) ")).toBe("agent:voice-assistant-phone");
    expect(agentOpenerId("Équipe")).toBe("agent:equipe");
    expect(agentOpenerId("!!!")).toBe("agent:client");
  });
  it("is recognized by its opener, and stays out of the person's stream", () => {
    const task = { threadId: "t", createdAt: 1, openedBy: { botId: "agent:voice", name: "Voice", kind: "agent" } };
    expect(isAgentConversation(task)).toBe(true);
    expect(isAgentConversation({ openedBy: { botId: "agent:voice" } })).toBe(true);
    expect(isAgentConversation({ openedBy: { botId: "bot_1", kind: "pair" } })).toBe(false);
    expect(isAgentConversation({})).toBe(false);
    expect(isAgentConversation(undefined)).toBe(false);
    expect(isStreamSegment(task)).toBe(false);
  });
  it("notifies the person only for what they must answer", () => {
    expect(agentConversationNotifies("approval")).toBe(true);
    expect(agentConversationNotifies("question")).toBe(true);
    for (const kind of ["done", "turn-failed", "incident", "delegation-settled", "takeover"]) expect(agentConversationNotifies(kind)).toBe(false);
  });
});
