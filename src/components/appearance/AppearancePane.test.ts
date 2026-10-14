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
import { NOTHING_LOCKED, type AchievementSnapshot } from "../../../shared/achievements";
import { botMascotLook, completeMascotLook, CRAB_SKINS } from "../../../shared/mascot-look";
import { MASCOT_SKIN_IDS } from "../../../shared/mascot-skins";
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

beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));
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

  it("shows locked characters greyed on To unlock, previewed but never worn", async () => {
    enforce([]);
    await mount(makeBot());
    expect(tile("ogre").hasAttribute("data-locked")).toBe(true);
    expect(tile("crab").hasAttribute("data-locked")).toBe(true);
    expect(tile("owl").hasAttribute("data-locked")).toBe(false);
    expect(host.querySelector('[data-mascot-shelf="locked"]')).not.toBeNull();
    // Trombi is an easter egg: out until found
    expect(host.querySelector('[data-character-option="trombi"]')).toBeNull();
    await act(async () => tile("crab").click());
    expect(host.querySelector("[data-mascot-detail]")?.getAttribute("data-mascot-detail")).toBe("crab");
    expect(action().getAttribute("data-mascot-action")).toBe("locked");
    expect(patches).toEqual([]);
  });

  /** Every skin card of the character shown, tab after tab. */
  const allSkinCards = async (attribute: string) => {
    const cards = new Map<string, HTMLButtonElement>();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[data-skin-tabs] [role="tab"]')];
    for (const tab of tabs) {
      await act(async () => tab.click());
      for (const card of host.querySelectorAll<HTMLButtonElement>(`[${attribute}]`)) cards.set(card.getAttribute(attribute)!, card);
    }
    return cards;
  };
  /** Opens the tab holding a skin's card, then clicks it. */
  const clickSkin = async (attribute: string, skin: string) => {
    for (const tab of host.querySelectorAll<HTMLButtonElement>('[data-skin-tabs] [role="tab"]')) {
      await act(async () => tab.click());
      const card = host.querySelector<HTMLButtonElement>(`[${attribute}="${skin}"]`);
      if (card) return act(async () => card.click());
    }
    throw new Error(`no card for ${skin}`);
  };

  it("lists every skin, a locked one with its padlock and how to unlock it, never selectable", async () => {
    enforce([]);
    await mount(makeBot());
    const cards = await allSkinCards("data-mascot-skin-option");
    expect([...cards.keys()].sort()).toEqual([...MASCOT_SKIN_IDS].sort());
    const frost = cards.get("frost")!;
    expect(frost.hasAttribute("data-locked")).toBe(true);
    expect(frost.getAttribute("aria-disabled")).toBe("true");
    expect(frost.querySelector(".unlock-lock svg.lucide-lock")).not.toBeNull();
    expect(frost.getAttribute("title")).toMatch(/Unlock: /);
    expect(frost.getAttribute("aria-label")).toMatch(/^Ice, Rare, locked\. Unlock: /);
    await clickSkin("data-mascot-skin-option", "frost");
    expect(patches).toEqual([]);
    // the Common ones come with the owl
    const snowy = cards.get("snowy")!;
    expect(snowy.hasAttribute("data-locked")).toBe(false);
    expect(snowy.querySelector(".unlock-lock")).toBeNull();
  });

  it("says how to unlock a locked skin in French too", async () => {
    setLocale("fr");
    enforce([]);
    await mount(makeBot());
    const frost = (await allSkinCards("data-mascot-skin-option")).get("frost")!;
    expect(frost.getAttribute("title")).toMatch(/Pour débloquer : /);
    expect(frost.getAttribute("aria-label")).toMatch(/verrouillé\. Pour débloquer : /);
    setLocale("en");
  });

  it("wears an earned skin: its character unlocks, the skin is picked and saved with the bot", async () => {
    // Pearl (Crab) earned, Claude never linked: the crab was hidden, its skin unusable
    enforce(["skin:crab:pearl"]);
    await mount(makeBot());
    expect(tile("crab").hasAttribute("data-locked")).toBe(false);
    await act(async () => tile("crab").click());
    expect(patches).toEqual([{ mascotLook: expect.objectContaining({ character: "crab" }) }]);
    await act(async () => root.render(createElement(MascotLookEditor, { bot: makeBot({ mascotLook: botMascotLook(patches[0]!.mascotLook) }), onPatch: (patch) => patches.push(patch) })));
    const cards = await allSkinCards("data-crab-skin-option");
    expect([...cards.keys()].sort()).toEqual([...CRAB_SKINS].sort());
    expect(cards.get("pearl")!.hasAttribute("data-locked")).toBe(false);
    expect(cards.get("gold")!.hasAttribute("data-locked")).toBe(true);
    await clickSkin("data-crab-skin-option", "gold");
    expect(patches).toHaveLength(1);
    await clickSkin("data-crab-skin-option", "pearl");
    const saved = patches[1]!.mascotLook!;
    expect(saved).toMatchObject({ character: "crab", skins: expect.objectContaining({ crab: "pearl" }) });
    // what is saved is what the bot stores and every avatar draws (BotRecord.mascotLook)
    expect(completeMascotLook(botMascotLook(JSON.parse(JSON.stringify(saved)))).skins.crab).toBe("pearl");
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
