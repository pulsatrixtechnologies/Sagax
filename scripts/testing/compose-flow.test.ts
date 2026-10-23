// The catalogue no longer has a sidebar "Browse Bots" button. These cases
// lock the snapshot decisions openTemplatesCatalog makes without a browser.
import { describe, expect, it } from "vitest";
import { catalogTemplateTools, nestedTemplatesCatalog, openTemplatesCatalog, type CatalogFlow } from "./compose-flow.ts";

const HOME = [
  'button "Back"',
  'heading "Browse Bots"',
  'button "Import"',
  'button "Share a team"',
].join("\n");

function flow(pages: string[]): { flow: CatalogFlow; clicks: string[] } {
  const clicks: string[] = [];
  let index = 0;
  return {
    clicks,
    flow: {
      flag: async () => {},
      snapshot: async () => pages[Math.min(index, pages.length - 1)] ?? "",
      click: async (name) => {
        clicks.push(name);
        index += 1;
      },
    },
  };
}

describe("openTemplatesCatalog", () => {
  it("treats the hosted home as ready even though its Back returns to Connect apps", () => {
    expect(catalogTemplateTools(HOME)).toBe(true);
    expect(nestedTemplatesCatalog(HOME)).toBe(false);
  });

  it("walks Back only from View all or a detail, where the heading is no longer Browse Bots", () => {
    const viewAll = ['button "Back"', 'heading "Templates"', "Browse Bots"].join("\n");
    expect(nestedTemplatesCatalog(viewAll)).toBe(true);
    expect(nestedTemplatesCatalog(HOME)).toBe(false);
    expect(nestedTemplatesCatalog('heading "Connect Apps"\nbutton "Bot templates"')).toBe(false);
  });

  it("opens Connect apps, then Bot templates, and stops once Import and Share a team show", async () => {
    const { flow: catalog, clicks } = flow([
      'button "Connect apps"',
      'heading "Connect Apps"\nbutton "Bot templates"',
      HOME,
    ]);
    await openTemplatesCatalog(catalog);
    expect(clicks).toEqual(["Connect apps", "Bot templates"]);
  });

  it("leaves the hosted home's Back alone", async () => {
    const { flow: catalog, clicks } = flow([HOME]);
    await openTemplatesCatalog(catalog);
    expect(clicks).toEqual([]);
  });

  it("steps Back from a detail until the template tools show", async () => {
    const { flow: catalog, clicks } = flow([
      'button "Back"\nheading "From Customer Co"\nBrowse Bots',
      HOME,
    ]);
    await openTemplatesCatalog(catalog);
    expect(clicks).toEqual(["Back"]);
  });
});
