// The Achievements tab of a person's panel: what the grid and the recent
// tiles hold, and how a tile reads (hover names it, a click details it).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { AchievementsPanel, PANEL_RECENT, panelCategories, panelRecent } from "./AchievementsPanel";

const visible = ACHIEVEMENTS.filter((item) => !item.hidden);
const secret = ACHIEVEMENTS.find((item) => item.hidden)!;

describe("AchievementsPanel", () => {
  it("lists every visible achievement by category, plus the secrets already found", () => {
    const groups = panelCategories({ unlocked: [{ id: secret.id, points: secret.points, unlockedAt: 5 }] });
    const ids = groups.flatMap((group) => group.tiles.map((tile) => tile.item.id));
    expect(ids).toHaveLength(visible.length + 1);
    expect(ids).toContain(secret.id);
    expect(groups.flatMap((group) => group.tiles).find((tile) => tile.item.id === secret.id)?.unlocked).toBe(true);
    const others = ACHIEVEMENTS.filter((item) => item.hidden && item.id !== secret.id);
    for (const item of others) expect(ids).not.toContain(item.id);
    expect(groups.every((group) => group.tiles.length > 0)).toBe(true);
  });

  it("keeps the last unlocks, newest first", () => {
    const unlocked = visible.slice(0, 7).map((item, index) => ({ id: item.id, points: item.points, unlockedAt: 1000 + index }));
    const recent = panelRecent({ unlocked: [...unlocked, { id: "retired-id", points: 5, unlockedAt: 9999 }] });
    expect(recent).toHaveLength(PANEL_RECENT);
    expect(recent.map((tile) => tile.item.id)).toEqual(unlocked.slice(-PANEL_RECENT).reverse().map((entry) => entry.id));
  });

  it("names each tile with its points on hover and leaves the level bar out without points", () => {
    const html = renderToStaticMarkup(createElement(AchievementsPanel, { card: { unlocked: [{ id: "hello-bot", points: 10, unlockedAt: 1 }] }, title: null }));
    expect(html).toMatch(/data-achievement="hello-bot" data-unlocked=""[^>]*title="It&#x27;s Alive! · 10 pts"/);
    expect(html).toMatch(/data-locked=""[^>]*title="[^"]+ · Locked"/);
    expect(html).not.toContain("data-member-points");
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain("1 of");
  });
});
