// One live terminal per shell session, outside React, so the same xterm and
// WebSocket can move between the chat widget and a floating window without a
// new connection. The xterm draws into one element that `attach` moves into
// whichever container shows it; holders (`retain`) keep the session alive,
// and it closes (WebSocket, xterm, server session) a moment after the last
// holder lets go, so a remount or a hand-off from the chat to a window does
// not end it.
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { loadTerminalFonts, TERMINAL_FONT_FAMILY } from "./terminal-font";

const THEME = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
  selectionBackground: "#264f78",
};

/** How long a session outlives its last holder (a remount, a hand-off). */
export const RELEASE_GRACE_MS = 1500;

export type TerminalSessionStatus = "connecting" | "live" | "ended";
export interface TerminalSessionState {
  status: TerminalSessionStatus;
  error: string | null;
}

export interface TerminalSession {
  readonly sessionId: string;
  state(): TerminalSessionState;
  subscribe(listener: () => void): () => void;
  /** Keeps the session open until the returned release is called. */
  retain(): () => void;
  /** Shows the terminal in `container` (moving it from where it was). */
  attach(container: HTMLElement): () => void;
  getSelection(): string;
  focus(): void;
}

const sessions = new Map<string, TerminalSession>();

export function terminalSession(sessionId: string): TerminalSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession(sessionId);
    sessions.set(sessionId, session);
  }
  return session;
}

function createSession(sessionId: string): TerminalSession {
  const element = document.createElement("div");
  element.className = "h-full w-full";
  element.dataset.terminalSession = sessionId;
  let state: TerminalSessionState = { status: "connecting", error: null };
  const listeners = new Set<() => void>();
  const setState = (patch: Partial<TerminalSessionState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  let holders = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let ws: WebSocket | null = null;
  let opened = false;
  let container: HTMLElement | null = null;
  const observer = new ResizeObserver(() => refit());

  const refit = () => {
    if (!fit || !container || container.clientWidth === 0 || container.clientHeight === 0) return;
    fit.fit();
  };
  const openIfReady = () => {
    if (!term || opened || !element.isConnected) return;
    term.open(element);
    opened = true;
    refit();
  };

  // xterm and its addons read `self` when they load, so they load with the
  // first terminal, never with the chat (nor in a test of it).
  const ready = Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-search"),
    import("@xterm/addon-web-links"),
    import("@xterm/addon-webgl"),
    loadTerminalFonts(),
  ]).then(([{ Terminal }, { FitAddon }, { SearchAddon }, { WebLinksAddon }, { WebglAddon }]) => {
    if (disposed) return;
    const created = new Terminal({
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      theme: THEME,
      allowProposedApi: true,
    });
    fit = new FitAddon();
    created.loadAddon(fit);
    created.loadAddon(new SearchAddon());
    created.loadAddon(new WebLinksAddon());
    try {
      created.loadAddon(new WebglAddon());
    } catch {
      /* DOM renderer fallback */
    }
    term = created;
    openIfReady();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/terminal/sessions/${sessionId}/ws`);
    ws = socket;
    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => {
      if (typeof event.data === "string") created.write(event.data);
      else created.write(new Uint8Array(event.data as ArrayBuffer));
    };
    // Keystrokes go as binary frames; a text frame is a control message
    // (the size, so the shell wraps where the terminal does).
    const encoder = new TextEncoder();
    const sendSize = () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols: created.cols, rows: created.rows }));
    };
    socket.onopen = () => {
      setState({ status: "live", error: null });
      sendSize();
    };
    created.onResize(sendSize);
    socket.onerror = () => setState({ error: t("terminal.connectionError") });
    socket.onclose = () => setState({ status: "ended" });
    created.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encoder.encode(data));
    });
  });
  ready.catch(() => {
    if (!disposed) setState({ error: t("terminal.connectionError") });
  });

  const dispose = () => {
    disposed = true;
    sessions.delete(sessionId);
    observer.disconnect();
    ws?.close();
    term?.dispose();
    element.remove();
    void api(`/api/terminal/sessions/${sessionId}/close`, { method: "POST" }).catch(() => {});
  };

  const scheduleRelease = () => {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      if (holders === 0 && !disposed) dispose();
    }, RELEASE_GRACE_MS);
  };
  // a session nobody takes (its row never mounted) does not stay open
  scheduleRelease();

  return {
    sessionId,
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retain() {
      holders += 1;
      clearTimeout(releaseTimer);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) scheduleRelease();
      };
    },
    attach(target) {
      container = target;
      target.appendChild(element);
      observer.disconnect();
      observer.observe(target);
      openIfReady();
      refit();
      return () => {
        if (container !== target) return;
        observer.disconnect();
        container = null;
        if (element.parentElement === target) element.remove();
      };
    },
    getSelection: () => term?.getSelection() ?? "",
    focus: () => term?.focus(),
  };
}
