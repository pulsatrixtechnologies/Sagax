/** Who someone is in an organization: the operator at this computer (owner),
 * an admin, or a member. Shared so the client does not import it from the
 * server. */
export type OrgRole = "owner" | "admin" | "member";
