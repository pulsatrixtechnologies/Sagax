// Tailcat stage 1: the panel always shows its section, Prendre le contrôle
// opens the Computer tab in every mode, the card carries every fact and the
// action buttons, and the screen stays read-only.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { formatEndLabel, type RemoteSessionView } from "../../../shared/remote-session";
import { setLocale, t } from "@/lib/i18n";
import { endRemoteControl, remoteControlBot, startRemoteControl } from "@/lib/remote-session-focus";
import { StoreProvider } from "@/state/store";
import { computerTabIsRemoteOnly, visiblePanelTabs } from "../bot-settings/panel-tabs";
import { RemoteSessionCard } from "./RemoteSessionCard";
import { RemoteSessionControl, RemoteSessionScreen } from "./RemoteSessionControl";
import { RemoteSessionsPanel, takeRemoteControl } from "./RemoteSessionsSection";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";

const view: RemoteSessionView = {
  id: "0123456789ab",
  code: "BQDHS7",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: "2026-10-22T00:33:00.000Z",
  hostname: "POSTE-01",
  osName: "Windows Server 2022",
  user: "exemple\\usager",
  model: "PowerEdge R650",
  serial: "SN40",
  cpu: "Intel Xeon Silver",
  ram: "32 Go",
  disk: "200 Go libres sur 500 Go",
  suggestions: [{ id: "rights" }, { id: "cpu" }],
};

describe("tailcat stage 1", () => {
  afterEach(() => {
    endRemoteControl();
    setLocale("en");
  });

  it("shows the Computer tab for a remote session in control, in Simple too", () => {
    expect(visiblePanelTabs({ advanced: false, computerOff: false, remoteControl: false })).toEqual(["details", "library"]);
    expect(visiblePanelTabs({ advanced: false, computerOff: false, remoteControl: true })).toEqual(["details", "library", "computer"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: true, remoteControl: false })).toEqual(["details", "library"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: true, remoteControl: true })).toEqual(["details", "library", "computer"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: false, remoteControl: false })).toEqual(["details", "library", "computer"]);
    expect(computerTabIsRemoteOnly({ advanced: false, computerOff: false })).toBe(true);
    expect(computerTabIsRemoteOnly({ advanced: true, computerOff: true })).toBe(true);
    expect(computerTabIsRemoteOnly({ advanced: true, computerOff: false })).toBe(false);
  });

  it("Prendre le contrôle marks the session in control before it opens the Computer tab", () => {
    const seen: Array<string | null> = [];
    takeRemoteControl("melonie", view.id, () => seen.push(remoteControlBot()));
    expect(seen).toEqual(["melonie"]);
    endRemoteControl();
    expect(remoteControlBot()).toBeNull();
    startRemoteControl("melonie");
    startRemoteControl("melonie");
    expect(remoteControlBot()).toBe("melonie");
  });

  it("the panel row shows computer, user, code and end time, with Prendre le contrôle and a two-step close", () => {
    setLocale("fr");
    const props = { rows: [view], error: null, onTakeControl: () => undefined, onClose: () => undefined };
    const first = renderToStaticMarkup(createElement(RemoteSessionsPanel, { ...props, confirmId: null }));
    for (const part of ["POSTE-01", "exemple\\usager", "BQDHS7", formatEndLabel(view.endAt), "Prendre le contrôle", "Fermer la session"]) {
      expect(first).toContain(part);
    }
    expect(first).toContain('data-remote-close="ask"');
    expect(first).not.toContain("Confirmer la fermeture");
    const second = renderToStaticMarkup(createElement(RemoteSessionsPanel, { ...props, confirmId: view.id }));
    expect(second).toContain('data-remote-close="confirm"');
    expect(second).toContain("Confirmer la fermeture");
    expect(`${first}${second}`).not.toContain(view.id);
    expect(`${first}${second}`).not.toContain(ADDRESS);
  });

  it("the chat card shows every fact (details unfolded) and the actions, never the id or the tunnel", () => {
    setLocale("fr");
    const card = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view: { ...view, hostname: `POSTE-01 ${ADDRESS}` }, detailsOpen: true }),
    ));
    for (const field of ["poste", "user", "rights", "session", "serial", "model", "cpu", "ram", "disk"]) {
      expect(card).toContain(`data-remote-field="${field}"`);
    }
    for (const value of ["POSTE-01", "exemple\\usager", t("remoteSession.rights.standard"), "BQDHS7", "SN40", "PowerEdge R650", "Intel Xeon Silver", "32 Go", "200 Go libres sur 500 Go"]) {
      expect(card).toContain(value);
    }
    expect(card).toContain("data-remote-take-control");
    expect(card).toContain(t("remoteSession.takeControl"));
    expect(card).toContain(t("remoteSession.shell"));
    expect(card).toContain(t("remoteSession.upload"));
    expect(card).toContain(t("remoteSession.download"));
    expect(card).toContain('data-remote-hint="rights"');
    expect(card).not.toContain(view.id);
    expect(card).not.toContain(ADDRESS);
    const elevated = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view: { ...view, elevated: true } }),
    ));
    expect(elevated).toContain(t("remoteSession.rights.admin"));
  });

  it("the Computer tab is a read-only picture, and says so when no session is there", () => {
    const screen = renderToStaticMarkup(createElement(RemoteSessionScreen, { shot: "blob:screen", missed: false }));
    expect(screen).toContain('data-remote-input="none"');
    expect(screen).not.toMatch(/onmouse|tabindex|contenteditable/i);
    // the picture keeps its own proportions: no fixed 16:10 box leaving a dark band under it
    expect(screen).toContain("data-remote-session-shot");
    expect(screen).not.toContain("aspect-[16/10]");
    const empty = renderToStaticMarkup(createElement(StoreProvider, null, createElement(RemoteSessionControl, { botId: "melonie", showEmpty: true })));
    expect(empty).toContain("data-remote-session-control-empty");
    expect(empty).toContain("No remote session is open.");
    expect(renderToStaticMarkup(createElement(StoreProvider, null, createElement(RemoteSessionControl, { botId: "melonie" })))).toBe("");
  });
});
