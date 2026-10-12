import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import type { TerminalEmbed } from "../../../shared/terminal-resources.ts";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

const THEME = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
  selectionBackground: "#264f78",
};

export function TerminalChatEmbed({ embed }: { embed: TerminalEmbed }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState(embed.status);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (embed.status === "ended" || !hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      /* canvas fallback */
    }
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal/sessions/${embed.sessionId}/ws`);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (event) => {
      if (typeof event.data === "string") term.write(event.data);
      else term.write(new Uint8Array(event.data));
    };
    ws.onopen = () => {
      setStatus("live");
      setError(null);
    };
    ws.onerror = () => setError(t("terminal.connectionError"));
    ws.onclose = () => setStatus("ended");

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(hostRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      void api(`/api/terminal/sessions/${embed.sessionId}/close`, { method: "POST" }).catch(() => {});
    };
  }, [embed.sessionId, embed.status]);

  const copySelection = () => {
    const selection = termRef.current?.getSelection();
    if (selection) void navigator.clipboard.writeText(selection);
  };

  const popOut = () => {
    const url = `/terminal-popout#${encodeURIComponent(embed.sessionId)}`;
    window.open(url, `sagax-terminal-${embed.sessionId}`, "noopener,noreferrer,width=960,height=640");
  };

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-hairline/40 bg-[#0d1117] text-ink" data-terminal-embed="">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[12px] text-[#e6edf3]/90">
        <span className="font-medium">{embed.label}</span>
        <span className="text-white/50">·</span>
        <span className="truncate text-white/70">{embed.hostLabel}</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px]", status === "live" ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/60")}>
          {status === "live" ? t("terminal.status.live") : t("terminal.status.ended")}
        </span>
        <button type="button" className="rounded p-1 hover:bg-white/10" title={t("terminal.copy")} onClick={copySelection}>
          <Copy size={14} />
        </button>
        <button type="button" className="rounded p-1 hover:bg-white/10" title={t("terminal.popOut")} onClick={popOut}>
          <ExternalLink size={14} />
        </button>
      </div>
      {error && <p className="px-3 py-1 text-[12px] text-amber-200">{error}</p>}
      <div ref={hostRef} className="h-[min(320px,40vh)] w-full px-1 py-1" />
    </div>
  );
}
