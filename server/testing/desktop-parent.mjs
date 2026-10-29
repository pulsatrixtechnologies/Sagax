// The desktop app's private parent port, for tests that run the server as
// Electron's utility process runs it. Plain Node has no parentPort; this
// prelude gives the server one, and only these feed it:
// - SAGAX_TEST_DESKTOP_OWNER_TOKEN: the owner capability Electron would hand
//   over (the verification launcher's desktop mode, which then also sets
//   SAGAX_DESKTOP_PARENT=1);
// - the test's own IPC channel, when it spawned the server with one: each
//   message is delivered as the desktop would send it (this computer's
//   connection, server/testing/desktop-computer.ts), then acknowledged.
const token = process.env.SAGAX_TEST_DESKTOP_OWNER_TOKEN;
delete process.env.SAGAX_TEST_DESKTOP_OWNER_TOKEN;
const ipc = typeof process.send === "function";
if (token || ipc) {
  const listeners = [];
  if (ipc) {
    process.on("message", (message) => {
      const { testAck, ...data } = message ?? {};
      for (const listener of listeners) listener({ data });
      if (typeof testAck === "string") process.send?.({ testAck });
    });
    process.channel?.unref();
  }
  Object.defineProperty(process, "parentPort", {
    value: {
      on(event, listener) {
        if (event !== "message") return;
        listeners.push(listener);
        if (token) queueMicrotask(() => listener({ data: { type: "openmausbot:desktop-mutation-token", token } }));
      },
      postMessage() {},
    },
  });
}
