import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatEndLabel, type RemoteSessionView } from "../../../shared/remote-session";
import { t } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { RemoteSessionCard } from "./RemoteSessionCard";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";

const view: RemoteSessionView = {
  id: "0123456789ab",
  code: "UD6HFH",
  state: "connected",
  os: "windows",
  elevated: true,
  endAt: "2026-10-21T21:15:00.000Z",
  hostname: `GOXP103 ${ADDRESS}`,
  osName: "Windows 11 Professionnel pour les Stations de travail",
  user: "gox\\zsellam",
  model: "OptiPlex",
  serial: "SN1",
  cpu: "Intel Core i5",
  ram: "16 Go",
  disk: "120 Go libres sur 476 Go",
  suggestions: [{ id: "disk-low" }, { id: "cpu" }],
};

describe("remote session card", () => {
  it("shows the computer and the hints, and never the tunnel address", () => {
    const html = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view }),
    ));
    expect(html).toContain("data-remote-session-card");
    expect(html).toContain("GOXP103");
    expect(html).toContain("gox\\zsellam");
    expect(html).toContain("UD6HFH");
    expect(html).toContain(formatEndLabel(view.endAt));
    expect(html).toContain("SN1");
    expect(html).toContain("OptiPlex");
    expect(html).toContain("Intel Core i5");
    expect(html).toContain("16 Go");
    expect(html).toContain("120 Go libres sur 476 Go");
    expect(html).toContain(t("remoteSession.suggest.disk-low"));
    expect(html).toContain(t("remoteSession.shell"));
    expect(html).not.toContain(ADDRESS);
    expect(html).not.toContain(view.id);
  });

  it("keeps a closed session visible and drops the hints", () => {
    const html = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view: { ...view, state: "ended", suggestions: [] } }),
    ));
    expect(html).toContain(t("remoteSession.closed"));
    expect(html).not.toContain("data-remote-hint");
    expect(html).not.toContain(ADDRESS);
  });
});
