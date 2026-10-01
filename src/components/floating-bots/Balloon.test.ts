import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Balloon, BALLOON_MIN, moveBalloon, readBalloonPlace, resizeBalloon, writeBalloonPlace } from "./Balloon";
import { newFloatingSession, withHistory } from "./brain";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
};

describe("the desktop balloon", () => {
  it("resizes from its free corner, never below 280 x 160 nor past its room", () => {
    const above = { below: false, right: false };
    expect(resizeBalloon({ w: 300, h: 200 }, { x: -50, y: -40 }, above, { w: 900, h: 600 })).toEqual({ w: 350, h: 240 });
    expect(resizeBalloon({ w: 300, h: 200 }, { x: 200, y: 200 }, above, { w: 900, h: 600 })).toEqual(BALLOON_MIN);
    expect(resizeBalloon({ w: 300, h: 200 }, { x: 900, y: 900 }, { below: true, right: true }, { w: 500, h: 400 })).toEqual({ w: 500, h: 400 });
  });

  it("moves away from the mascot only, within the room left on screen", () => {
    const above = { below: false, right: false };
    expect(moveBalloon({ dx: 0, dy: 0 }, { x: -120, y: -60 }, above, { x: 300, y: 300 })).toEqual({ dx: -120, dy: -60 });
    // toward the mascot it stays docked
    expect(moveBalloon({ dx: 0, dy: 0 }, { x: 80, y: 50 }, above, { x: 300, y: 300 })).toEqual({ dx: 0, dy: 0 });
    // no farther than the screen allows
    expect(moveBalloon({ dx: 0, dy: 0 }, { x: -900, y: -900 }, above, { x: 200, y: 100 })).toEqual({ dx: -200, dy: -100 });
    expect(moveBalloon({ dx: 0, dy: 0 }, { x: 90, y: 40 }, { below: true, right: true }, { x: 300, y: 300 })).toEqual({ dx: 90, dy: 40 });
  });

  it("remembers its size and place per bot", () => {
    const storage = memory();
    writeBalloonPlace("bot_a", { w: 420, h: 300, dx: -40, dy: -20 }, storage);
    expect(readBalloonPlace("bot_a", storage)).toEqual({ w: 420, h: 300, dx: -40, dy: -20 });
    expect(readBalloonPlace("bot_b", storage)).toEqual({});
    storage.setItem("omb.floatingBots.balloon.v1", JSON.stringify({ bot_a: { w: 10, h: "x" } }));
    expect(readBalloonPlace("bot_a", storage)).toEqual({ w: BALLOON_MIN.w });
  });

  it("renders replies as markdown, earlier exchanges above, a multi-line field", () => {
    const html = renderToStaticMarkup(createElement(Balloon, {
      botId: "bot_a",
      name: "Ada",
      balloon: { kind: "chat", text: "**Done**:\n\n- one\n- two\n\n`code`", asked: "Do it", history: [{ asked: "Hi", text: "Hello *there*" }], streaming: false, truncated: false, open: "Open", close: "Close", input: { label: "Message", placeholder: "Ask", send: "Send" } },
      retro: false,
      side: { below: false, right: false },
      room: { x: 100, y: 100, w: 480, h: 400 },
      onEvent: () => undefined,
      hover: () => undefined,
      pinLabel: "Pin",
    }));
    expect(html).toContain("<strong>Done</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<em>there</em>");
    expect(html.indexOf("Hello")).toBeLessThan(html.indexOf("Done"));
    expect(html).toContain("<textarea");
    expect(html).toContain('data-corner="top-left"');
  });

  it("keeps the last exchanges as history when a new question is asked", () => {
    let session = { ...newFloatingSession(), asked: "one?", lastReply: "first" };
    session = { ...session, history: withHistory(session), asked: "two?", lastReply: "second" };
    expect(withHistory(session)).toEqual([{ asked: "one?", text: "first" }, { asked: "two?", text: "second" }]);
    expect(withHistory(newFloatingSession())).toEqual([]);
  });
});
