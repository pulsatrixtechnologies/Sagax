// The safety net for a newer app against an older server (2026-10-28): that
// server answers a route it does not know with 404 "no route: METHOD /path".
// The text is a debugging line, never something to show a person: wherever
// it would reach the screen (an ApiError's message, the error banner), the
// neutral, translated "Available after the server update." takes its place.
import { t } from "@/lib/i18n";

const NO_ROUTE = /^no route: [A-Z]+ \S/;

export function isNoRouteText(text: unknown): boolean {
  return typeof text === "string" && NO_ROUTE.test(text.trim());
}

/** The text to show for a server message: the neutral line for a "no route". */
export function neutralNoRoute(text: string): string {
  return isNoRouteText(text) ? t("serverRoute.needsUpdate") : text;
}
