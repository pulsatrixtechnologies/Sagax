// The Perspicax Profiles section of bot settings (slice 5): which profiles the
// editor shows, the ones not held, the refusal messages, the section rail.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { BOT_SECTIONS } from "./sections";
import { isMoreSection } from "./panel-tabs";
import { PerspicaxSection, perspicaxErrorKey, perspicaxRows, type PerspicaxAnswer } from "./PerspicaxSection";

const DISPATCH = { id: "P1", slug: "dispatch", name: "Dispatch", description: "Tickets" };
const BILLING = { id: "P2", slug: "billing", name: "Billing", description: "" };
const SALES = { id: "P3", slug: "sales", name: "Sales", description: "" };

describe("PerspicaxSection rows", () => {
  it("lists the profiles the viewer holds, then selected ones they do not hold, checked and disabled", () => {
    const answer: PerspicaxAnswer = {
      selected: [{ ...DISPATCH, heldByMe: true }, { ...SALES, heldByMe: false }],
      available: [DISPATCH, BILLING],
      canEdit: true,
    };
    expect(perspicaxRows(answer, ["P1", "P3"])).toEqual([
      { profile: DISPATCH, checked: true, notHeld: false, disabled: false },
      { profile: BILLING, checked: false, notHeld: false, disabled: false },
      { profile: SALES, checked: true, notHeld: true, disabled: true },
    ]);
    // removed from the draft: still listed, unchecked, until saved
    expect(perspicaxRows(answer, ["P1"]).at(-1)).toMatchObject({ profile: SALES, checked: false, notHeld: true });
  });

  it("a viewer who may only use the bot sees every box disabled", () => {
    const rows = perspicaxRows({ selected: [{ ...DISPATCH, heldByMe: true }], available: [DISPATCH], canEdit: false }, ["P1"]);
    expect(rows.every((row) => row.disabled)).toBe(true);
    expect(perspicaxRows({ selected: [], available: [], canEdit: true }, [])).toEqual([]);
  });

  it("names each refusal, and anything else as a failed save", () => {
    expect(perspicaxErrorKey("profile_not_held")).toBe("botSettings.perspicax.error.profile_not_held");
    expect(perspicaxErrorKey("needs_edit")).toBe("botSettings.perspicax.error.needs_edit");
    expect(perspicaxErrorKey("unknown_profile")).toBe("botSettings.perspicax.error.unknown_profile");
    expect(perspicaxErrorKey(undefined)).toBe("botSettings.perspicax.error.failed");
  });

  it("renders a loading line until the server answers", () => {
    const html = renderToStaticMarkup(createElement(PerspicaxSection, { bot: { id: "bot-1" } }));
    expect(html).toContain(en["botSettings.perspicax.loading"]);
  });

  it("is an Advanced section, labelled in English and Quebec French", () => {
    const entry = BOT_SECTIONS.find((section) => section.id === "perspicax");
    expect(entry?.labelKey).toBe("botSettings.perspicax.title");
    expect(isMoreSection("perspicax")).toBe(true);
    expect(en["botSettings.perspicax.title"]).toBe("Perspicax Profiles");
    expect(fr["botSettings.perspicax.title"]).toBe("Profils Perspicax");
    expect(fr["botSettings.perspicax.notHeld"]).toBe("Vous ne détenez pas ce profil");
    for (const key of Object.keys(en).filter((name) => name.startsWith("botSettings.perspicax."))) {
      expect(fr, key).toHaveProperty([key]);
    }
  });
});
