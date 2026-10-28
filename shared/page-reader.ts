// The reader's view of a published page (2026-10-28): what the wrapper at
// /pages/view/<token> tells its own script (server/published-pages-render.ts
// writes it, src/page-reader/ reads it) and the words of its bar, in French
// and English like the wrapper's other words.
//
// The bar and its tools live in the wrapper, outside the page's frame: the
// page stays in its sandbox (opaque origin, no network), and the wrapper's
// script only reaches this server's own routes with the reader's own rights.
// A reader who is not signed in gets the title, the notice and Download PDF;
// the page's own person also gets Share.
import type { PageKind } from "./published-pages.ts";

export type ReaderLang = "fr" | "en";

/** What the wrapper hands its script, as a JSON block (never run). */
export interface ReaderBoot {
  v: 1;
  lang: ReaderLang;
  title: string;
  kind: PageKind;
  /** The version readers get. */
  version: number;
  /** The page's id, only for a signed-in reader with a right on it (its own
   * person: Share). A reader who is not signed in never gets it. */
  pageId?: string;
  /** The signed-in reader, as the bar names them. */
  me?: { id: string; name: string };
  /** The page's person, as the Share popover names them (Owner). */
  owner?: { name: string };
  can: { share: boolean };
}

/** The id of the JSON block and of the bar's actions. */
export const READER_BOOT_ID = "sagax-reader-boot";
export const READER_ACTIONS_ID = "sagax-reader-actions";

const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;

/** The boot block as the script reads it: checked, or null. Pure. */
export function parseReaderBoot(value: unknown): ReaderBoot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || (record.lang !== "fr" && record.lang !== "en")) return null;
  if (typeof record.title !== "string" || (record.kind !== "html" && record.kind !== "markdown" && record.kind !== "presentation")) return null;
  if (typeof record.version !== "number" || !Number.isSafeInteger(record.version) || record.version < 1) return null;
  const can = record.can && typeof record.can === "object" ? record.can as Record<string, unknown> : {};
  const pageId = typeof record.pageId === "string" && PAGE_ID.test(record.pageId) ? record.pageId : undefined;
  const me = record.me && typeof record.me === "object" ? record.me as Record<string, unknown> : null;
  const owner = record.owner && typeof record.owner === "object" ? record.owner as Record<string, unknown> : null;
  return {
    v: 1,
    lang: record.lang,
    title: record.title,
    kind: record.kind,
    version: record.version,
    ...(pageId ? { pageId } : {}),
    ...(me && typeof me.id === "string" && typeof me.name === "string" ? { me: { id: me.id, name: me.name } } : {}),
    ...(owner && typeof owner.name === "string" ? { owner: { name: owner.name } } : {}),
    // a right without the page's id is no right
    can: { share: can.share === true && Boolean(pageId) },
  };
}

/** The notice the yellow banner used to carry, word for word: who published
 * the page for whom, and that it is not a Sagax screen. Always visible in
 * the bar. Pure. */
export function readerNotice(input: { bot: string; person: string; lang: ReaderLang }): { who: string; warning: string } {
  return input.lang === "fr"
    ? { who: `Page publiée par ${input.bot} pour ${input.person}`, warning: "Ceci n'est pas un écran Sagax, n'y entrez jamais de mot de passe." }
    : { who: `Page published by ${input.bot} for ${input.person}`, warning: "This is not a Sagax screen, never enter a password here." };
}

const STRINGS = {
  en: {
    share: "Share",
    shareTitle: "Share “{title}”",
    add: "Add people or groups",
    people: "Who has access",
    owner: "Owner",
    you: "You",
    someone: "A person of your organization",
    someGroup: "A group of your organization",
    remove: "Remove {name}",
    group: "Group · {count} people",
    noMatch: "No one matches.",
    general: "General access",
    invited: "People you invite",
    invitedHint: "Only you and the people or groups you add.",
    onlyYou: "Only me",
    onlyYouHint: "Only you, signed in to this server.",
    org: "Anyone in your organization",
    orgHint: "People signed in to this server.",
    link: "Anyone with the link",
    linkHint: "Anyone who has the link, without signing in.",
    linkOff: "Turned off by your organization.",
    linkConfirm: "Anyone with the link will see this page, without signing in. Confirm to switch it to a public link.",
    confirm: "Share with anyone with the link",
    cancel: "Cancel",
    copy: "Copy link",
    copied: "Copied",
    close: "Close",
    failed: "That did not work. Try again.",
    linkOffError: "Your organization turned off public links. Choose Anyone in your organization instead.",
    info: "About this page",
  },
  fr: {
    share: "Partager",
    shareTitle: "Partager « {title} »",
    add: "Ajouter des personnes ou des groupes",
    people: "Qui a accès",
    owner: "Propriétaire",
    you: "Vous",
    someone: "Une personne de votre organisation",
    someGroup: "Un groupe de votre organisation",
    remove: "Retirer {name}",
    group: "Groupe · {count} personnes",
    noMatch: "Personne ne correspond.",
    general: "Accès général",
    invited: "Personnes invitées",
    invitedHint: "Vous seul et les personnes ou groupes ajoutés.",
    onlyYou: "Moi seulement",
    onlyYouHint: "Vous seulement, connecté à ce serveur.",
    org: "Toute votre organisation",
    orgHint: "Les personnes connectées à ce serveur.",
    link: "Toute personne ayant le lien",
    linkHint: "Quiconque a le lien, sans se connecter.",
    linkOff: "Désactivé par votre organisation.",
    linkConfirm: "Toute personne ayant le lien verra cette page, sans se connecter. Confirmez pour la passer en lien public.",
    confirm: "Partager avec toute personne ayant le lien",
    cancel: "Annuler",
    copy: "Copier le lien",
    copied: "Copié",
    close: "Fermer",
    failed: "Ça n'a pas fonctionné. Réessayez.",
    linkOffError: "Votre organisation a désactivé les liens publics. Choisissez plutôt Toute votre organisation.",
    info: "À propos de cette page",
  },
} as const;

export type ReaderStringKey = keyof typeof STRINGS.en;

/** One word of the bar, with its {placeholders} filled. Pure. */
export function readerText(lang: ReaderLang, key: ReaderStringKey, values: Record<string, string> = {}): string {
  const text: string = (STRINGS[lang] as Record<ReaderStringKey, string>)[key] ?? STRINGS.en[key];
  return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Every key has both languages (the tests read this). */
export const READER_STRING_KEYS = Object.keys(STRINGS.en) as ReaderStringKey[];
export const READER_STRINGS_FR_KEYS = Object.keys(STRINGS.fr) as ReaderStringKey[];
