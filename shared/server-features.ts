// What a server can do, by name, for an app that may be newer than it
// (2026-10-28). The desktop and the phone draw an organization server they
// did not ship with: a newer app against an older server must not call a
// route that server does not have, or show its "no route" answer.
//
// The server lists the features it serves in its public descriptor
// (`capabilities.features`, server/environment.ts). A feature in this list
// that a server does not name is missing there. A server from before this
// list names nothing: the app then reads the feature from what it already
// gets (the routines listing carries `folders` only where folders exist) or
// from the answer of the call itself ("no route", or the admin-scope refusal
// of a member route that server did not yet open to members). Never the
// server's `version`: it is the base version, the same on every release.
//
// Each entry names the routes the app calls for it. Add one whenever the app
// calls a new route, so the next older server says "after the update"
// instead of failing.
export const SERVER_FEATURES = {
  /** Routine folders (#1442): POST /api/routines/folders, `folders` on GET /api/routines. */
  routineFolders: ["POST /api/routines/folders"],
  /** A person's own voice keys (#1453): GET /api/me/voice-keys, PUT/DELETE /api/me/voice-keys/:provider. */
  personalVoiceKeys: ["GET /api/me/voice-keys", "PUT /api/me/voice-keys/:provider", "DELETE /api/me/voice-keys/:provider"],
  /** A member's own display choices and Experimental switches (#1453): /api/me/experimental without an admin. */
  memberPersonSettings: ["GET /api/me/experimental", "PATCH /api/me/experimental"],
  /** A member reads their bot's sends of the day (#1453). */
  memberOutbound: ["GET /api/bots/:id/outbound"],
  /** The person's task list of a bot (#1331, 0.8.6). */
  botTaskList: ["GET /api/bots/:id/task-list", "POST /api/bots/:id/task-list"],
  /** A member's background brief of their own bot (#1428). */
  memberBackgroundBrief: ["GET /api/bots/:id/background-brief", "PUT /api/bots/:id/background-brief"],
} as const satisfies Record<string, readonly string[]>;

export type ServerFeature = keyof typeof SERVER_FEATURES;

export const SERVER_FEATURE_NAMES = Object.keys(SERVER_FEATURES) as ServerFeature[];

export function isServerFeature(value: unknown): value is ServerFeature {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SERVER_FEATURES, value);
}
