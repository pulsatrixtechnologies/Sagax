// The application menu. It exists for two reasons: the Server submenu,
// where the user switches between the local server and paired remote ones,
// and the macOS Preferences… item (Electron has no role for it, so it is
// built explicitly). Everything else is Electron's standard roles so macOS
// keeps Edit/Window and Windows/Linux get the same items under a visible bar.
import { Menu } from "electron";

import { DISPLAY_NAME } from "./app-name.mjs";

/**
 * @param {object} input
 * @param {{ id: string, name: string, origin: string }[]} input.environments
 * @param {string} input.activeId  "local" or an environment id
 * @param {(id: string) => void} input.onSwitch
 * @param {() => void} input.onAddFromClipboard
 * @param {() => void} input.onConnect
 * @param {(id: string) => void} input.onForget
 * @param {() => void} input.onOpenSettings
 * @param {() => void} input.onOrganizationSignIn
 */
export function buildApplicationMenu({ environments, activeId, onSwitch, onAddFromClipboard, onConnect, onForget, onOpenSettings, onOrganizationSignIn }) {
  const isMac = process.platform === "darwin";
  const active = environments.find((e) => e.id === activeId) ?? null;
  const server = {
    label: "Server",
    submenu: [
      { label: "Local (this computer)", type: "radio", checked: !active, click: () => onSwitch("local") },
      ...environments.map((e) => ({
        label: `${e.name} — ${new URL(e.origin).host}`,
        type: "radio",
        checked: e.id === activeId,
        click: () => onSwitch(e.id),
      })),
      { type: "separator" },
      { id: "organization-sign-in", label: "Sign in with your organization…", click: onOrganizationSignIn },
      { label: "Connect to a server…", click: onConnect },
      { label: "Add Server from Copied Pairing Link…", click: () => onAddFromClipboard() },
      {
        label: active ? `Forget “${active.name}”` : "Forget Server",
        enabled: Boolean(active),
        click: () => active && onForget(active.id),
      },
    ],
  };
  const template = [
    // app.name is the runtime name (openmausbot), which the roles would print
    ...(isMac ? [{ label: DISPLAY_NAME, submenu: [{ role: "about", label: `About ${DISPLAY_NAME}` }, { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => onOpenSettings() }, { type: "separator" }, { role: "hide", label: `Hide ${DISPLAY_NAME}` }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit", label: `Quit ${DISPLAY_NAME}` }] }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    server,
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}
