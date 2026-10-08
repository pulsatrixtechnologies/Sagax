import { describe, expect, it } from "vitest";
import { mascotStage } from "./fit";
import { BALLOON_SCREEN_SHARE, effectLane, effectSide, EFFECT_LANE, placeChat, sideWithin } from "./placement";
import { homeBody } from "./window-frame";
import { balloonSize, BALLOON_MIN } from "./Balloon";
import { CHAT_BALLOON } from "./window-frame";

const STAGE = mascotStage(120);
const OWL = { left: STAGE.left, top: STAGE.top, size: 120 };
const AREA = { x: 0, y: 25, width: 1440, height: 850 };
const SECOND = { x: 1440, y: 0, width: 1920, height: 1040 };
const body = (x: number, y: number) => ({ x, y, width: 120, height: 120 });
const right = AREA.x + AREA.width;
const bottom = AREA.y + AREA.height;

describe("the chat beside the mascot: which side, how much room", () => {
  it("opens above and to the left where there is room, as before", () => {
    const placed = placeChat({ body: body(1100, 700), workArea: AREA, stage: STAGE, owl: OWL });
    expect(placed.side).toEqual({ below: false, right: false });
    expect(placed.shift).toBe(0);
    // the room above the stage, capped at 60 % of the display
    expect(placed.room.h).toBe(Math.round(AREA.height * BALLOON_SCREEN_SHARE));
  });

  it("opens below when the character stands near the top, and to the right near the left edge", () => {
    expect(placeChat({ body: body(AREA.x, AREA.y), workArea: AREA, stage: STAGE, owl: OWL }).side).toEqual({ below: true, right: true });
    expect(placeChat({ body: body(900, AREA.y + 10), workArea: AREA, stage: STAGE, owl: OWL }).side).toEqual({ below: true, right: false });
    expect(placeChat({ body: body(AREA.x, 700), workArea: AREA, stage: STAGE, owl: OWL }).side).toEqual({ below: false, right: true });
    // the bottom-right corner keeps the usual side
    expect(placeChat({ body: body(right - 120, bottom - 120), workArea: AREA, stage: STAGE, owl: OWL }).side).toEqual({ below: false, right: false });
  });

  it("slides the chat back onto the display when the stage hangs off its edge", () => {
    // right at the right edge: the stage's empty margin is past the screen, the chat is not
    const atRight = placeChat({ body: body(right - 120, 600), workArea: AREA, stage: STAGE, owl: OWL });
    const stageRight = right - 120 - OWL.left + STAGE.width;
    expect(atRight.shift).toBe(right - (stageRight + 6));
    expect(atRight.shift).toBeLessThan(0);
    // right at the left edge, the chat to its right: slid right by what hangs off
    const atLeft = placeChat({ body: body(AREA.x, 600), workArea: AREA, stage: STAGE, owl: OWL });
    expect(atLeft.side.right).toBe(true);
    expect(atLeft.shift).toBe(AREA.x - (AREA.x - OWL.left - 6));
  });

  it("grows up to the room on its own display, then scrolls; never less than the least room", () => {
    const short = { x: 0, y: 0, width: 1280, height: 400 };
    const placed = placeChat({ body: body(600, 140), workArea: short, stage: STAGE, owl: OWL });
    // neither side has the quick chat's full height: the larger one, capped at 60 %
    expect(placed.room.h).toBeLessThanOrEqual(Math.round(400 * BALLOON_SCREEN_SHARE));
    expect(placed.room.h).toBeGreaterThanOrEqual(160);
    // on the second display, that display's room
    const there = placeChat({ body: body(SECOND.x + 1500, 800), workArea: SECOND, stage: STAGE, owl: OWL });
    expect(there.side).toEqual({ below: false, right: false });
    expect(there.room.w).toBe(SECOND.x + 1500 - OWL.left + STAGE.width + 6 - SECOND.x);
    // a balloon the person made bigger than the room shrinks to it; a small one keeps its size
    expect(balloonSize({ w: 900, h: 900 }, { w: 500, h: 400 })).toEqual({ width: 500, height: 400, maxWidth: 500, maxHeight: 400 });
    // the quick chat: the width its window holds, as tall as its content up to the quick chat's height
    expect(balloonSize({}, { w: 2000, h: 2000 })).toEqual({ width: CHAT_BALLOON.w, maxWidth: CHAT_BALLOON.w, maxHeight: CHAT_BALLOON.h });
    expect(balloonSize({}, { w: 10, h: 10 })).toEqual({ width: BALLOON_MIN.w, maxWidth: BALLOON_MIN.w, maxHeight: BALLOON_MIN.h });
  });
});

describe("effects beside the mascot, never over it", () => {
  it("go to the side away from the chat when it fits, else the other side, else above", () => {
    expect(effectSide({ body: body(700, 500), workArea: AREA })).toBe("right");
    expect(effectSide({ body: body(700, 500), workArea: AREA, chatSide: { below: false, right: true } })).toBe("left");
    // at the right edge: no room on the right
    expect(effectSide({ body: body(right - 120, 500), workArea: AREA })).toBe("left");
    // at the left edge with the chat on the right: still the free side
    expect(effectSide({ body: body(AREA.x, 500), workArea: AREA, chatSide: { below: false, right: true } })).toBe("right");
    // a display barely wider than the character: above its head
    expect(effectSide({ body: body(0, 500), workArea: { x: 0, y: 0, width: 150, height: 900 } })).toBe("above");
  });

  it("puts the lane outside the character's box, inside the stage's transparent room", () => {
    for (const side of ["left", "right", "above"] as const) {
      const lane = effectLane(side, OWL);
      const overlaps = lane.x < OWL.left + OWL.size && lane.x + lane.width > OWL.left && lane.y < OWL.top + OWL.size && lane.y + lane.height > OWL.top;
      expect(overlaps).toBe(false);
      expect(lane.x).toBeGreaterThanOrEqual(0);
      expect(lane.y).toBeGreaterThanOrEqual(0);
      expect(lane.x + lane.width).toBeLessThanOrEqual(STAGE.width);
    }
    expect(effectLane("right", OWL).width).toBe(EFFECT_LANE);
  });
});

describe("the desktop window's layout from where the character stands", () => {
  it("is the chat's side and room for that spot, nothing before main knows the character's box", async () => {
    const { layoutFor } = await import("./FloatingBotWindow");
    const { chatRoomFor } = await import("./FloatingBotView");
    expect(layoutFor(null)).toBeNull();
    expect(layoutFor({ workArea: AREA })).toBeNull();
    const corner = layoutFor({ workArea: AREA, body: body(AREA.x, AREA.y) })!;
    expect(corner.side).toEqual({ below: true, right: true });
    // the chat to its right and no room to its left: the effects share the right, above the chat (they sit beside the head)
    expect(corner.fx).toBe("right");
    expect(layoutFor({ workArea: AREA, body: body(800, 600) })!.fx).toBe("right");
    expect(layoutFor({ workArea: AREA, body: body(right - 120, 600) })!.fx).toBe("left");
    // the balloon may be dragged away by what the room leaves past the quick chat
    const room = chatRoomFor(corner.chat!);
    expect(room).toEqual({ x: room.w - CHAT_BALLOON.w, y: room.h - CHAT_BALLOON.h, w: corner.chat!.room.w, h: corner.chat!.room.h });
    expect(chatRoomFor({ side: { below: false, right: false }, room: { w: 100, h: 100 }, shift: 0 })).toMatchObject({ x: 0, y: 0 });
  });
});

describe("next to a neighbouring display (macOS)", () => {
  const size = { width: 352, height: 716 };
  const home = (side: { below: boolean; right: boolean }) => homeBody(STAGE, OWL, size, side);

  it("opens the window's room away from the seam, so the character can stand right at it", () => {
    // the character at the left edge of a display whose left neighbour limits the window to 63 px past the seam
    const seamX = 3440;
    const limits = { left: seamX - 63 };
    const at = body(seamX, 600);
    expect(sideWithin({ side: { below: false, right: false }, body: at, homeBody: home, size, limits })).toEqual({ right: true });
    // already opening to the right: nothing to force
    expect(sideWithin({ side: { below: false, right: true }, body: at, homeBody: home, size, limits })).toEqual({});
    // a limit above (a display on top): the room opens below
    expect(sideWithin({ side: { below: false, right: false }, body: body(1200, 30), homeBody: home, size, limits: { top: -63 } })).toEqual({ below: true });
    // no limits (Windows, Linux, a free edge): the rule of the room on screen alone
    expect(sideWithin({ side: { below: false, right: false }, body: at, homeBody: home, size, limits: null })).toEqual({});
    // forced, the chat's room is that side's
    const forced = placeChat({ body: body(seamX + 200, 600), workArea: { x: seamX, y: 188, width: 1800, height: 1130 }, stage: STAGE, owl: OWL, force: { right: true } });
    expect(forced.side.right).toBe(true);
  });

  it("lets the layout use them: the room flips off the seam", async () => {
    const { layoutFor } = await import("./FloatingBotWindow");
    const area = { x: 3440, y: 188, width: 1800, height: 1130 };
    const layout = layoutFor({ workArea: area, body: body(3554, 900), bounds: { x: 3377, y: 365, width: 352, height: 716 }, limits: { left: 3440 - 63 } })!;
    expect(layout.side).toEqual({ below: false, right: true });
  });
});

describe("held at a seam", () => {
  it("turns the room away when main holds the window right at the limit, so the next drag reaches the seam", () => {
    const size = { width: 400, height: 716 };
    const home = (side: { below: boolean; right: boolean }) => homeBody(STAGE, OWL, size, side);
    const limit = 3440 - Math.floor(400 * 0.18);
    // the window pinned at the limit: its room opens to the right now
    const pinnedX = limit + home({ below: false, right: false }).x;
    expect(sideWithin({ side: { below: false, right: false }, body: body(pinnedX, 600), homeBody: home, size, limits: { left: limit } })).toEqual({ right: true });
    // well clear of it: nothing changes
    expect(sideWithin({ side: { below: false, right: false }, body: body(pinnedX + 40, 600), homeBody: home, size, limits: { left: limit } })).toEqual({});
  });
});
