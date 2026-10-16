import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TerminalRequestCardData } from "../../../shared/terminal-request";
import { OptionCard } from "../OptionCard";
import { t } from "@/lib/i18n";
import { StoreProvider, type Message } from "@/state/store";
import { terminalAnswerPick, terminalDestinationKey, terminalDestinationLabel } from "./TerminalDestinationPicker";

const request: TerminalRequestCardData = {
  requestId: "req-1",
  resourceId: "mine",
  provider: "sandbox",
  label: "Ordinateur infonuagique",
  hostLabel: "Environnement serveur",
  reason: "Déboguer en direct",
  botId: "atlas",
  threadId: "t-1",
  destinations: [
    { resourceId: "mine", provider: "sandbox", label: "Ordinateur infonuagique", hostLabel: "Environnement serveur" },
    { resourceId: "mine", provider: "desktop", label: "Cet ordinateur", hostLabel: "MacBook de JC" },
    { resourceId: "default", provider: "unraid", label: "Serveur unRAID", hostLabel: "fs01" },
  ],
};

describe("terminal card destination", () => {
  it("opens the bot's destination unless the person picked another one the card offered", () => {
    expect(terminalAnswerPick(request, "", "Ouvrir un terminal")).toEqual({ provider: "sandbox", resourceId: "mine" });
    expect(terminalAnswerPick(request, "desktop:mine", "Ouvrir un terminal")).toEqual({ provider: "desktop", resourceId: "mine" });
    expect(terminalAnswerPick(request, "unraid:default", "Ouvrir un terminal")).toEqual({ provider: "unraid", resourceId: "default" });
    // Not offered on the card: nothing is sent, the server keeps the bot's.
    expect(terminalAnswerPick(request, "ssh:other", "Ouvrir un terminal")).toBeUndefined();
    // A refusal opens nothing.
    expect(terminalAnswerPick(request, "desktop:mine", "Refuser")).toBeUndefined();
  });

  it("names the person's own environments in the app's language and a server host by its name", () => {
    expect(terminalDestinationLabel(request.destinations![0]!)).toBe(`${t("terminal.destination.sandbox")} · Environnement serveur`);
    expect(terminalDestinationLabel(request.destinations![1]!)).toBe(`${t("terminal.destination.desktop")} · MacBook de JC`);
    expect(terminalDestinationLabel(request.destinations![2]!)).toBe("Serveur unRAID · fs01");
    expect(terminalDestinationKey(request)).toBe("sandbox:mine");
  });

  it("shows the bot's choice selected and every other destination on the open card, and nothing once answered", () => {
    const message: Message = {
      id: "card", role: "bot", kind: "options", at: 1,
      card: { title: "Ouvrir un terminal sur Environnement serveur", subtitle: request.reason, options: ["Ouvrir un terminal", "Refuser"], requestId: "req-1", tool: "shell_terminal", terminalRequest: request },
    };
    const render = (row: Message) => renderToStaticMarkup(createElement(StoreProvider, null, createElement(OptionCard, { botId: "atlas", threadId: "t-1", message: row })));
    const open = render(message);
    expect(open).toContain("data-terminal-destination");
    expect(open.match(/<option /g)).toHaveLength(3);
    expect(open).toMatch(/<option value="sandbox:mine" selected="">/);
    expect(open).toContain(t("terminal.card.title", { destination: terminalDestinationLabel(request.destinations![0]!) }));
    const answered = render({ ...message, card: { ...message.card!, answered: "allow" } });
    expect(answered).not.toContain("data-terminal-destination");
    // One destination: no menu to show.
    const single = render({ ...message, card: { ...message.card!, terminalRequest: { ...request, destinations: request.destinations!.slice(0, 1) } } });
    expect(single).not.toContain("data-terminal-destination");
  });
});
