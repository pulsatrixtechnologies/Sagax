/** Isolated gallery for screenshots of the in-chat terminal widget. Not
 * shipped in the app. The real TerminalChatEmbed is drawn in a bot bubble of
 * a transcript-sized column; its WebSocket is answered in the page with a
 * Powerlevel10k-style prompt (Nerd Font icons, Powerline separators), so
 * nothing connects anywhere.
 * ?skin=<id>&lang=<code>&before=1 (bubble width before the fix)
 * &dom=1 (no WebGL: the DOM renderer the widget falls back to) */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { TerminalChatEmbed } from "../components/terminal/TerminalChatEmbed";
import { CHAT_BUBBLE_WIDTH_CLASS } from "../lib/chat-bubble-width";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { loadTerminalFonts, TERMINAL_FONT_FAMILY } from "../components/terminal/terminal-font";
import "../styles.css";
import type { TerminalEmbed } from "../../shared/terminal-resources";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const before = params.get("before") === "1";
{
  // dom=1: no WebGL, the DOM renderer the widget falls back to. Otherwise the
  // WebGL buffer is kept after each frame so a page screenshot captures it.
  const dom = params.get("dom") === "1";
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, options?: Record<string, unknown>) {
    if (kind !== "webgl2") return (getContext as (...args: unknown[]) => unknown).call(this, kind, options);
    return dom ? null : (getContext as (...args: unknown[]) => unknown).call(this, kind, { ...options, preserveDrawingBuffer: true });
  } as typeof getContext;
}

const E = "\x1b[";
const seg = (bg: number, fg: number, text: string, next: number | null) =>
  `${E}48;5;${bg}m${E}38;5;${fg}m ${text} ${next === null ? `${E}0m${E}38;5;${bg}m${E}0m` : `${E}38;5;${bg}m${E}48;5;${next}m`}`;
const PROMPT = [
  "Last login: Thu Oct 16 08:40:12 on ttys004\r\n",
  seg(236, 15, "", 31) + seg(31, 15, " ~/Repository/pti/Sagax", 70) + seg(70, 0, " main ", null),
  `${E}0m${" ".repeat(6)}${E}38;5;242m${E}48;5;242m${E}38;5;15m  3.11 ${E}38;5;238m${E}48;5;238m${E}38;5;15m  08:40:15 ${E}0m\r\n`,
  `${E}38;5;70m❯${E}0m ls\r\n`,
  " docs   src   package.json   tsconfig.json   README.md\r\n",
  `${E}38;5;70m❯${E}0m `,
].join("");

class GalleryWebSocket {
  static readonly OPEN = 1;
  readyState = 1;
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    setTimeout(() => {
      this.onopen?.();
      this.onmessage?.({ data: PROMPT });
    }, 50);
  }
  send() {}
  close() {}
}
(window as unknown as { WebSocket: unknown }).WebSocket = GalleryWebSocket;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/terminal/")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const EMBED: TerminalEmbed = { sessionId: "gallery", status: "live", label: "Cet ordinateur", hostLabel: "Jean-Christophes-Macbook-Pro.local", provider: "desktop", resourceId: "mine" };

const GLYPHS = "      3.11  ";

/** The glyphs drawn on a 2D canvas with the terminal's font string, the way
 * xterm's WebGL renderer rasterizes them into its atlas. */
function CanvasGlyphs() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    void loadTerminalFonts().then(() => {
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const scale = window.devicePixelRatio || 1;
      canvas.width = 360 * scale;
      canvas.height = 24 * scale;
      ctx.scale(scale, scale);
      ctx.fillStyle = "#e6edf3";
      ctx.font = `13px ${TERMINAL_FONT_FAMILY}`;
      ctx.textBaseline = "middle";
      ctx.fillText(GLYPHS, 0, 12);
    });
  }, []);
  return <canvas ref={ref} data-glyphs-canvas="" style={{ width: 360, height: 24 }} />;
}

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-6 text-ink">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6" data-gallery-column="">
        <h1 className="text-lg font-semibold">Terminal en ligne</h1>
        <div className="grid grid-cols-[180px_1fr] gap-2 rounded-xl border border-hairline/40 bg-card p-3 text-[13px]">
          <span className="text-ink-tertiary">Avant (police système)</span>
          <span data-glyphs-before="" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{GLYPHS}</span>
          <span className="text-ink-tertiary">Après (pile du terminal)</span>
          <span data-glyphs-after="" style={{ fontFamily: TERMINAL_FONT_FAMILY }}>{GLYPHS}</span>
          <span className="text-ink-tertiary">Après (canvas, comme WebGL)</span>
          <CanvasGlyphs />
        </div>
        <div className="flex w-full flex-col items-end">
          <div className="w-fit max-w-[min(80%,560px,calc(100%-82px))] rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] text-ink">Ouvre un terminal sur mon Mac</div>
        </div>
        <div className="flex w-full flex-col items-start">
          <div data-chat-bubble="" className={`rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink ${CHAT_BUBBLE_WIDTH_CLASS[before ? "fit" : "column"]}`}>
            <TerminalChatEmbed embed={EMBED} />
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
