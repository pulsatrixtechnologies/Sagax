// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshTopicLanding, leftBotAt, noteBackAtBot, noteLeftBot, readFreshTopicAfter, resetFreshTopicMemory, setOnScreenBot, writeFreshTopicAfter } from "./fresh-topic";
import { initialState, reducer, sendsToFreshTopic, type AppState, type Bot } from "@/state/store";

const H = 3_600_000;
const now = 100 * H;

function topic(over: Record<string, unknown> = {}) {
  return { threadId: "t-live", title: "Invoices", createdAt: 0, updatedAt: now - 5 * H, ...over };
}

beforeEach(() => {
  localStorage.clear();
  resetFreshTopicMemory();
});
afterEach(() => resetFreshTopicMemory());

describe("freshTopicLanding", () => {
  it("lands fresh on a topic quiet past 4 h, stays on one written in an hour ago", () => {
    expect(freshTopicLanding({ id: "b", tasks: [topic()] }, "t-live", { now })).toEqual({ fresh: true, reason: "idle" });
    expect(freshTopicLanding({ id: "b", tasks: [topic({ updatedAt: now - H })] }, "t-live", { now }).fresh).toBe(false);
  });

  it("never over a running turn, an approval waiting or a non-segment thread", () => {
    expect(freshTopicLanding({ id: "b", tasks: [topic({ busy: true })] }, "t-live", { now }).reason).toBe("live");
    expect(freshTopicLanding({ id: "b", tasks: [topic({ activity: "waiting-on-you" })] }, "t-live", { now }).reason).toBe("waiting");
    expect(freshTopicLanding({ id: "b", tasks: [topic({ confidential: true })] }, "t-live", { now }).reason).toBe("no-topic");
    expect(freshTopicLanding({ id: "b", tasks: [topic({ openedBy: { botId: "x" } })] }, "t-live", { now }).reason).toBe("no-topic");
  });

  it("reads when the person left this bot, kept across reloads", () => {
    noteLeftBot("b", now - 5 * H);
    resetFreshTopicMemory();
    expect(leftBotAt("b")).toBe(now - 5 * H);
    expect(freshTopicLanding({ id: "b", tasks: [topic({ updatedAt: now - 6 * H })] }, "t-live", { now })).toEqual({ fresh: true, reason: "away" });
    // an answer that came in after they left is shown first
    expect(freshTopicLanding({ id: "b", tasks: [topic({ updatedAt: now - 10 * 60_000 })] }, "t-live", { now }).reason).toBe("unread");
    noteBackAtBot("b");
    expect(leftBotAt("b")).toBeUndefined();
    // here a minute ago: the old topic the person just read stays
    noteLeftBot("b", now - 60_000);
    expect(freshTopicLanding({ id: "b", tasks: [topic()] }, "t-live", { now }).reason).toBe("seen");
  });

  it("follows the person's setting, and opening the bot on screen is not a return", () => {
    writeFreshTopicAfter(8);
    expect(readFreshTopicAfter()).toBe(8);
    expect(freshTopicLanding({ id: "b", tasks: [topic()] }, "t-live", { now }).fresh).toBe(false);
    writeFreshTopicAfter(0);
    expect(freshTopicLanding({ id: "b", tasks: [topic({ updatedAt: 0 + 1 })] }, "t-live", { now }).reason).toBe("never");
    writeFreshTopicAfter(4);
    setOnScreenBot("b");
    expect(freshTopicLanding({ id: "b", tasks: [topic()] }, "t-live", { now }).fresh).toBe(false);
    expect(freshTopicLanding({ id: "b", tasks: [topic()] }, "t-live", { now, force: true }).fresh).toBe(true);
  });
});

describe("the fresh topic draft in the store", () => {
  const bot = { id: "b", threadId: "t-live", messages: [], tasks: [topic()] } as unknown as Bot;
  const base: AppState = { ...initialState, bots: [bot], selectedId: "b" };

  it("is drawn over a topic, given way by a link into it, and takes the first send", () => {
    const drafted = reducer(base, { type: "freshTopic", botId: "b", threadId: "t-live", auto: true });
    expect(drafted.freshTopic.b).toEqual({ threadId: "t-live", auto: true });
    expect(sendsToFreshTopic(drafted, { botId: "b" })).toBe(true);
    expect(sendsToFreshTopic(drafted, { botId: "b", threadId: "t-other" })).toBe(false);
    // a voice call's words stay with the call's thread
    expect(sendsToFreshTopic(drafted, { botId: "b", voiceCall: { callId: "c" } })).toBe(false);
    // the optimistic row never lands in the topic under the draft
    const sent = reducer(drafted, { type: "send", botId: "b", text: "hello", sendId: "s1" });
    expect(sent.bots[0]!.messages).toHaveLength(0);
    // a link or a search hit into one of the bot's topics shows it
    expect(reducer(drafted, { type: "focusMessage", threadId: "t-live", messageId: "m" }).freshTopic.b).toBeUndefined();
    expect(reducer(drafted, { type: "freshTopic", botId: "b", threadId: null }).freshTopic.b).toBeUndefined();
  });
});
