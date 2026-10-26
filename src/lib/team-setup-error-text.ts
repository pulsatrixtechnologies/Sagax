// "Apply setup" refused (#1058): the server's code, said in the app's language.
import { t } from "@/lib/i18n";
import { TEAM_SETUP_ADMIN_REQUIRED, TEAM_SETUP_DESKTOP_ONLY } from "../../shared/team-setup";

export function teamSetupErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  if (code === TEAM_SETUP_ADMIN_REQUIRED) return t("teamSetup.error.adminRequired");
  if (code === TEAM_SETUP_DESKTOP_ONLY) return t("teamSetup.error.desktopOnly");
  return null;
}
