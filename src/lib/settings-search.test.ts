// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { applySettingsSearch, clearSettingsSearch, focusSettingsSearchLabel, settingsSearchLabels, settingsTextMatches } from "./settings-search";

function page(): HTMLElement {
  const pane = document.createElement("div");
  pane.innerHTML = `
    <h2>Appearance</h2>
    <div>
      <section data-settings-group="interface">
        <div><h3>Interface</h3></div>
        <div>
          <div data-settings-row="advancedMode" role="group" aria-labelledby="advanced">
            <div id="advanced">Advanced mode</div>
          </div>
          <div data-settings-row="font" role="group" aria-labelledby="font">
            <div id="font">Interface font</div>
          </div>
        </div>
      </section>
      <section data-settings-group="desktop">
        <div><h3>Desktop</h3></div>
        <div>
          <div data-settings-row="appIcon" role="group" aria-labelledby="appIcon" data-settings-keywords="dock taskbar">
            <div id="appIcon">App icon</div>
          </div>
          <div data-settings-row="mascots" role="group" aria-labelledby="mascots">
            <div id="mascots">Desktop mascots</div>
            <div>
              <div data-settings-row="fly" role="group" aria-labelledby="fly"><div id="fly">Fly away during tasks</div></div>
              <div data-settings-row="bark" role="group" aria-labelledby="bark"><div id="bark">Bark</div></div>
            </div>
          </div>
        </div>
      </section>
      <section data-settings-group="skin">
        <div><h3>Skin</h3></div>
        <div data-settings-card="appearance.skin">Family, variant, mode</div>
      </section>
    </div>
  `;
  document.body.append(pane);
  return pane;
}

describe("settingsTextMatches", () => {
  it("folds accents and case", () => {
    expect(settingsTextMatches("Icône de l'application", "icon")).toBe(true);
    expect(settingsTextMatches("App icon", "ICON")).toBe(true);
    expect(settingsTextMatches("Interface font", "icon")).toBe(false);
  });
});

describe("applySettingsSearch", () => {
  it("keeps the matching row and its group, and marks that row", () => {
    const pane = page();
    const hit = applySettingsSearch(pane, "Icon");
    expect(pane.hasAttribute("data-settings-filtering")).toBe(true);
    expect(hit?.getAttribute("data-settings-row")).toBe("appIcon");
    expect(hit?.hasAttribute("data-settings-search-hit")).toBe(true);
    expect(pane.querySelector("[data-settings-group='interface']")?.hasAttribute("data-settings-search-miss")).toBe(true);
    expect(pane.querySelector("[data-settings-row='font']")?.hasAttribute("data-settings-search-miss")).toBe(true);
    expect(pane.querySelector("[data-settings-group='desktop']")?.hasAttribute("data-settings-search-miss")).toBe(false);
    expect(pane.querySelector("[data-settings-group='desktop'] h3")?.textContent).toBe("Desktop");
    expect(settingsSearchLabels(pane)).toEqual(["App icon"]);
  });

  it("matches a row's search words when the label does not say them", () => {
    const pane = page();
    const hit = applySettingsSearch(pane, "taskbar");
    expect(hit?.getAttribute("data-settings-row")).toBe("appIcon");
    expect(settingsSearchLabels(pane)).toEqual(["App icon"]);
  });

  it("keeps a row that holds a nested match", () => {
    const pane = page();
    const hit = applySettingsSearch(pane, "fly");
    expect(hit?.getAttribute("data-settings-row")).toBe("fly");
    const parent = pane.querySelector("[data-settings-row='mascots']");
    expect(parent?.hasAttribute("data-settings-search-miss")).toBe(false);
    expect(pane.querySelector("[data-settings-row='bark']")?.hasAttribute("data-settings-search-miss")).toBe(true);
    expect(pane.querySelector("[data-settings-row='appIcon']")?.hasAttribute("data-settings-search-miss")).toBe(true);
  });

  it("keeps a whole group when its heading matches", () => {
    const pane = page();
    applySettingsSearch(pane, "Desktop");
    expect(pane.querySelector("[data-settings-group='desktop']")?.hasAttribute("data-settings-search-miss")).toBe(false);
    expect(pane.querySelector("[data-settings-row='appIcon']")?.hasAttribute("data-settings-search-match")).toBe(true);
    expect(pane.querySelector("[data-settings-row='mascots']")?.hasAttribute("data-settings-search-match")).toBe(true);
    expect(pane.querySelector("[data-settings-group='interface']")?.hasAttribute("data-settings-search-miss")).toBe(true);
    expect(settingsSearchLabels(pane)).toContain("App icon");
    expect(settingsSearchLabels(pane)).toContain("Desktop mascots");
  });

  it("leaves the page alone when no drawn row matches", () => {
    const pane = page();
    expect(applySettingsSearch(pane, "zzzz-not-a-setting")).toBeNull();
    expect(pane.hasAttribute("data-settings-filtering")).toBe(false);
    expect(pane.querySelectorAll("[data-settings-search-miss]")).toHaveLength(0);
  });

  it("clears the filter when the query is empty", () => {
    const pane = page();
    applySettingsSearch(pane, "Icon");
    clearSettingsSearch(pane);
    expect(pane.hasAttribute("data-settings-filtering")).toBe(false);
    expect(pane.querySelector("[data-settings-search-hit]")).toBeNull();
    expect(applySettingsSearch(pane, "  ")).toBeNull();
  });

  it("moves the highlight onto the row a person names", () => {
    const pane = page();
    applySettingsSearch(pane, "Desktop");
    focusSettingsSearchLabel(pane, "Desktop mascots");
    expect(pane.querySelector("[data-settings-search-hit]")?.getAttribute("data-settings-row")).toBe("mascots");
  });
});
