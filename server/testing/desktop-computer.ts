// Tests only: start the server as the desktop app does (desktop-parent.mjs
// gives it a parent port fed by this test's IPC channel) and hand it this
// computer's connection the way Electron does.
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DESKTOP_PARENT_IMPORT = ["--import", pathToFileURL(join(import.meta.dirname, "desktop-parent.mjs")).href];
export const DESKTOP_PARENT_STDIO = ["ignore", "pipe", "pipe", "ipc"] as const;

/** Resolves once the server has taken the record (null takes it away). */
export function handDesktopComputer(child: ChildProcess, connection: object | null, timeoutMs = 10_000): Promise<void> {
  const testAck = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error("the server did not take this computer's connection"));
    }, timeoutMs);
    function onMessage(message: unknown) {
      if ((message as { testAck?: string } | null)?.testAck !== testAck) return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve();
    }
    child.on("message", onMessage);
    child.send({ type: "sagax:local-computer", connection, testAck });
  });
}
