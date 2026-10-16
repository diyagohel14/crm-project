// middleware/authMiddleware.js
import { getCompanyPool } from "../config/companyPoolManager.js";
import { buildEffectivePermissionSummary, hasPermission } from "../services/permissionService.js";
import jwt from "jsonwebtoken";
import { getAppConfig } from "../utils/env.js";
import { isTokenRevoked } from "../utils/tokenRevocation.js";

const config = getAppConfig();

/** Blocks the request unless a valid company JWT belongs to an active tenant user. */
export async function requireAuth(req, res, next) {
  const authorization = req.get("authorization");
  const [scheme, token] = authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Bearer token required" });
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    if (isTokenRevoked(req.user.jti)) {
      return res.status(401).json({ error: "Token has been logged out" });
    }
  } catch (err) {
    return res.status(401).json({
      error: err.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
    });
  }

  if (!Number.isInteger(req.user.userId) || req.user.userId <= 0
      || !Number.isInteger(req.user.companyId) || req.user.companyId <= 0) {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const companyPool = req.companyPool ?? await getCompanyPool(req.user.companyId);
    const userResult = await companyPool.query(
      "SELECT 1 FROM users WHERE user_id = $1 AND company_id = $2 AND status = 'active' AND is_deleted = FALSE",
      [req.user.userId, req.user.companyId]
    );
    if (!userResult.rows.length) return res.status(401).json({ error: "User account is inactive" });
  } catch (err) {
    console.error("[requireAuth] failed to verify tenant user status", err);
    return res.status(503).json({ error: "Unable to verify user account status" });
  }

  req.authToken = token;
  // Keep legacy controllers compatible without storing the current user
  // on the shared express-session object.
  if (req.session) {
    const session = req.session;
    req.session = new Proxy(session, {
      get(target, property, receiver) {
        if (property === "user") return req.user;
        return Reflect.get(target, property, receiver);
      },
      set(target, property, value, receiver) {
        if (property === "user") return true;
        return Reflect.set(target, property, value, receiver);
      },
    });
  }

  next();
}

/**
 * Attaches req.companyPool (the tenant's pg.Pool) so downstream route
 * handlers don't need to re-derive it. Use after requireAuth.
 */
export async function attachCompanyPool(req, res, next) {
  try {
    req.companyPool = await getCompanyPool(req.user.companyId);
    next();
  } catch (err) {
    console.error("[attachCompanyPool]", err);
    res.status(500).json({ error: "Failed to connect to company database", detail: err.message });
  }
}

/** Simple role gate, e.g. requireRole([1]) for "only role_id 1 (Super Admin)". */
export function requireRole(allowedRoleIds) {
  return (req, res, next) => {
    if (!allowedRoleIds.includes(req.user.roleId)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

export function requirePermission(permissionName) {
  return async (req, res, next) => {
    try {
      const companyPool = await getCompanyPool(req.user.companyId);
      const [rolePermissionsResult, userPermissionsResult] = await Promise.all([
        companyPool.query(
          `SELECT rp.is_allowed, p.permission_name, p.module_name
             FROM role_permissions rp
             JOIN permissions p ON p.permission_id = rp.permission_id
            WHERE rp.role_id = $1 AND rp.company_id = $2
              AND p.status = TRUE AND p.company_id = $2`,
          [req.user.roleId, req.user.companyId]
        ),
        companyPool.query(
          `SELECT up.is_allowed, p.permission_name, p.module_name
             FROM user_permissions up
             JOIN permissions p ON p.permission_id = up.permission_id
            WHERE up.user_id = $1 AND up.company_id = $2
              AND p.status = TRUE AND p.company_id = $2`,
          [req.user.userId, req.user.companyId]
        ),
      ]);

      const effectivePermissions = buildEffectivePermissionSummary(
        rolePermissionsResult.rows,
        userPermissionsResult.rows
      );
      req.user.permissions = effectivePermissions.permissions;
      req.user.permissionSummary = effectivePermissions.summary;

      if (!hasPermission(req.user.permissions, permissionName)) {
        return res.status(403).json({ error: `Missing required permission: ${permissionName}` });
      }

      next();
    } catch (err) {
      console.error("[requirePermission]", err);
      return res.status(500).json({ error: "Failed to load permissions" });
    }
  };
}
