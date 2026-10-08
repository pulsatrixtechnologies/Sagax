import { type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MascotHoverControls } from "./MascotControls";
import { hotkeyAction, type HotkeyContext } from "./hotkey";
import type { FloatingEvent } from "./protocol";
import { DRAG_SLOP, HOVER_IN_MS, HOVER_OUT_MS, hoverControlsShown, isDrag, mascotClick } from "./hover-controls";

describe("hoverControlsShown", () => {
  it("shows HOVER_IN_MS after the pointer arrives, not before", () => {
    expect(hoverControlsShown({ over: true, since: 1000, now: 1000, shown: false, blocked: false })).toEqual({ shown: false, recheckIn: HOVER_IN_MS });
    expect(hoverControlsShown({ over: true, since: 1000, now: 1000 + HOVER_IN_MS - 1, shown: false, blocked: false })).toEqual({ shown: false, recheckIn: 1 });
    expect(hoverControlsShown({ over: true, since: 1000, now: 1000 + HOVER_IN_MS, shown: false, blocked: false })).toEqual({ shown: true, recheckIn: null });
  });

  it("stays while the pointer is over", () => {
    expect(hoverControlsShown({ over: true, since: 0, now: 99_999, shown: true, blocked: false })).toEqual({ shown: true, recheckIn: null });
  });

  it("goes HOVER_OUT_MS after the pointer leaves, so it can reach them", () => {
    expect(hoverControlsShown({ over: false, since: 500, now: 500, shown: true, blocked: false })).toEqual({ shown: true, recheckIn: HOVER_OUT_MS });
    expect(hoverControlsShown({ over: false, since: 500, now: 500 + HOVER_OUT_MS - 10, shown: true, blocked: false })).toEqual({ shown: true, recheckIn: 10 });
    expect(hoverControlsShown({ over: false, since: 500, now: 500 + HOVER_OUT_MS, shown: true, blocked: false })).toEqual({ shown: false, recheckIn: null });
  });

  it("a pointer passing by shows nothing", () => {
    expect(hoverControlsShown({ over: false, since: 0, now: 50, shown: false, blocked: false })).toEqual({ shown: false, recheckIn: null });
  });

  it("a drag, the away badge or the menu hide them at once", () => {
    expect(hoverControlsShown({ over: true, since: 0, now: 10_000, shown: true, blocked: true })).toEqual({ shown: false, recheckIn: null });
    expect(hoverControlsShown({ over: false, since: 0, now: 1, shown: true, blocked: true })).toEqual({ shown: false, recheckIn: null });
  });

  it("a clock that went back counts as no time", () => {
    expect(hoverControlsShown({ over: true, since: 1000, now: 900, shown: false, blocked: false })).toEqual({ shown: false, recheckIn: HOVER_IN_MS });
  });
});

describe("click or drag", () => {
  it("a press that travels DRAG_SLOP px is a drag", () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(2, 2)).toBe(false);
    expect(isDrag(DRAG_SLOP, 0)).toBe(true);
    expect(isDrag(3, 3)).toBe(true);
  });
});

describe("mascotClick", () => {
  const base = { moved: false, menu: false, onCall: false, botAudible: false, gesture: "single" as const };

  it("a plain click on the idle character opens the chat bubble and never starts a call", () => {
    expect(mascotClick(base)).toBe("chat");
    expect(mascotClick(base)).not.toBe("call");
  });

  it("a drag or a long press that opened the menu does nothing else", () => {
    expect(mascotClick({ ...base, moved: true })).toBe("none");
    expect(mascotClick({ ...base, menu: true })).toBe("none");
    expect(mascotClick({ ...base, onCall: true, botAudible: true, moved: true })).toBe("none");
  });

  it("on a call a click never ends it: it cuts the bot's voice while it speaks, else nothing", () => {
    expect(mascotClick({ ...base, onCall: true, botAudible: true })).toBe("interrupt");
    expect(mascotClick({ ...base, onCall: true })).toBe("none");
  });

  it("a double click opens the app", () => {
    expect(mascotClick({ ...base, gesture: "double" })).toBe("open");
    expect(mascotClick({ ...base, onCall: true, gesture: "double" })).toBe("open");
  });
});

describe("the call stays reachable without a click on the character", () => {
  type Props = { "data-control"?: string; onClick?: () => void; children?: ReactNode };
  const find = (node: ReactNode, control: string): ReactElement<Props> | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const child of node) { const hit = find(child, control); if (hit) return hit; }
      return undefined;
    }
    const element = node as ReactElement<Props>;
    if (element.props?.["data-control"] === control) return element;
    return find(element.props?.children, control);
  };
  const lane = { x: 0, y: 0, width: 40, height: 100 };

  it("the hover call button starts the call, and hangs up on a call", () => {
    const events: FloatingEvent[] = [];
    const render = (onCall: boolean) => MascotHoverControls({ lane, side: "right", shown: true, reduced: false, chatOpen: false, trayOpen: false, canCall: true, onCall, onEvent: (event) => events.push(event), hover: () => undefined, name: "Sagax" });
    find(render(false), "voice")?.props.onClick?.();
    find(render(true), "voice")?.props.onClick?.();
    expect(events).toEqual([{ type: "call", action: "start" }, { type: "call", action: "end" }]);
  });

  it("the hover chat button opens the chat and never calls", () => {
    const events: FloatingEvent[] = [];
    find(MascotHoverControls({ lane, side: "right", shown: true, reduced: false, chatOpen: false, trayOpen: false, canCall: true, onCall: false, onEvent: (event) => events.push(event), hover: () => undefined, name: "Sagax" }), "chat")?.props.onClick?.();
    expect(events).toEqual([{ type: "click" }]);
  });

  it("the Control+Option+Space hotkey still starts the call", () => {
    const idle: HotkeyContext = { enabled: true, botId: "ada", canCall: true, callBot: null, muted: false, push: false, talking: false };
    expect(hotkeyAction("tap", idle)).toBe("start");
  });
});
