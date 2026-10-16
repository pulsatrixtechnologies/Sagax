import type { spawnScriptPty } from "./script-pty.mjs";

export declare function loginShellArgv(options?: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv }): string[];

export declare function parseResize(text: string): { cols: number; rows: number } | null;

export declare function openBridgeTerminal(options: {
  url: string;
  headers: Record<string, string>;
  ticket: string;
  cols: number;
  rows: number;
  command: () => Promise<{ argv: string[]; env?: NodeJS.ProcessEnv; cwd?: string }> | { argv: string[]; env?: NodeJS.ProcessEnv; cwd?: string };
  WebSocketImpl?: unknown;
  spawnPty?: typeof spawnScriptPty;
  platform?: NodeJS.Platform;
  home?: string;
  onClose?: () => void;
}): Promise<{ close(): void }>;
