// The Computer tab's machine menu: the chosen machine while closed, and every
// machine (icon, full name, power) while open. French uses the Québec words.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Globe, Laptop, Server } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ScreenPicker, type ScreenPickerItem } from "./ComputerMenu";

const items: ScreenPickerItem[] = [
  { key: "server", label: "Cloud", icon: Server, here: true, status: "off" },
  { key: "desktop:mbp", label: "Jean-Christophes-MacBook-Pro", icon: Laptop, status: "on" },
  { key: "browser", label: "Browser", icon: Globe },
];

const markup = (open: boolean, chosen = "server") =>
  renderToStaticMarkup(createElement(ScreenPicker, { items, chosen, onPick: () => {}, initiallyOpen: open }));

afterEach(() => setLocale("en"));

describe("the computer menu", () => {
  it("shows the chosen machine closed, and keeps the other names available", () => {
    const html = markup(false);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-computer-choice="server"');
    expect(html).toContain('data-computer-options="server desktop:mbp browser"');
    expect(html).toContain(">Cloud<");
    expect(html).toContain(">Works here<");
    expect(html).toContain('data-computer-power="off"');
    expect(html).toContain(">Off<");
    expect(html).toContain('title="Cloud: this bot works here"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain("Jean-Christophes-MacBook-Pro");
    expect(html).not.toContain("max-w-[132px]");
    expect(html).not.toContain("truncate");
  });

  it("lists every machine open, with its full name and its power", () => {
    const html = markup(true);
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Show the screen of"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("popover-surface");
    expect(html).toContain(">Cloud<");
    expect(html).toContain("Jean-Christophes-MacBook-Pro");
    expect(html).toContain(">Browser<");
    expect(html).toContain('data-computer-power="off"');
    expect(html).toContain('data-computer-power="on"');
    expect(html).toContain(">Off<");
    expect(html).toContain(">On<");
    expect(html).toContain('data-computer-choice="browser"');
    const browser = html.slice(html.indexOf('data-computer-choice="browser"'));
    expect(browser).not.toContain("data-computer-power");
    expect(html).not.toContain("truncate");
  });

  it("uses the Québec words for power and for where the bot works", () => {
    setLocale("fr");
    const french: ScreenPickerItem[] = [
      { key: "server", label: "Infonuagique", icon: Server, here: true, status: "off" },
      { key: "desktop:mbp", label: "Jean-Christophes-MacBook-Pro", icon: Laptop, status: "on" },
      { key: "browser", label: "Navigateur", icon: Globe },
    ];
    const html = renderToStaticMarkup(createElement(ScreenPicker, {
      items: french, chosen: "server", onPick: () => {}, initiallyOpen: true,
    }));
    expect(html).toContain("Infonuagique");
    expect(html).toContain("Jean-Christophes-MacBook-Pro");
    expect(html).toContain("Navigateur");
    expect(html).toContain("Éteint");
    expect(html).toContain("Allumé");
    expect(html).toContain("Travaille ici");
    expect(html).toContain("Afficher l’écran de");
    expect(html).not.toContain(">Off<");
    expect(html).not.toContain(">On<");
    expect(html).not.toContain(">Running<");
    expect(html).not.toContain("Online");
    expect(html).not.toContain(">Cloud<");
    expect(html).not.toContain(">Browser<");
  });
});
