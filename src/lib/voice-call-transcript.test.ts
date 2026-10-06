import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import type { CollapsedItem } from "@/lib/bot-exchange";
import {
  foldCollapsedEntry,
  foldVoiceMessage,
  formatVoiceCallDuration,
  spokenLines,
  voiceCallDurationMs,
  voiceCallPlan,
} from "@/lib/voice-call-transcript";

const line = (id: string, role: "user" | "bot", text: string, at: number, extra: Partial<Message> = {}): Message =>
  ({ id, role, kind: "text", text, at, ...extra }) as Message;

describe("voice call transcript", () => {
  it("folds one call into a single card and leaves the next typed line out", () => {
    const messages = [
      line("u", "user", "hello there", 1_000, { voiceCall: { callId: "call-1" } }),
      line("b", "bot", "hi back", 35_000),
      line("t", "user", "after", 40_000),
    ];
    const plan = voiceCallPlan(messages);
    expect([...plan.hidden]).toEqual(["u", "b"]);
    const seen = new Set<string>();
    expect(foldVoiceMessage(messages[0]!, plan, seen).kind).toBe("card");
    expect(foldVoiceMessage(messages[1]!, plan, seen).kind).toBe("skip");
    expect(foldVoiceMessage(messages[2]!, plan, seen).kind).toBe("keep");
    const card = plan.byCall.get("call-1")!;
    expect(spokenLines(card.messages).map((spoken) => spoken.text)).toEqual(["hello there", "hi back"]);
    expect(formatVoiceCallDuration(voiceCallDurationMs(card.messages, 0, null))).toBe("00:34");
  });

  it("keeps a Live via-call line as a normal row", () => {
    const spoken = line("m", "user", "spoken words", 1_000, { via: "call" });
    const plan = voiceCallPlan([spoken]);
    expect(plan.hidden.size).toBe(0);
    expect(foldVoiceMessage(spoken, plan, new Set()).kind).toBe("keep");
  });

  it("leaves an approval in the thread without ending the call", () => {
    const messages = [
      line("u", "user", "hello there", 1_000, { voiceCall: { callId: "call-1" } }),
      { id: "ask", role: "bot", kind: "options", text: "Allow this?", at: 2_000 } as Message,
      line("b", "bot", "hi back", 35_000),
    ];
    const plan = voiceCallPlan(messages);
    expect(plan.hidden.has("ask")).toBe(false);
    expect(plan.hidden.has("b")).toBe(true);
    expect(spokenLines(plan.byCall.get("call-1")!.messages).map((spoken) => spoken.text)).toEqual(["hello there", "hi back"]);
  });

  it("replaces a fragment when the next turn continues it", () => {
    const messages = [
      line("u1", "user", "hel", 1_000, { voiceCall: { callId: "call-1" } }),
      line("u2", "user", "hello", 1_200, { voiceCall: { callId: "call-1", continues: true } }),
      line("b", "bot", "hi back", 2_000),
    ];
    expect(spokenLines(voiceCallPlan(messages).byCall.get("call-1")!.messages).map((spoken) => spoken.text)).toEqual(["hello", "hi back"]);
  });

  it("emits the whole card from the first line still inside the window", () => {
    const messages = [
      line("u", "user", "hello there", 1_000, { voiceCall: { callId: "call-1" } }),
      line("b", "bot", "hi back", 35_000),
    ];
    const plan = voiceCallPlan(messages);
    const seen = new Set<string>();
    const fold = foldVoiceMessage(messages[1]!, plan, seen);
    expect(fold.kind).toBe("card");
    if (fold.kind === "card") expect(fold.card.messages.map((message) => message.id)).toEqual(["u", "b"]);
    expect(foldVoiceMessage(messages[1]!, plan, seen).kind).toBe("skip");
  });

  it("pads minutes and rolls into hours", () => {
    expect(formatVoiceCallDuration(34_000)).toBe("00:34");
    expect(formatVoiceCallDuration(90_000)).toBe("01:30");
    expect(formatVoiceCallDuration(3_661_000)).toBe("1:01:01");
  });

  it("uses a live clock until the call ends", () => {
    const messages = [line("u", "user", "hello", 1_000)];
    expect(voiceCallDurationMs(messages, 10_000, { startedAt: 4_000, endedAt: null })).toBe(6_000);
    expect(voiceCallDurationMs(messages, 99_000, { startedAt: 4_000, endedAt: 38_000 })).toBe(34_000);
  });

  it("pulls spoken lines out of an exchange run", () => {
    const user = line("u", "user", "hello there", 1_000, { voiceCall: { callId: "call-1" } });
    const bot = line("b", "bot", "hi back", 2_000, { from: { botId: "other", name: "Other", color: "blue" } });
    const plan = voiceCallPlan([user, bot]);
    const entry: CollapsedItem = {
      kind: "exchange",
      run: {
        id: "exchange:b",
        messages: [bot],
        party: { id: "other", name: "Other" },
        ends: [{ id: "other", name: "Other" }],
      },
    };
    const seen = new Set<string>();
    const pieces = foldCollapsedEntry(entry, plan, seen);
    expect(pieces.map((piece) => piece.kind)).toEqual(["card"]);
    if (pieces[0]?.kind === "card") expect(pieces[0].card.messages.map((message) => message.id)).toEqual(["u", "b"]);
  });
});
