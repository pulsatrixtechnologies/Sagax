/** Sagax has no connector that can post, reply, or open an audio space on X.
 * A catalog name is not a send path. Callers get a refusal, never a
 * pretend success, and the product shows no button for it. */

export const X_SOCIAL_HOLE = "no_x_connector" as const;

export interface XSocialRefusal {
  ok: false;
  code: typeof X_SOCIAL_HOLE;
  missing: "messages" | "spaces";
}

export function xSocialUnavailable(missing: XSocialRefusal["missing"]): XSocialRefusal {
  return { ok: false, code: X_SOCIAL_HOLE, missing };
}
