/** Isolated gallery for headless screenshots of Settings > Usage > traces
 * (pagination). Not shipped in the app. ?lang=<code>&skin=<id>
 * Fictional jobs only, served by a fake paging loader. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UsageTraces } from "../components/usage/UsageTraces";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { UsageJobTrace, UsageTraceList } from "../lib/usage-trace";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const NAMES = ["Scout", "Atlas", "Comète", "Lynx", "Orion", "Pixel", "Sauge"];
const jobs: UsageJobTrace[] = Array.from({ length: 37 }, (_, n) => ({
  jobId: `j${n}`, threadId: `t${n}`, botId: `b${n % 7}`, botName: NAMES[n % 7]!,
  triggerKey: "user", triggerLabel: "Ada Exemple", triggerKind: "user",
  firstAt: "2026-10-22T12:00:00.000Z", lastAt: `2026-10-22T12:${String(59 - n).padStart(2, "0")}:00.000Z`,
  turns: 2 + (n % 4), timedTurns: 2, durationMs: 4_000 + n * 900, input: 1000, output: 200, cachedInput: 600,
  costUsd: 0.01 + n * 0.003, estimatedUsd: null, unpriced: 0, models: ["claude-sonnet-5"], steps: [],
}));
const sum = jobs.reduce((a, j) => ({ d: a.d + j.durationMs, c: a.c + (j.costUsd ?? 0), t: a.t + j.turns }), { d: 0, c: 0, t: 0 });
const load = (_range: unknown, paging = { limit: 10, offset: 0 }): Promise<UsageTraceList> =>
  Promise.resolve({
    from: "", to: "", jobs: jobs.slice(paging.offset, paging.offset + paging.limit), truncated: false, page: paging,
    total: { jobs: jobs.length, turns: sum.t, durationMs: sum.d, costUsd: sum.c, estimatedUsd: null, unpriced: 0, input: 0, output: 0 },
  });

createRoot(document.getElementById("root")!).render(
  <StrictMode><div className="mx-auto max-w-xl p-4"><UsageTraces load={load} /></div></StrictMode>,
);
