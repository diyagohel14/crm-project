import test from "node:test";
import assert from "node:assert/strict";
import { buildEffectivePermissionSummary } from "../services/permissionService.js";

test("buildEffectivePermissionSummary applies user overrides over role defaults", () => {
  const rolePermissions = [
    { permission_name: "users:view", module_name: "Users", is_allowed: true },
    { permission_name: "roles:view", module_name: "Roles", is_allowed: true },
  ];

  const userPermissions = [
    { permission_name: "users:view", module_name: "Users", is_allowed: false },
  ];

  const result = buildEffectivePermissionSummary(rolePermissions, userPermissions);

  assert.equal(result.permissions.length, 2);
  assert.equal(result.permissions.find((item) => item.permission_name === "users:view").is_allowed, false);
  assert.equal(result.permissions.find((item) => item.permission_name === "roles:view").is_allowed, true);
  assert.equal(result.summary.totalPermissions, 2);
  assert.equal(result.summary.modules.length, 2);
});
