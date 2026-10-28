// Company memory is one file, memory/company.md, per bot. Every bot of the
// same person reads those files. A bot of another member does not: the
// read is filtered on the owner before the file is opened. A line marked
// readers person is dropped even if it was copied by mistake.
import { factIdentity } from "./memory-entries.ts";
import { memoryAudience } from "./memory-dream.ts";

export function companyTextForBots(input: {
  ownerKey: string;
  bots: readonly { id: string; ownerKey: string }[];
  read: (botId: string) => string | null;
}): string {
  const owner = input.ownerKey.trim().toLowerCase();
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const bot of input.bots) {
    if (bot.ownerKey.trim().toLowerCase() !== owner) continue;
    const text = input.read(bot.id);
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.trim() || memoryAudience(line) === "person") continue;
      const key = factIdentity(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines.join("\n");
}
