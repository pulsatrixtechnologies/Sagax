// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationInvite, shouldInviteNotifications } from "./NotificationInvite";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const requestPermission = vi.fn(async () => "granted");

function fakeNotification(permission: NotificationPermission) {
  vi.stubGlobal("Notification", Object.assign(function () {}, { permission, requestPermission }));
}

beforeEach(() => {
  localStorage.clear();
  requestPermission.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(() => root.render(createElement(NotificationInvite)));
const click = (label: string) => act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!.click());

describe("NotificationInvite", () => {
  it("shows only while permission was never asked", () => {
    fakeNotification("granted");
    expect(shouldInviteNotifications()).toBe(false);
    fakeNotification("denied");
    expect(shouldInviteNotifications()).toBe(false);
    fakeNotification("default");
    expect(shouldInviteNotifications()).toBe(true);
  });

  it("asks for the permission from its button and goes away", async () => {
    fakeNotification("default");
    render();
    expect(host.textContent).toContain("Let your bots notify you when something needs your attention");
    click("Turn on notifications");
    await act(async () => { await Promise.resolve(); });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-notification-invite]")).toBeNull();
  });

  it("stays away for good after Not now", () => {
    fakeNotification("default");
    render();
    click("Not now");
    expect(host.querySelector("[data-notification-invite]")).toBeNull();
    expect(shouldInviteNotifications()).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("draws nothing where notifications do not exist", () => {
    vi.stubGlobal("Notification", undefined);
    render();
    expect(host.querySelector("[data-notification-invite]")).toBeNull();
  });
});
