import type { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import type { PassThrough } from "node:stream";

export declare function shellQuote(value: string): string;

export declare function withSystemPath(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;

export declare function scriptPtyCommand(
  argv: string[],
  options?: { platform?: NodeJS.Platform },
): { command: string; args: string[] } | null;

export interface ScriptPty {
  input: PassThrough;
  output: PassThrough;
  proc: ChildProcessWithoutNullStreams;
  resize(cols: number, rows: number): void;
  close(): void;
}

export declare function spawnScriptPty(
  argv: string[],
  options?: {
    platform?: NodeJS.Platform;
    cols?: number;
    rows?: number;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    spawnImpl?: typeof spawn;
    execFileImpl?: typeof execFile;
  },
): ScriptPty;
