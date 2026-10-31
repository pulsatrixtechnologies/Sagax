// Language registry — a language is one JSON file plus one line here.
// Catalogs are plain JSON so the optional Claude helper and human translators can
// read/write the same reviewable files without a runtime service.
// Packs are PARTIAL: any key a pack omits falls back to English, so a
// half-translated language is a usable language, not a broken one.
//
// Only English is imported eagerly. Every other pack is fetched with import()
// the first time ensureLocale runs (app boot for the active language, or a
// language change). That keeps ~2–3 MB of unused catalogs out of the startup chunk.
import en from "./en.json";

export { en };
export type LocaleKey = keyof typeof en;
export type LocalePack = Partial<Record<LocaleKey, string>>;

/** Pickable languages for the settings dropdown. Alias keys ("pt") are
 * routing, not choices, so they are not listed here. */
export const localeChoices: ReadonlyArray<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "hi", label: "हिन्दी" },
  { code: "ja", label: "日本語" },
  { code: "pt-br", label: "Português (Brasil)" },
  { code: "zh", label: "简体中文" },
  { code: "zh-tw", label: "繁體中文（台灣）" },
  { code: "uk", label: "Українська" },
];

/** JSON file stem for each registry tag. Aliases share one file. */
const packFile: Record<string, string> = {
  en: "en",
  de: "de",
  es: "es",
  fr: "fr",
  hi: "hi",
  ja: "ja",
  // both keys, one pack: pt-BR is the registered dialect, and a plain
  // "pt" system language should land on it rather than English
  pt: "pt-br",
  "pt-br": "pt-br",
  zh: "zh",
  // Traditional-script and regional system tags share the Taiwan pack until
  // a region-specific Hong Kong or Macau catalog is contributed.
  "zh-hant": "zh-tw",
  "zh-hk": "zh-tw",
  "zh-mo": "zh-tw",
  "zh-tw": "zh-tw",
  uk: "uk",
};

/** Every registry tag, loaded or not. resolveLocale reads this so a French
 * system language still resolves to "fr" before fr.json has arrived. */
export const localeTags: ReadonlySet<string> = new Set(Object.keys(packFile));

/** Picker code whose pack a tag shows, for <html lang>. */
export function pickerCodeFor(tag: string): string {
  const file = packFile[tag] ?? tag;
  return localeChoices.find((choice) => packFile[choice.code] === file)?.code ?? tag;
}

const loaders: Record<string, () => Promise<{ default: LocalePack }>> = {
  de: () => import("./de.json"),
  es: () => import("./es.json"),
  fr: () => import("./fr.json"),
  hi: () => import("./hi.json"),
  ja: () => import("./ja.json"),
  "pt-br": () => import("./pt-br.json"),
  zh: () => import("./zh.json"),
  "zh-tw": () => import("./zh-tw.json"),
  uk: () => import("./uk.json"),
};

/** Loaded packs. Starts with English; ensureLocale fills the rest. Mutable so
 * tests can register a temporary pack under a fake tag. */
export const locales: Record<string, LocalePack> = { en };

const inflight = new Map<string, Promise<LocalePack>>();

function registerPack(file: string, pack: LocalePack): LocalePack {
  for (const [tag, stem] of Object.entries(packFile)) {
    if (stem === file) locales[tag] = pack;
  }
  return pack;
}

/** Fetch a pack (and its alias tags) when it is not already in `locales`. */
export async function ensureLocale(tag: string): Promise<LocalePack> {
  const file = packFile[tag];
  if (!file || file === "en") return locales[tag] ?? en;
  const cached = locales[tag];
  if (cached) return cached;
  let pending = inflight.get(file);
  if (!pending) {
    const loader = loaders[file];
    if (!loader) return en;
    pending = loader().then((mod) => registerPack(file, mod.default as LocalePack));
    inflight.set(file, pending);
  }
  return pending;
}

/** Load every shipped pack. Tests call this (via the MODE === "test" boot
 * below) so setLocale stays sync across the suite. */
export async function ensureAllLocales(): Promise<void> {
  await Promise.all(
    [...new Set(Object.values(packFile))]
      .filter((file) => file !== "en")
      .map((file) => ensureLocale(file)),
  );
}

// Vitest replaces MODE with "test"; production builds drop this branch, so
// only English stays in the startup chunk there.
if (import.meta.env.MODE === "test") {
  await ensureAllLocales();
}
