import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BotAvatar,
  MausAvatar,
  resolveBotAvatarOutcome,
  type BotAvatarProps,
  type MausAvatarProps,
} from "./Avatar";
import { MAUS_COLORS } from "@/lib/mascot";
import { OWL_WHITE_PALETTE, gazeToOffset, owlPose, poseTransforms } from "@/lib/owl/owl-art";
import { runningOwlCount } from "@/lib/owl/owl-loop";

const render = (props: Partial<MausAvatarProps>) =>
  renderToStaticMarkup(createElement(MausAvatar, { color: "green", animated: false, ...props }));

const renderBot = (bot: Partial<BotAvatarProps["bot"]>) =>
  renderToStaticMarkup(
    createElement(BotAvatar, { bot: { color: "green", ...bot }, animated: false }),
  );

describe("MausAvatar", () => {
  it("renders the owl for every body id, including unknown ones", () => {
    const plain = render({});
    expect(plain).toContain('data-part="eyes"');
    expect(render({ bodyId: "star" })).toBe(plain);
    // SAFETY: "hexagram" is deliberately not a valid MascotBodyId: stored or
    // streamed data may carry one, and the owl must ignore it the same way.
    expect(render({ bodyId: "hexagram" as MausAvatarProps["bodyId"] })).toBe(plain);
  });

  it("paints the plumage in the bot's own color, one flat tone, never a gradient", () => {
    const markup = render({});
    expect(markup).not.toContain("Gradient");
    expect(markup).not.toContain("<stop");
    const body = markup.slice(markup.indexOf('data-part="body"'));
    expect(body).toMatch(new RegExp(`^data-part="body"><path fill="${MAUS_COLORS.green}"`));
  });

  it("keeps the white bot on its own light palette", () => {
    const markup = render({ color: "white" });
    expect(markup).toContain(`fill="${OWL_WHITE_PALETTE.plumage}"`);
    expect(markup).not.toContain(`fill="${MAUS_COLORS.white}"`);
  });

  it("draws a still owl when animated=false: the state's resting pose, no loop", () => {
    const sleepy = render({ state: "sleeping", size: 72 });
    const pose = owlPose("sleepy", 0);
    expect(sleepy).toContain(`transform:${poseTransforms(pose, gazeToOffset(pose.gaze)).lids}`);
    // a one-shot state rests as idle when still
    const idle = owlPose("idle", 0);
    expect(render({ state: "happy", size: 72 })).toContain(
      `transform:${poseTransforms(idle, gazeToOffset(idle.gaze)).rig}`,
    );
    expect(runningOwlCount()).toBe(0);
  });

  it("wears the bot's stored skin, and none for an unknown one", () => {
    expect(renderBot({ mascotSkin: "gold" })).toContain('data-owl-skin="gold"');
    // SAFETY: a newer client may store a skin this build does not know.
    expect(renderBot({ mascotSkin: "plasma" as BotAvatarProps["bot"]["mascotSkin"] })).not.toContain("data-owl-skin");
  });

  it("renders the black bot with its rim", () => {
    expect(render({ color: "black", size: 72 })).toContain('data-part="rim"');
  });

  it("uses the label as the owl's accessible name", () => {
    expect(render({ label: "Atlas" })).toContain('aria-label="Atlas"');
  });
});

describe("BotAvatar's two avatar outcomes", () => {
  it("zooms and positions a custom image inside its crop", () => {
    const markup = renderBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 2,
      avatarFocusX: 0.25,
      avatarFocusY: 0.75,
    });
    expect(markup).toContain("scale(2)");
    expect(markup).toContain("25% 75%");
  });

  it("renders a flat cropped image for circle/rounded/square, with no mascot at all", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
  });

  it("shows the image as it is, with no mascot face painted on it", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "square" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<image");
    expect(markup).not.toContain("radialGradient");
    expect(markup).not.toContain("data-owl");
  });

  it("renders the gradient mascot when the crop is mascot, image or not", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "mascot" });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("<svg");
  });

  it("falls back to the gradient mascot when a flat crop has no valid image", () => {
    const markup = renderBot({ avatarUrl: undefined, avatarCrop: "circle" });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("<svg");
  });
});

describe("resolveBotAvatarOutcome", () => {
  // `imageFailed` is set by the flat <img>'s own onError, which
  // renderToStaticMarkup never fires — there are no events in a static
  // render. The decision is a pure function precisely so this branch is
  // still testable synchronously.
  it("falls back to the gradient mascot for an image that failed to load", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "circle", hasUrl: true, imageFailed: true }),
    ).toBe("gradientMascot");
  });

  it("renders a good flat image flat", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "rounded", hasUrl: true, imageFailed: false }),
    ).toBe("flatImage");
  });

  it("keeps the mascot crop on the gradient mascot even with a loaded image", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "mascot", hasUrl: true, imageFailed: false }),
    ).toBe("gradientMascot");
  });

  it("falls back to the gradient mascot when there is no image at all", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "square", hasUrl: false, imageFailed: false }),
    ).toBe("gradientMascot");
  });
});
