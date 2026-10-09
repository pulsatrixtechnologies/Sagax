// The organisation bot catalogue ("Browse Bots"): what a bot's catalogue
// listing holds, the default categories, and the wire shapes of
// GET /api/bot-catalog and GET /api/bot-catalog/:id (server/routes/bot-catalog.ts).
// The modal is src/components/bot-catalog/.
import type { MascotBodyId } from "./mascot-bodies.ts";
import type { MascotLook } from "./mascot-look.ts";
import type { MascotSkinId } from "./mascot-skins.ts";
import type { BotAvatarCrop } from "./bot-avatar.ts";
import type { MausColor, MausExpression } from "./wire.ts";

/** Stored on the bot record (`catalog`): the bot is offered to everyone in
 * the organisation. Set by its owner or an organisation admin; only an
 * admin features one. */
export interface BotCatalogListing {
  published: boolean;
  /** Free text set by the publisher; a default id below shows translated. */
  category?: string;
  featured?: boolean;
  publishedAt?: number;
  /** Principal id of who published it. */
  publishedBy?: string;
}

/** The chips offered by default, before the categories publishers typed. */
export const DEFAULT_BOT_CATALOG_CATEGORIES = ["engineering", "sales", "marketing", "design", "personal", "people", "product", "operations"] as const;
export type DefaultBotCatalogCategory = typeof DEFAULT_BOT_CATALOG_CATEGORIES[number];

export const BOT_CATALOG_CATEGORY_MAX = 40;

/** A category as stored: trimmed, single spaces, at most 40 characters; a
 * default category typed in any case is stored as its id. Null: none. */
export function normalizeCatalogCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, BOT_CATALOG_CATEGORY_MAX).trim();
  if (!text) return null;
  const id = DEFAULT_BOT_CATALOG_CATEGORIES.find((candidate) => candidate === text.toLowerCase());
  return id ?? text;
}

export function isDefaultCatalogCategory(value: string): value is DefaultBotCatalogCategory {
  return (DEFAULT_BOT_CATALOG_CATEGORIES as readonly string[]).includes(value);
}

/** How the viewer reaches a bot in the catalogue. */
export type BotCatalogSource = "mine" | "shared" | "organization";

export interface BotCatalogLook {
  color: MausColor;
  mascotExpression?: MausExpression | null;
  mascotBody?: MascotBodyId | null;
  mascotSkin?: MascotSkinId | null;
  mascotLook?: MascotLook | null;
  avatarUrl?: string | null;
  avatarCrop?: BotAvatarCrop;
}

/** One bot of GET /api/bot-catalog. */
export interface BotCatalogEntry {
  id: string;
  name: string;
  title: string;
  description: string;
  look: BotCatalogLook;
  owner: { principalId: string; name: string };
  source: BotCatalogSource;
  /** Archived (hidden) bots are listed to their owner only. */
  archived: boolean;
  primary: boolean;
  /** Present while the bot is published to the organisation. */
  catalog?: BotCatalogListing;
}

export interface BotCatalogResponse {
  /** An organisation server (Perspicax): shared and organisation sections exist. */
  organization: boolean;
  viewer: {
    principalId: string;
    /** May feature a bot, publish anyone's, and unpublish anyone's. */
    admin: boolean;
    /** May make a bot of their own (import or a template). */
    canCreate: boolean;
  };
  entries: BotCatalogEntry[];
}

/** GET /api/bot-catalog/:id: read-only, for the detail view. */
export interface BotCatalogDetail {
  entry: BotCatalogEntry;
  soul: string;
  /** Live facts of MEMORY.md; null when this viewer may not read them (a
   * bot published to the organisation and not shared with them). */
  memories: string[] | null;
  skills: Array<{ name: string; description: string }>;
  routines: Array<{ name: string; schedule: string; enabled: boolean }>;
  integrations: Array<{ name: string; kind: "mcp" | "app" | "browser" }>;
}
