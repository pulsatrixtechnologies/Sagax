// Optional local vectors beside the FTS5 recall in server/recall.ts.
// FTS5 is the default. This file does not download a model and does not
// embed text. Nothing in the repo ships an embedding model or stored vectors,
// so ready() stays false and recall stays the FTS5 passages.
//
// What is missing for vectors: a local embedding file the person already has,
// and a local index that calls setSemanticIndex. ready(botId) must be true
// before search is used. Until then every search is empty.

import type { RecallPassage } from "./recall.ts";

export const SEMANTIC_RECALL_MISSING =
  "No local embedding model is shipped, and no vectors are stored. FTS5 remains the recall. A local index registers itself with setSemanticIndex; its ready() must be true before a vector passage is added. Nothing here downloads a model.";

export interface SemanticHit {
  source: "memory" | "conversation";
  label: string;
  snippet: string;
  /** Higher is closer. The fuse keeps FTS5 order and only appends. */
  score: number;
  at?: number;
}

/** A local vector index. The process registers at most one. */
export interface SemanticIndex {
  ready(botId: string): boolean;
  search(botId: string, query: string, limit: number): SemanticHit[];
}

let index: SemanticIndex | null = null;

/** Register a local index, or null to remove it. */
export function setSemanticIndex(next: SemanticIndex | null): void {
  index = next;
}

export function semanticIndexReady(botId: string): boolean {
  try {
    return Boolean(index?.ready(botId));
  } catch {
    return false;
  }
}

/** Vector passages, or none when no local index is ready. */
export function semanticPassages(botId: string, query: string, limit: number): RecallPassage[] {
  if (!index || limit < 1 || !semanticIndexReady(botId)) return [];
  let hits: SemanticHit[] = [];
  try {
    hits = index.search(botId, query, limit);
  } catch {
    return [];
  }
  return hits
    .filter((hit) => hit && (hit.source === "memory" || hit.source === "conversation") && typeof hit.snippet === "string" && hit.snippet.trim() && typeof hit.label === "string")
    .slice(0, limit)
    .map((hit) => ({ source: hit.source, label: hit.label, snippet: hit.snippet.trim(), ...(typeof hit.at === "number" ? { at: hit.at } : {}) }));
}

/** FTS5 passages stay in front. A vector passage is added only when its label is new and the cap allows it. */
export function fusePassages(lexical: readonly RecallPassage[], semantic: readonly RecallPassage[], limit: number): RecallPassage[] {
  const out = lexical.slice(0, Math.max(0, limit));
  const seen = new Set(out.map((passage) => `${passage.source}\n${passage.label}`));
  for (const passage of semantic) {
    if (out.length >= limit) break;
    const key = `${passage.source}\n${passage.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(passage);
  }
  return out;
}
