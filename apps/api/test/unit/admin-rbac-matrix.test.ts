import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  ROLE_PERMISSIONS,
  hasPermission,
  type AdminPermission,
  type AdminRole,
} from "../../src/admin/rbac";

// Frozen reviewed universe: independent of the implementation's role lists.
const permissions = [
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
] as const satisfies readonly AdminPermission[];
const lesserRoleAllowlists = {
  content_manager: [
    "venue.manage", "venue.merge", "content.manage", "audit.content.read",
  ],
  moderator: [
    "game.moderate", "game.force_cancel", "user.restrict", "user.lookup",
    "consumer_session.revoke", "case.manage", "evidence.case.read",
    "audit.moderation.read",
  ],
  support: [
    "user.lookup", "consumer_session.case.revoke", "case.assigned.manage",
    "evidence.assigned.read", "audit.assigned.read",
  ],
} as const satisfies Record<Exclude<AdminRole, "superadmin">, readonly AdminPermission[]>;

const expected: Record<AdminRole, readonly AdminPermission[]> = {
  superadmin: permissions,
  ...lesserRoleAllowlists,
};

describe("A0A-QA-001 exhaustive fixed RBAC matrix", () => {
  it("pins four roles and the 19 defined permissions without duplicates or wildcards", () => {
    expect(ADMIN_ROLES).toEqual(["superadmin", "content_manager", "moderator", "support"]);
    expect(Object.keys(ROLE_PERMISSIONS)).toEqual([...ADMIN_ROLES]);
    expect(permissions).toHaveLength(19);
    expect([...new Set(Object.values(ROLE_PERMISSIONS).flat())].sort()).toEqual([...permissions].sort());
    for (const role of ADMIN_ROLES) {
      const actual = [...ROLE_PERMISSIONS[role]];
      expect(actual.length).toBe(new Set(actual).size);
      expect(actual.sort()).toEqual([...expected[role]].sort());
    }
  });
  for (const role of ADMIN_ROLES) {
    for (const permission of permissions) {
      const allowed = expected[role].includes(permission);
      it(`${role} ${allowed ? "allows" : "denies"} ${permission}`, () => {
        expect(hasPermission([role], permission)).toBe(allowed);
      });
    }
  }
  it("preserves exact additive grants for every combination, including no roles", () => {
    for (let mask = 0; mask < 1 << ADMIN_ROLES.length; mask++) {
      const roles = ADMIN_ROLES.filter((_, i) => mask & (1 << i));
      for (const permission of permissions) {
        expect(hasPermission(roles, permission)).toBe(
          roles.some(role => expected[role].includes(permission)),
        );
      }
    }
  });
  it("does not automatically grant unknown or future permission keys", () => {
    for (const role of ADMIN_ROLES) {
      for (const permission of ["*", "audit.future.read", "future.manage"]) {
        expect(hasPermission([role], permission as AdminPermission)).toBe(false);
      }
    }
  });
});
