import type { Duplex } from "node:stream";

/** After a WebSocket upgrade, Node has dropped its default `error` handlers
 * and `pipe()` adds none. Wire each side to destroy the other so a network
 * blip cannot become an uncaughtException that kills the sidecar. */
export function attachRelayErrorHandlers(socket: Duplex, remote: Duplex): void {
  socket.on("error", () => remote.destroy());
  remote.on("error", () => socket.destroy());
}
