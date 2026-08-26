// middleware/authMiddleware.js
import { getCompanyPool } from "../config/companyPoolManager.js";
import { hasPermission } from "../services/permissionService.js";

/** Blocks the request unless a valid session exists. */
export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

/**
 * Attaches req.companyPool (the tenant's pg.Pool) so downstream route
 * handlers don't need to re-derive it. Use after requireAuth.
 */
export async function attachCompanyPool(req, res, next) {
  try {
    req.companyPool = await getCompanyPool(req.session.user.companyId);
    next();
  } catch (err) {
    console.error("[attachCompanyPool]", err);
    res.status(500).json({ error: "Failed to connect to company database", detail: err.message });
  }
}

/** Simple role gate, e.g. requireRole([1]) for "only role_id 1 (Super Admin)". */
export function requireRole(allowedRoleIds) {
  return (req, res, next) => {
    if (!allowedRoleIds.includes(req.session.user.roleId)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

export function requirePermission(permissionName) {
  return (req, res, next) => {
    if (!req.session?.user?.permissions) {
      return res.status(403).json({ error: "Permissions not loaded for this session" });
    }

    if (!hasPermission(req.session.user.permissions, permissionName)) {
      return res.status(403).json({ error: `Missing required permission: ${permissionName}` });
    }

    next();
  };
}
