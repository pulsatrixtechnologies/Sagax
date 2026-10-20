// Views in the chat only on request (JC 2026-10-20: « je veux pas de widget
// qui pop dans le chat pour aucune raison ; ça doit fitter avec ce qu'on
// demande »). One rule for every client: a view (a ConnectWise widget, a
// video player, a settled screenshot) that a TOOL RESULT would add on its
// own appears only when the person's message of that turn asked for that
// kind of view. Views the bot writes itself (```chart, ```csv, ```widget,
// ```cw, show_widget) follow the same rule through the system prompt
// (RICH_OUTPUT_PROMPT, WIDGET_PROMPT). Approval cards, connection cards and
// attachments the person asked for are not views and are never held back.
//
// The server applies it when a row is created (server/index.ts) and marks
// the rows it lets through `requested: true`; clients draw a video or screen
// row only with that mark, so rows stored before this rule stay hidden.

export type RequestedView = "view" | "video" | "screen";

const ASKS: Record<RequestedView, RegExp> = {
  // an interactive view, a widget, a chart, a card, a dashboard
  view: /\b(?:widgets?|vues? interactives?|interactive (?:views?|tables?|cards?)|tableaux? interactifs?|(?:graph|chart|graphique|diagramme|dashboard|tableau de bord)s?|cartes? interactives?|show (?:it |them )?(?:as|in) (?:a )?(?:view|card|widget|table)|affiche[- ](?:le|la|les|moi)? ?(?:en|dans une?) (?:vue|carte|widget|tableau))\b/iu,
  // a video, a stream, a recording to watch
  video: /\b(?:vid[ée]os?|videos?|play|plays|joue|jouer|lance la (?:vid[ée]o|diffusion)|regarde[rz]?|watch|stream(?:ing)?|diffusions?|en direct|live stream|enregistrements?|recordings?)\b/iu,
  // the computer's screen
  screen: /\b(?:screenshots?|screen ?shots?|captures? d['’]?[ée]cran|capture l['’]?[ée]cran|(?:montre|affiche|show)[- ](?:moi |me )?(?:l['’]|the |ton |your |my |mon )?(?:[ée]cran|screen)|what(?:'s| is) on (?:the |my |your )?screen|(?:voir|see) (?:l['’]|the |ton |your )?(?:[ée]cran|screen))\b/iu,
};

/** True when the person's message asks for that kind of view. */
export function askedForView(text: string | undefined | null, kind: RequestedView): boolean {
  if (!text) return false;
  return ASKS[kind].test(text.normalize("NFC"));
}
