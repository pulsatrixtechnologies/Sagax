// The latest local health report. Any signed-in person can read it.
// The scanner is a separate process. This route only reads the file it wrote.
import { PASS, type RouteHandler } from "./table.ts";

export const HEALTH_REPORT_PATH = "/api/me/health-report";

export function createHealthReportRoutes(deps: { read(): string | null }): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (!(method === "GET" && path === HEALTH_REPORT_PATH)) return PASS;
    res.setHeader("cache-control", "no-store");
    const report = deps.read();
    if (!report) return json(res, 200, { report: null });
    return json(res, 200, { report });
  };
}
