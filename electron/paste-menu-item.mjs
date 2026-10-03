/** Keep native text paste, but let image/file clipboards reach renderer paste handlers.
 * Async since Electron 44, whose clipboard answers through promises. */
export async function pasteMenuItem(params, clipboard, webContents) {
  let attachment = false;
  if (params.isEditable && !params.editFlags.canPaste) {
    try {
      // Finder may supply file URLs, not bitmap bytes: Electron maps
      // `text/uri-list` to NSFilenamesPboardType (macOS), CF_HDROP (Windows)
      // and text/uri-list (Linux). Chromium still owns decoding; this does
      // not read files or send clipboard data over IPC.
      const present = await Promise.all(["text/uri-list", "image/png"].map((type) => clipboard.has(type)));
      attachment = present.some(Boolean);
    } catch { /* Clipboard access can be unavailable. Leave Paste disabled. */ }
  }
  return {
    label: "Paste",
    enabled: params.isEditable && (params.editFlags.canPaste || attachment),
    // macOS controls enabled for native roles. Invoke paste explicitly only
    // for the attachment fallback; ordinary text keeps its native role.
    ...(attachment ? { click: () => webContents.paste() } : { role: "paste" }),
  };
}
