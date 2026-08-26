export function buildEffectivePermissionSummary(rolePermissions = [], userPermissions = []) {
  const merged = new Map();

  for (const permission of rolePermissions) {
    merged.set(permission.permission_name, {
      permission_name: permission.permission_name,
      module_name: permission.module_name || "General",
      is_allowed: permission.is_allowed !== false,
      source: "role",
    });
  }

  for (const permission of userPermissions) {
    merged.set(permission.permission_name, {
      permission_name: permission.permission_name,
      module_name: permission.module_name || "General",
      is_allowed: permission.is_allowed !== false,
      source: "user",
    });
  }

  const permissions = Array.from(merged.values()).sort((a, b) => a.permission_name.localeCompare(b.permission_name));
  const modules = [...new Set(permissions.map((item) => item.module_name))].sort();

  return {
    permissions,
    summary: {
      totalPermissions: permissions.length,
      allowedPermissions: permissions.filter((item) => item.is_allowed).length,
      deniedPermissions: permissions.filter((item) => !item.is_allowed).length,
      modules,
    },
  };
}

export function hasPermission(permissions, permissionName) {
  const permission = permissions.find((item) => item.permission_name === permissionName);
  return permission ? permission.is_allowed : false;
}
