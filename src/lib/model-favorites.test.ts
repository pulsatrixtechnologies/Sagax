import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import {
  MAX_FAVORITES, MODEL_FAVORITES_KEY, favoriteKey, parseModelFavorites, readModelFavorites, serializeModelFavorites,
  toggleModelFavorite, withFavoriteToggled,
} from "./model-favorites";

describe("model favorites", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows the person on an organization server", () => {
    expect(USER_PREFERENCE_KEYS).toContain(MODEL_FAVORITES_KEY);
  });

  it("stores engine and model pairs, and reads them back as the menu's row keys", () => {
    const keys = [favoriteKey("claude", "claude-opus-5-5"), favoriteKey("openrouter", "anthropic/claude-sonnet-5")];
    const raw = serializeModelFavorites(keys);
    expect(JSON.parse(raw)).toEqual([["claude", "claude-opus-5-5"], ["openrouter", "anthropic/claude-sonnet-5"]]);
    expect(parseModelFavorites(raw)).toEqual(keys);
  });

  it("drops broken values and duplicates, and keeps the newest when there are too many", () => {
    expect(parseModelFavorites("{")).toEqual([]);
    expect(parseModelFavorites(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseModelFavorites(JSON.stringify([["a", "b"], ["a", "b"], ["", "x"], ["a"], [1, 2]]))).toEqual([favoriteKey("a", "b")]);
    const many = Array.from({ length: MAX_FAVORITES + 5 }, (_, index) => ["e", `m${index}`]);
    const parsed = parseModelFavorites(JSON.stringify(many));
    expect(parsed).toHaveLength(MAX_FAVORITES);
    expect(parsed.at(-1)).toBe(favoriteKey("e", `m${MAX_FAVORITES + 4}`));
  });

  it("adds a model at the end and removes it on a second toggle", () => {
    const opus = favoriteKey("claude", "opus");
    const grok = favoriteKey("grok", "grok-4.7");
    expect(withFavoriteToggled([opus], grok)).toEqual([opus, grok]);
    expect(withFavoriteToggled([opus, grok], opus)).toEqual([grok]);
    expect(withFavoriteToggled([opus], "no separator")).toEqual([opus]);
  });

  it("persists a star in local storage and reads it again", () => {
    const opus = favoriteKey("claude", "opus");
    toggleModelFavorite(opus);
    expect(JSON.parse(store.get(MODEL_FAVORITES_KEY)!)).toEqual([["claude", "opus"]]);
    expect(readModelFavorites()).toEqual([opus]);
    toggleModelFavorite(opus);
    expect(readModelFavorites()).toEqual([]);
  });

  it("keeps the stars for the session when storage refuses them", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => {} });
    toggleModelFavorite(favoriteKey("claude", "opus"));
    expect(readModelFavorites()).toEqual([favoriteKey("claude", "opus")]);
  });
});
