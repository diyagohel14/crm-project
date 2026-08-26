// services/authService.js
//
// The login flow you described:
//   1. Look up the email in the Admin DB's global_users -> get company_id
//   2. Look up companies -> get that company's DB connection info
//   3. Connect to the company DB and verify the password there
//   4. Return everything the session needs to remember

import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { verifyPassword } from "../utils/password.js";
import { buildEffectivePermissionSummary } from "./permissionService.js";


////////Auth module start/////////////////
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

export async function Authlogin(loginValue, plainPassword, ipAddress, deviceInfo) {
  // ---- 1. Routing lookup in the Admin DB ----
  const routeResult = await adminPool.query(
    `SELECT global_user_id, company_id, status, email, phone
       FROM global_users
      WHERE (email = $1 OR phone = $1) AND is_deleted = FALSE AND status = 'active'`,
    [loginValue]
  );
  const route = routeResult.rows[0];

  if (!route) throw new AuthError("Invalid email/phone or password");
  if (route.status !== "active") throw new AuthError("This account is inactive");

  // ---- 2 & 3. Connect to the tenant's own DB and verify credentials ----
  const companyPool = await getCompanyPool(route.company_id); // throws if company inactive/deleted

  const userResult = await companyPool.query(
    `SELECT user_id, first_name, last_name, email, phone, password, status, role_id
       FROM users
      WHERE (email = $1 OR phone = $1) AND is_deleted = FALSE AND status = 'active'`,
    [loginValue]
  );
  const user = userResult.rows[0];

  if (!user) throw new AuthError("Invalid email/phone or password");
  if (user.status !== "active") throw new AuthError("This user account is not active");

  let effectivePermissions = buildEffectivePermissionSummary([], []);

  try {
    const rolePermissionsResult = await companyPool.query(
      `SELECT rp.is_allowed, p.permission_name, p.module_name
         FROM role_permissions rp
         JOIN permissions p ON p.permission_id = rp.permission_id
         WHERE rp.role_id = $1 AND rp.company_id = $2 AND p.status = TRUE AND p.company_id = $2`,
      [user.role_id, route.company_id]
    );

    const userPermissionsResult = await companyPool.query(
      `SELECT up.is_allowed, p.permission_name, p.module_name
         FROM user_permissions up
         JOIN permissions p ON p.permission_id = up.permission_id
         WHERE up.user_id = $1 AND up.company_id = $2 AND p.status = TRUE AND p.company_id = $2`,
      [user.user_id, route.company_id]
    );

    effectivePermissions = buildEffectivePermissionSummary(
      rolePermissionsResult.rows,
      userPermissionsResult.rows
    );
  } catch (permError) {
    console.warn("[authService] Permission lookup failed; continuing with empty permission set", permError.message);
  }

  const passwordMatches = await verifyPassword(plainPassword, user.password);
  if (!passwordMatches) {
    await loginlogAudit(companyPool, {
      userId: null,
      roleId: null,
      companyId: route.company_id,
      login_status: "failed",
      deviceInfo: deviceInfo,
      IpAddress: ipAddress
    });
    throw new AuthError("Invalid email/phone or password");
  }

  let currentFinancialYearId = null;
  try {
    const fyResult = await companyPool.query(
      `SELECT financial_year_id FROM financial_years WHERE is_current = TRUE AND is_deleted = FALSE LIMIT 1`
    );
    currentFinancialYearId = fyResult.rows[0]?.financial_year_id ?? null;
  } catch (fyErr) {
    console.warn("[authService] failed to load current financial year", fyErr.message);
  }

  // ---- housekeeping: last_login + audit log (best-effort, non-fatal) ----
  await companyPool
    .query(`UPDATE users SET last_login = now() WHERE user_id = $1`, [user.user_id])
    .catch((e) => console.error("[authService] failed to update last_login", e));

  await loginlogAudit(companyPool, {
    userId: user.user_id,
    roleId: user.role_id,
    companyId: route.company_id,
    login_status: "success",
    deviceInfo: deviceInfo,
    IpAddress: ipAddress
  }).catch((e) => console.error("[authService] failed to write audit log", e));

  return {
    userId: user.user_id,
    companyId: route.company_id,
    roleId: user.role_id,
    email: user.email,
    phone: user.phone,
    fullName: [user.first_name, user.last_name].filter(Boolean).join(" "),
    permissions: effectivePermissions.permissions,
    permissionSummary: effectivePermissions.summary,
    financialYearId: currentFinancialYearId,
  };
}

async function loginlogAudit(companyPool, { userId, roleId, companyId, login_status, deviceInfo, IpAddress }) {
  await companyPool.query(
    `INSERT INTO login_audit_logs (user_id, role_id, company_id, login_status, device_info, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, roleId, companyId, login_status, deviceInfo, IpAddress]
  );
}

////////Auth module end/////////////////

////////Permission module Start/////////////////
export async function getOrCreatePermission(client, companyId, permissionName, moduleName, userId) {
  const existing = await client.query(
    `SELECT permission_id FROM permissions WHERE company_id = $1 AND permission_name = $2`,
    [companyId, permissionName]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].permission_id;
  }

  const inserted = await client.query(
    `INSERT INTO permissions (permission_name, module_name, status, user_id, company_id)
     VALUES ($1, $2, TRUE, $3, $4)
     RETURNING permission_id`,
    [permissionName, moduleName || "General", userId, companyId]
  );

  return inserted.rows[0].permission_id;
}

export async function setPermissionAssignments(client, companyId, targetId, permissionEntries, tableName, idColumnName, assignmentColumnName, userId, userIdCoumnName) {
  const assignments = [];

  for (const entry of permissionEntries) {
    const permissionName = entry.permissionName || entry.permission_name;
    const moduleName = entry.moduleName || entry.module_name || "General";
    let isAllowed = entry.isAllowed ?? entry.is_allowed ?? true;

    if (!permissionName) continue;

    const permissionId = await getOrCreatePermission(client, companyId, permissionName, moduleName, userId);

    const existing = await client.query(
      `SELECT 1 FROM ${tableName} WHERE ${idColumnName} = $1 AND permission_id = $2 AND company_id = $3`,
      [targetId, permissionId, companyId]
    );

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE ${tableName}
         SET is_allowed = $1, ${userIdCoumnName} = $2
         WHERE ${idColumnName} = $3 AND permission_id = $4 AND company_id = $5`,
        [isAllowed, userId, targetId, permissionId, companyId]
      );
    } else {
      await client.query(
        `INSERT INTO ${tableName} (${idColumnName}, permission_id, is_allowed, ${userIdCoumnName}, company_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetId, permissionId, isAllowed, userId, companyId]
      );
    }

    assignments.push({ permissionName, moduleName, isAllowed: isAllowed });
  }
  return assignments;
}

////////Permission module End/////////////////


/////////////Common Function start//////////////////
export async function logAudit(companyPool, { module_name, page_name, table_name, table_id, action_type, action_description, new_value, user_id, role_id, ip_address, device_info, company_id }) {
  await companyPool.query(
    `INSERT INTO audit_logs (module_name, page_name, table_name, table_id, action_type, action_description, new_value, user_id, role_id, ip_address, device_info, company_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [module_name, page_name, table_name, table_id, action_type, action_description, new_value, user_id, role_id, ip_address, device_info, company_id]
  )
}

/////////////Common Function end//////////////////