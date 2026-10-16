import { describe, expect, it } from "vitest";
import { browserTeachPending, onBrowserTeachRequest, requestBrowserTeach, takeBrowserTeach } from "./teach-request";

describe("teach a task in the browser: the request", () => {
  it("is taken once, by the view of the bot it names", () => {
    const heard: string[] = [];
    const stop = onBrowserTeachRequest((botId) => heard.push(botId));
    requestBrowserTeach("bot-a");
    expect(heard).toEqual(["bot-a"]);
    expect(browserTeachPending("bot-a")).toBe(true);
    expect(takeBrowserTeach("bot-b")).toBe(false);
    expect(takeBrowserTeach("bot-a")).toBe(true);
    expect(takeBrowserTeach("bot-a")).toBe(false);
    stop();
    requestBrowserTeach("bot-a");
    expect(heard).toEqual(["bot-a"]);
  });

  it("goes stale when no view takes it", () => {
    requestBrowserTeach("bot-a");
    expect(takeBrowserTeach("bot-a", Date.now() + 61_000)).toBe(false);
  });
});
