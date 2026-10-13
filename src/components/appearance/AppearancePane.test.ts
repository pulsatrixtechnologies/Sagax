// The persona editor's Appearance: the source control (Mascot, Generate,
// Upload) and Reset, the picture sources, and the Mascot gallery with its
// detail column (MascotLookEditor), clicked through in a happy-dom window
// installed by hand (src/testing/happy-window.ts).
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHappyWindow } from "@/testing/happy-window";
import { MAUS_COLOR_NAMES } from "@/lib/mascot";
import { setLocale } from "@/lib/i18n";
import { resetAchievementsForTests } from "@/lib/achievements";
import { StoreProvider, type Bot } from "@/state/store";
import type { AchievementSnapshot } from "../../../shared/achievements";
import { botMascotLook } from "../../../shared/mascot-look";
import MascotLookEditor, { type MascotLookPatch } from "../floating-bots/MascotLookEditor";
import { AppearancePane, initialAppearanceMode } from "./AppearancePane";

const closeWindow = installHappyWindow();
const { createRoot } = await import("react-dom/client");

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Maus",
    title: "Maus",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

const renderPane = (bot: Bot) => renderToStaticMarkup(createElement(StoreProvider, null, createElement(AppearancePane, { bot, onPatch: vi.fn() })));
const renderEditor = (bot: Bot) => renderToStaticMarkup(createElement(MascotLookEditor, { bot, onPatch: vi.fn() }));
const enforce = (rewards: string[]) => resetAchievementsForTests({ status: "ready", snapshot: { rewards, items: [] } as unknown as AchievementSnapshot });

afterEach(() => resetAchievementsForTests());
afterAll(() => closeWindow());

describe("the Appearance pane", () => {
  it("offers Mascot, Generate and Upload as tabs, Reset on the right", () => {
    const html = renderPane(makeBot());
    expect([...html.matchAll(/data-appearance-mode="(\w+)"/g)].map((match) => match[1])).toEqual(["mascot", "generate", "upload"]);
    expect(html).toContain('role="tablist" aria-label="Avatar source"');
    expect(html).toMatch(/aria-selected="true"[^>]*data-appearance-mode="mascot"/);
    expect(html).toMatch(/data-appearance-reset=""[^>]*>Reset</);
    // a size container: the gallery lays itself out on the pane's width, not the window's
    expect(html).toContain('class="@container" data-appearance-pane=""');
  });

  it("opens a custom picture on Upload, with its zoom and framing", () => {
    expect(initialAppearanceMode({ avatarCrop: "circle", avatarUrl: "/api/attachments/cat.webp" })).toBe("upload");
    expect(initialAppearanceMode({ avatarCrop: "mascot", avatarUrl: "/api/attachments/cat.webp" })).toBe("mascot");
    expect(initialAppearanceMode({})).toBe("mascot");
    const markup = renderPane(makeBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle", avatarZoom: 1.5 }));
    expect(markup).toMatch(/aria-selected="true"[^>]*data-appearance-mode="upload"/);
    expect(markup).toContain('aria-label="Zoom avatar"');
    expect(markup).toContain("Drag the picture to reposition it");
    expect(markup).toContain("150%");
    expect(markup).toContain("Reset framing");
  });

  it("hides zoom controls for the mascot", () => {
    expect(renderPane(makeBot())).not.toContain('aria-label="Zoom avatar"');
  });
});

describe("the Mascot gallery", () => {
  it("still offers every bot color for the mascot, on its palette's tab", () => {
    for (const color of MAUS_COLOR_NAMES) {
      expect(renderEditor(makeBot({ color }))).toMatch(new RegExp(`aria-checked="true"[^>]*aria-label="Use ${color} mascot color"`));
    }
  });

  it("offers every skin with a live preview, by rarity, Classic chosen by default", () => {
    const markup = renderEditor(makeBot());
    expect(markup).toContain(">Skin<");
    for (const skin of ["none", "snowy", "barn", "carbon"]) expect(markup).toContain(`data-mascot-skin-option="${skin}"`);
    expect(markup).toContain('aria-checked="true" aria-label="Classic, Common"');
    expect(markup).toContain('aria-checked="false" aria-label="Snowy, Common"');
    const epic = renderEditor(makeBot({ mascotSkin: "lightning" }));
    expect(epic).toContain('aria-checked="true" aria-label="Lightning, Epic"');
    expect(epic).toMatch(/data-owl-skin="lightning" data-owl-fx="live"/);
    // SAFETY: a skin this build does not know can arrive from a newer client.
    expect(renderEditor(makeBot({ mascotSkin: "plasma" as Bot["mascotSkin"] }))).toContain('aria-checked="true" aria-label="Classic, Common"');
  });

  it("offers every wing move as a chip with a readable label", () => {
    const markup = renderEditor(makeBot());
    expect(markup).toContain(">Moves<");
    for (const [move, label] of [["spread-wings", "Spread wings"], ["flap", "Flap"], ["take-off", "Take off"], ["shake", "Ruffle"], ["hoot", "Hoot"]]) {
      expect(markup).toContain(`data-character-move="${move}"`);
      expect(markup).toContain(`aria-label="Play the ${label} move"`);
    }
  });

  it("offers black among the colors, outlined so it reads on a dark card", () => {
    const markup = renderEditor(makeBot({ color: "black" }));
    expect(markup).toMatch(/aria-label="Use black mascot color"/);
    expect(markup).toContain("inset 0 0 0 1.5px");
  });

  it("searches nine mascots, filters by chip, and shows each tile with its name and family", () => {
    const html = renderEditor(makeBot());
    expect(html).toContain('placeholder="Search 9 mascots"');
    expect([...html.matchAll(/data-mascot-filter="([\w:]+)"/g)].map((match) => match[1])).toEqual(["all", "owned", "family:classics", "family:shapes", "family:animals"]);
    expect(html).toMatch(/aria-pressed="true" data-mascot-filter="all"/);
    expect(html).toContain(">Classics<");
    expect(html).toContain(">Animals<");
    // nothing locked: every character is the bot's to wear, the owl in use and shown
    expect(html).toContain('data-mascot-shelf="yours"');
    expect(html).not.toContain('data-mascot-shelf="locked"');
    expect(html).toContain('>9 of 9<');
    expect(html).toMatch(/data-character-option="owl" data-in-use="" aria-pressed="true" aria-label="Owl, in use"/);
    expect(html).toContain('data-mascot-action="in-use"');
    expect(html).toContain(">In use<");
  });

  it("names the shown character's family and moves under its stage", () => {
    const html = renderEditor(makeBot({ mascotLook: botMascotLook({ character: "frog" }) }));
    expect(html).toContain('data-mascot-detail="frog"');
    expect(html).toContain('aria-label="Frog preview"');
    expect(html).toMatch(/Animals · \d+ moves/);
  });
});

describe("picking in the gallery", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let patches: MascotLookPatch[];

  beforeEach(() => {
    setLocale("en");
    patches = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const mount = async (bot: Bot) => {
    const onOwlMove = vi.fn();
    await act(async () => root.render(createElement(MascotLookEditor, { bot, onPatch: (patch) => patches.push(patch), onOwlMove })));
    return onOwlMove;
  };
  const tile = (id: string) => host.querySelector<HTMLButtonElement>(`[data-character-option="${id}"]`)!;
  const action = () => host.querySelector<HTMLButtonElement>("[data-mascot-action]")!;

  it("saves an unlocked character at once, as the popover did", async () => {
    await mount(makeBot());
    await act(async () => tile("frog").click());
    expect(patches).toEqual([{ mascotLook: expect.objectContaining({ character: "frog" }) }]);
    expect(host.querySelector("[data-mascot-detail]")?.getAttribute("data-mascot-detail")).toBe("frog");
    expect(tile("frog").getAttribute("aria-pressed")).toBe("true");
  });

  it("hides locked characters from the gallery", async () => {
    enforce([]);
    await mount(makeBot());
    expect(host.querySelector('[data-character-option="ogre"]')).toBeNull();
    expect(host.querySelector('[data-character-option="crab"]')).toBeNull();
    expect(host.querySelector('[data-character-option="owl"]')).not.toBeNull();
    expect(host.querySelector('[data-mascot-shelf="locked"]')).toBeNull();
    expect(host.querySelector('[data-mascot-filter="locked"]')).toBeNull();
    expect(patches).toEqual([]);
    expect(action().getAttribute("data-mascot-action")).toBe("in-use");
  });

  it("narrows the tiles by chip and by search, and says when nothing matches", async () => {
    enforce([]);
    await mount(makeBot());
    const shown = () => [...host.querySelectorAll("[data-character-option]")].map((element) => element.getAttribute("data-character-option"));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="family:classics"]')!.click());
    expect(shown()).toEqual(["owl"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="owned"]')!.click());
    expect(shown()).toEqual(["owl"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="all"]')!.click());
    const search = host.querySelector<HTMLInputElement>("[data-mascot-search]")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(search), "value")!.set!;
      setValue.call(search, "zzz");
      search.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    });
    expect(shown()).toEqual([]);
    expect(host.querySelector("[data-mascot-empty]")?.textContent).toBe("No mascot matches “zzz”.");
  });

  it("plays a wing move on the stage and across the app", async () => {
    const onOwlMove = await mount(makeBot());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-character-move="flap"]')!.click());
    expect(onOwlMove).toHaveBeenCalledWith("flap");
    expect(patches).toEqual([]);
  });
});
