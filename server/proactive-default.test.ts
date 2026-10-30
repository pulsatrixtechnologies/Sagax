// 0.8.19: every bot is proactive by default (shared/proactive-mode.ts). A new
// bot starts on the default; a stored bot that never chose a mode takes it
// once at load; a mode the person chose, "off" included, is kept.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";
import { PROACTIVE_MODE_DEFAULT, proactiveModeFor } from "../shared/proactive-mode.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const BOTS = () => join(DATA_DIR, "bots.json");

describe("proactive by default", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("creates a new bot proactive, and stores it so", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Fresh" });
    expect(PROACTIVE_MODE_DEFAULT).toBe("follow-rules");
    expect(bot.proactiveMode).toBe("follow-rules");
    const saved = JSON.parse(readFileSync(BOTS(), "utf8")) as Array<{ id: string; proactiveMode?: string }>;
    expect(saved.find((row) => row.id === bot.id)?.proactiveMode).toBe("follow-rules");
  });

  it("migrates a bot still on the old default and keeps a mode the person chose", () => {
    const seed = new Store(selection);
    const untouched = seed.createBot({ name: "Untouched" });
    const proposer = seed.createBot({ name: "Proposer" });
    const reader = seed.createBot({ name: "Reader" });
    const turnedOff = seed.createBot({ name: "Turned off" });
    // bots.json as an older release wrote it: no mode stored for the default
    // ("off" used to be stored as nothing), a chosen level stored as is.
    const rows = JSON.parse(readFileSync(BOTS(), "utf8")) as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (row.id === untouched.id) delete row.proactiveMode;
      if (row.id === proposer.id) row.proactiveMode = "propose";
      if (row.id === reader.id) row.proactiveMode = "read-auto";
      // since 0.8.19 an off the person picks is stored as "off"
      if (row.id === turnedOff.id) row.proactiveMode = "off";
    }
    writeFileSync(BOTS(), JSON.stringify(rows));

    const store = new Store(selection);
    expect(store.bot(untouched.id)?.proactiveMode).toBe("follow-rules");
    expect(store.bot(proposer.id)?.proactiveMode).toBe("propose");
    expect(store.bot(reader.id)?.proactiveMode).toBe("read-auto");
    expect(store.bot(turnedOff.id)?.proactiveMode).toBe("off");

    // written once: the next start reads the same, and a later off sticks
    const disk = JSON.parse(readFileSync(BOTS(), "utf8")) as Array<{ id: string; proactiveMode?: string }>;
    expect(disk.find((row) => row.id === untouched.id)?.proactiveMode).toBe("follow-rules");
    store.patchBot(untouched.id, { proactiveMode: "off" });
    expect(new Store(selection).bot(untouched.id)?.proactiveMode).toBe("off");
  });

  it("reads the wire the same way on every client: absent is proactive, a chosen off is off", () => {
    expect(proactiveModeFor({})).toBe("follow-rules");
    expect(proactiveModeFor({ proactiveMode: "off" })).toBe("off");
  });
});
