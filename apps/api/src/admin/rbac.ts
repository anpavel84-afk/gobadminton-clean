export const ADMIN_ROLES = [
  "superadmin",
  "content_manager",
  "moderator",
  "support",
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
// Scoped capabilities deliberately have distinct keys; they never imply global authority.
export const ROLE_PERMISSIONS = {
  superadmin: [
    "identity.manage",
    "venue.manage",
    "venue.merge",
    "content.manage",
    "game.moderate",
    "game.force_cancel",
    "user.restrict",
    "user.lookup",
    "consumer_session.revoke",
    "case.manage",
    "evidence.read",
    "audit.security.read",
    "audit.content.read",
    "audit.moderation.read",
    "audit.assigned.read",
    "evidence.case.read",
    "consumer_session.case.revoke",
    "case.assigned.manage",
    "evidence.assigned.read",
  ],
  content_manager: [
    "venue.manage",
    "venue.merge",
    "content.manage",
    "audit.content.read",
  ],
  moderator: [
    "game.moderate",
    "game.force_cancel",
    "user.restrict",
    "user.lookup",
    "consumer_session.revoke",
    "case.manage",
    "evidence.case.read",
    "audit.moderation.read",
  ],
  support: [
    "user.lookup",
    "consumer_session.case.revoke",
    "case.assigned.manage",
    "evidence.assigned.read",
    "audit.assigned.read",
  ],
} as const satisfies Record<AdminRole, readonly string[]>;
export type AdminPermission = (typeof ROLE_PERMISSIONS)[AdminRole][number];
export function hasPermission(
  roles: readonly AdminRole[],
  permission: AdminPermission,
): boolean {
  return roles.some((role) =>
    (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission),
  );
}
export const ADMIN_COOKIE = "__Host-gb_admin_session";
export const ADMIN_TICKET_COOKIE = "__Host-gb_admin_mfa";
export const ADMIN_BINDING_COOKIE = "__Host-gb_admin_binding";
export const ADMIN_AUDIENCE = "gobadminton-admin";
