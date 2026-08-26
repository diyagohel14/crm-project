// controllers/authController.js
import { Authlogin, AuthError, logAudit, getOrCreatePermission, setPermissionAssignments } from "../services/authService.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getRequestInfo } from "../utils/crypto.js";
import { getNextSeries } from "../services/seriesService.js"
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";

////////Auth module start/////////////////
export async function loginController(req, res) {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: "Email/phone and password are required" });
  }

  try {
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    const sessionUser = await Authlogin(
      login,
      password,
      ipAddress,
      deviceInfo
    );
    // ---- Store the important bits in the session ----
    // Deliberately NOT storing db credentials here - only IDs. The
    // actual pg.Pool is looked up from companyPoolManager's cache (or
    // rebuilt from the Admin DB) on each request that needs it.
    req.session.user = {
      userId: sessionUser.userId,
      companyId: sessionUser.companyId,
      roleId: sessionUser.roleId,
      email: sessionUser.email,
      phone: sessionUser.phone,
      fullName: sessionUser.fullName,
      permissions: sessionUser.permissions,
      permissionSummary: sessionUser.permissionSummary,
      financialYearId: sessionUser.financialYearId,
      ipAddress: ipAddress,
      deviceInfo: deviceInfo
    };
    // console.log("Session user set:", req.session.user);
    return res.json({ message: "Login successful", user: req.session.user });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({ error: err.message });
    }
    console.error("[loginController]", err);
    return res.status(500).json({ error: "Login failed", detail: err.message });
  }
}

export function logoutController(req, res) {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Failed to log out" });
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out" });
  });
}



export async function meController(req, res) {
  const { companyId } = req.session.user;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    const result = await client.query(
      `SELECT * FROM tbl_company_profile WHERE company_id = $1`,
      [companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company profile not found" });
    }

    const bankResult = await client.query(
      `SELECT * FROM tbl_company_bank_detail WHERE company_id = $1 AND company_profile_id = $2`,
      [companyId, result.rows[0].company_profile_id]
    );

    res.json({
      profile_details: result.rows[0],
      bank_details: bankResult.rows[0] ?? null,
      session_user: {
        userId: req.session.user.userId,
        companyId: req.session.user.companyId,
        roleId: req.session.user.roleId,
        email: req.session.user.email,
        fullName: req.session.user.fullName,
        permissionSummary: req.session.user.permissionSummary,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load profile", detail: err.message });
  } finally {
    client.release();
  }
}

export async function updatemeController(req, res) {
  const { companyId, userId, roleId } = req.session.user;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    await client.query("BEGIN");

    const { ipAddress, deviceInfo } = getRequestInfo(req);
    const {
      company_name, trade_name, logo, registration_number, gst_no, pan_no, phone, email, website, contact_name,
      address_line1, address_line2, city_id, state_id, country_id, pincode, authorized_signature,
      bank_id, account_holder_name, account_no, ifsc_code, swift_code, branch_name, upi_no, opening_balance
    } = req.body;

    const fields = {
      company_name, trade_name, logo, registration_number, gst_no, pan_no, phone, email, website, contact_name,
      address_line1, address_line2, city_id, state_id, country_id, pincode, authorized_signature,

    };
    const updates = [];
    const params = [];

    const bank_fields = {
      bank_id, account_holder_name, account_no, ifsc_code, swift_code, branch_name, upi_no, opening_balance,
    };
    const bank_updates = [];
    const bank_params = [];

    Object.entries(fields).forEach(([key, value], index) => {
      if (value !== undefined) {
        updates.push(`${key} = $${index + 1}`);
        params.push(value);
      }
    });

    Object.entries(bank_fields).forEach(([key, value], index) => {
      if (value !== undefined) {
        bank_updates.push(`${key} = $${index + 1}`);
        bank_params.push(value);
      }
    });
    if (updates.length === 0 && bank_updates.length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    params.push(companyId);
    bank_params.push(companyId);

    const query = `UPDATE tbl_company_profile SET ${updates.join(", ")} WHERE company_id = $${params.length} RETURNING *`;
    const result = await client.query(query, params);


    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    const company_profile_id = result.rows[0].company_profile_id;
    bank_params.push(company_profile_id);

    await logAudit(companyPool, {
      module_name: "Company",
      page_name: "Company Profile",
      table_name: "tbl_company_profile",
      table_id: company_profile_id,
      action_type: "UPDATE",
      action_description: "Company profile updated",
      new_value: JSON.stringify(result.rows[0]),
      user_id: userId,
      role_id: roleId,
      ip_address: ipAddress,
      device_info: deviceInfo,
      company_id: companyId
    });

    if (bank_updates.length > 0) {
      const bank_query = `UPDATE tbl_company_bank_detail SET ${bank_updates.join(", ")} WHERE company_id = $${bank_params.length - 1} and company_profile_id = $${bank_params.length} RETURNING *`;
      const bank_result = await client.query(bank_query, bank_params);
      if (bank_result.rows.length === 0) {
        return res.status(404).json({ error: "Bank details not found" });
      }

      await adminPool.query(
        `UPDATE companies SET company_name = $1, company_email = $2, gst_no = $3, phone = $4, address = $5, updated_at = NOW() WHERE company_id = $6 RETURNING *`,
        [company_name, email, gst_no, phone, address_line1, companyId]
      );

      await logAudit(companyPool, {
        module_name: "Company",
        page_name: "Company Bank Details",
        table_name: "tbl_company_bank_detail",
        table_id: bank_result.rows[0].comp_bank_id,
        action_type: "UPDATE",
        action_description: "Company bank details updated",
        new_value: JSON.stringify(bank_result.rows[0]),
        user_id: userId,
        role_id: roleId,
        ip_address: ipAddress,
        device_info: deviceInfo,
        company_id: companyId
      });

      await client.query("COMMIT");
      return res.json({ message: "Profile and bank details updated successfully", profile_details: result.rows[0], bank_details: bank_result.rows[0] });
    }

    await client.query("COMMIT");
    return res.json({ message: "Profile updated successfully", profile_details: result.rows[0], bank_details: null });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to load profile", detail: err.message });
  } finally {
    client.release();
  }
}

////////Auth module end/////////////////

////////User module start/////////////////
export async function viewUser(req, res) {
  const { companyId } = req.session.user;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    const result = await client.query(
      `SELECT user_id, first_name, last_name, email, phone, status, role_id, department_id
       FROM users
       WHERE company_id = $1 AND is_deleted = FALSE`,
      [companyId]
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error("[viewUser]", err);
    return res.status(500).json({ error: "Failed to show sub-user", detail: err.message });
  } finally {
    client.release();
  }
}
/**
 * Superuser (or any permitted role) creates a sub-user under the same
 * company. Requires requireAuth middleware to have run first.
 */
export async function createSubUser(req, res) {
  const { firstName, lastName, phone, email, password, roleId, departmentId } = req.body;
  const { companyId, userId, financialYearId } = req.session.user;

  // console.log(req.session.user);
  if (!firstName || !phone || !email || !password || !roleId) {
    return res.status(400).json({ error: "firstName, email, phone, password and roleId are required" });
  }

  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  const { ipAddress, deviceInfo } = getRequestInfo(req);

  try {
    await client.query("BEGIN");

    const employeeSeries = await getNextSeries(companyPool,{
        documentTypeId:DOCUMENT_TYPES.EMPLOYEE,
        companyId,
        userId,
        financialYearId
    });

    const passwordHash = await hashPassword(password);
    const userResult = await client.query(
      `INSERT INTO users
         (employee_id, first_name, last_name, email, username, password, phone, status, is_email_verified, company_id, role_id, department_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active', FALSE, $8, $9, $10)
       RETURNING *`,
      [employeeSeries.series, firstName, lastName ?? null, email, email, passwordHash, phone, companyId, roleId, departmentId ?? null]
    );

    await adminPool.query(
      `INSERT INTO global_users (email, username, phone, company_id, status) VALUES ($1,$2,$3,$4,'active')`,
      [email, email, phone, companyId]
    );

    await logAudit(companyPool, {
      module_name: "User",
      page_name: "User Profile",
      table_name: "users",
      table_id: userResult.rows[0].user_id,
      action_type: "CREATE",
      action_description: "New User Created",
      new_value: JSON.stringify(userResult.rows[0]),
      user_id: userId,
      role_id: req.session.user.roleId,
      ip_address: ipAddress,
      device_info: deviceInfo,
      company_id: companyId,
    });

    await client.query("COMMIT");
    return res.status(201).json({ message: "Sub-user created", userId: userResult.rows[0].user_id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.log(err.code);
    console.log(err.constraint);
    if (err.code === "23505") {
        if (err.constraint === "users_email_key") {
            return res.status(409).json({
                error: "Email already in use"
            });
        }
        if (err.constraint === "users_phone_key") {
            return res.status(409).json({
                error: "Phone number already in use"
            });
        }
        return res.status(409).json({
            error: "Email or phone number already in use"
        });
    }
    // if (err.code === "23505") {
    //   return res.status(409).json({ error: "Email already in use" });
    // }
    console.error("[createSubUser]", err);
    return res.status(500).json({ error: "Failed to create sub-user", detail: err.message });
  } finally {
    client.release();
  }
}

export async function updateSubUser(req, res) {
  const { firstName, lastName, phone, profile_image, status, roleId, departmentId } = req.body;
  const { companyId } = req.session.user;
  const { userId } = req.params;
  // console.log(req.session);
  if (!firstName || !phone || !roleId) {
    return res.status(400).json({ error: "firstName, phone and roleId are required" });
  }
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  const { ipAddress, deviceInfo } = getRequestInfo(req);

  try {
    await client.query("BEGIN");

    const email_result = await client.query(
      `SELECT email FROM users WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId]
    );

    if (email_result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Sub-user not found" });
    }
    const old_email = email_result.rows[0].email;

    const updateResult = await client.query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, profile_image = $4, status = $5, role_id = $6, department_id = $7, updated_at = NOW() WHERE user_id = $8 AND company_id = $9 RETURNING *`,
      [firstName, lastName ?? null, phone, profile_image ?? null, status ?? 'active', roleId, departmentId ?? null, userId, companyId]
    );

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Sub-user not found" });
    }

    await logAudit(client, {
      module_name: "User",
      page_name: "User Profile",
      table_name: "users",
      table_id: updateResult.rows[0].user_id,
      action_type: "UPDATE",
      action_description: "User details updated",
      new_value: JSON.stringify(updateResult.rows[0]),
      user_id: req.session.user.userId,
      role_id: req.session.user.roleId,
      ip_address: ipAddress,
      device_info: deviceInfo,
      company_id: companyId
    });

    await client.query("COMMIT");

    // Only touch the Admin DB routing row once the tenant-DB transaction
    // has actually committed - avoids the two DBs disagreeing if the
    // tenant update rolls back.
    await adminPool
      .query(`UPDATE global_users SET status = $1 WHERE email = $2`, [status ?? "active", old_email])
      .catch((e) => console.error("[updateSubUser] failed to sync global_users status", e));

    return res.json({ message: "Sub-user updated", user: updateResult.rows[0] });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[updateSubUser]", err);
    return res.status(500).json({ error: "Failed to update sub-user", detail: err.message });
  } finally {
    client.release();
  }
}

export async function deleteSubUser(req, res) {
  const { companyId } = req.session.user;
  const { userId } = req.params;

  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  const { ipAddress, deviceInfo } = getRequestInfo(req);

  try {
    await client.query("BEGIN");

    // const deleteResult = await client.query(
    //   `UPDATE users SET is_deleted = TRUE, status = 'inactive', updated_at = NOW() WHERE user_id = $1 AND company_id = $2 RETURNING *`,
    //   [userId, companyId]
    // );

    const deleteResult = await client.query(
      `DELETE FROM users WHERE user_id = $1 AND company_id = $2 RETURNING *;`,
      [userId, companyId]
    )
    if (deleteResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Sub-user not found" });
    }

    await logAudit(client, {
      module_name: "User",
      page_name: "User Profile",
      table_name: "users",
      table_id: deleteResult.rows[0].user_id,
      action_type: "DELETE",
      action_description: "User deleted",
      new_value: JSON.stringify(deleteResult.rows[0]),
      user_id: req.session.user.userId,
      role_id: req.session.user.roleId,
      ip_address: ipAddress,
      device_info: deviceInfo,
      company_id: companyId
    });

    await client.query("COMMIT");

    // Deactivate the Admin-DB routing row only after the tenant-DB
    // delete has actually committed.
    await adminPool
      .query(`DELETE FROM global_users WHERE email = $1`, [deleteResult.rows[0].email])
      // .query(`UPDATE global_users SET is_deleted = TRUE, status = 'inactive' WHERE email = $1`, [deleteResult.rows[0].email])
      .catch((e) => console.error("[deleteSubUser] failed to sync global_users", e));

    return res.json({ message: "Sub-user deleted", user: deleteResult.rows[0] });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[deleteSubUser]", err);
    return res.status(500).json({ error: "Failed to delete sub-user", detail: err.message });
  } finally {
    client.release();
  }
}

export async function changePassword(req, res) {

  const { current_password, new_password } = req.body;

  const { companyId } = req.session.user;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Current and new password are both required" });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters long" });
  }

  const companyPool = await getCompanyPool(companyId);

  try {
    const result = await companyPool.query("SELECT password FROM users WHERE user_id = $1", [req.session.user.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Account not found" });
    }
    if (!(await verifyPassword(current_password, result.rows[0].password))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const passwordHash = await hashPassword(new_password);
    await companyPool.query("UPDATE users SET password = $1, updated_at = NOW() WHERE user_id = $2", [
      passwordHash,
      req.session.user.userId,
    ]);
    res.json({ message: "Password updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update password", detail: err.message });
  }

}
////////User module end/////////////////

////////Roles module start/////////////////
export async function viewRoles(req, res) {
  const { companyId } = req.session.user;
  const companyPool = await getCompanyPool(companyId);
  try {
    const result = await companyPool.query(
      `SELECT * FROM roles WHERE is_deleted = FALSE AND company_id = $1`,
      [companyId]
    );

    return res.status(200).json({ roles: result.rows });

  } catch (err) {
    console.error("[viewRoles]", err);
    return res.status(500).json({ error: "Failed to View Roles", detail: err.message });
  }
}

export async function createRoles(req, res) {
  const { role_name, description } = req.body;
  const { companyId, userId, roleId, financialYearId } = req.session.user;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO roles(role_name, description, company_id) VALUES ($1,$2,$3) RETURNING *`,
      [role_name, description, companyId]
    );

    await logAudit(client, {
      module_name: "Roles",
      page_name: "Create Roles",
      table_name: "roles",
      table_id: result.rows[0].role_id,
      action_type: "CREATE",
      action_description: "Role Created Successfully",
      new_value: JSON.stringify(result.rows[0]),
      user_id: userId,
      role_id: roleId,
      ip_address: ipAddress,
      device_info: deviceInfo,
      company_id: companyId
    });

    await client.query("COMMIT");
    return res.status(201).json({ message: "Role Created Successfully", roles: result.rows[0] });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[createRoles]", err);
    return res.status(500).json({ error: "Failed to Create Roles", detail: err.message });
  } finally {
    client.release();
  }
}

export async function updateRoles(req, res) {
  const { role_name, description } = req.body;
  const { roleId } = req.params;
  const { companyId } = req.session.user;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE roles SET role_name = $1, description = $2 WHERE role_id = $3 AND company_id = $4 AND is_deleted = FALSE RETURNING *`,
      [role_name, description, roleId, companyId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Role not found" });
    }

    await logAudit(client, {
      module_name: "Roles",
      page_name: "Update Roles",
      table_name: "roles",
      table_id: result.rows[0].role_id,
      action_type: "UPDATE",
      action_description: "Role Updated Successfully",
      new_value: JSON.stringify(result.rows[0]),
      user_id: req.session.user.userId,
      role_id: req.session.user.roleId,
      ip_address: ipAddress,
      device_info: deviceInfo,
      company_id: companyId
    });

    await client.query("COMMIT");
    return res.status(200).json({ message: "Role Updated Successfully", roles: result.rows[0] });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[updateRoles]", err);
    return res.status(500).json({ error: "Failed to Update Roles", detail: err.message });
  } finally {
    client.release();
  }
}

export async function deleteRoles(req, res) {
  const { roleId } = req.params;
  const { companyId } = req.session.user;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  try {
    await client.query("BEGIN");

    const inUse = await client.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE role_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [roleId, companyId]
    );
    if (inUse.rows[0].count > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Cannot delete role - users are still assigned to it" });
    }

    const result = await client.query(
      `UPDATE roles SET is_deleted = TRUE WHERE role_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`,
      [roleId, companyId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Role not found" });
    }

    await logAudit(client, {
      module_name: "Roles",
      page_name: "Delete Roles",
      table_name: "roles",
      table_id: result.rows[0].role_id,
      action_type: "DELETE",
      action_description: "Role DELETE Successfully",
      new_value: JSON.stringify(result.rows[0]),
      user_id: req.session.user.userId,
      role_id: req.session.user.roleId,
      ip_address: ipAddress,
      device_info: deviceInfo,
      company_id: companyId
    });

    await client.query("COMMIT");
    return res.status(200).json({ message: "Role Deleted Successfully", roles: result.rows[0] });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[deleteRoles]", err);
    return res.status(500).json({ error: "Failed to Delete Roles", detail: err.message });
  } finally {
    client.release();
  }
}
////////Roles module end/////////////////

////////Permission module start/////////////////
export async function listPermissions(req, res) {
  const { companyId } = req.session.user;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    const result = await client.query(
      `SELECT permission_id, permission_name, module_name, status
       FROM permissions
       WHERE company_id = $1
       ORDER BY module_name, permission_name`,
      [companyId]
    );

    res.json({ permissions: result.rows });
  } catch (err) {
    console.error("[listPermissions]", err);
    res.status(500).json({ error: "Failed to load permissions", detail: err.message });
  } finally {
    client.release();
  }
}

export async function createPermission(req, res) {
  const { companyId, userId } = req.session.user;
  const { permissionName, moduleName } = req.body;

  if (!permissionName) {
    return res.status(400).json({ error: "permissionName is required" });
  }

  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    await client.query("BEGIN");
    const permissionId = await getOrCreatePermission(client, companyId, permissionName, moduleName || "General", userId);
    await client.query("COMMIT");
    res.status(201).json({ message: "Permission created", permissionId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[createPermission]", err);
    res.status(500).json({ error: "Failed to create permission", detail: err.message });
  } finally {
    client.release();
  }
}

export async function listRolePermissions(req, res) {
  const { companyId } = req.session.user;
  const { roleId } = req.params;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    const result = await client.query(
      `SELECT rp.is_allowed, p.permission_name, p.module_name
       FROM role_permissions rp
       JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE rp.role_id = $1 AND rp.company_id = $2
       ORDER BY p.module_name, p.permission_name`,
      [roleId, companyId]
    );

    res.json({ permissions: result.rows });
  } catch (err) {
    console.error("[listRolePermissions]", err);
    res.status(500).json({ error: "Failed to load role permissions", detail: err.message });
  } finally {
    client.release();
  }
}

export async function updateRolePermissions(req, res) {
  const { companyId, userId } = req.session.user;
  const { roleId } = req.params;
  const { permissions = [] } = req.body;

  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    await client.query("BEGIN");
    const assignments = await setPermissionAssignments(client, companyId, roleId, permissions, "role_permissions", "role_id", "role", userId, "user_id");
    await client.query("COMMIT");
    res.json({ message: "Role permissions updated", permissions: assignments });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[updateRolePermissions]", err);
    res.status(500).json({ error: "Failed to update role permissions", detail: err.message });
  } finally {
    client.release();
  }
}

export async function listUserPermissions(req, res) {
  const { companyId } = req.session.user;
  const { userId } = req.params;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    const result = await client.query(
      `SELECT up.is_allowed, p.permission_name, p.module_name
       FROM user_permissions up
       JOIN permissions p ON p.permission_id = up.permission_id
       WHERE up.user_id = $1 AND up.company_id = $2
       ORDER BY p.module_name, p.permission_name`,
      [userId, companyId]
    );

    res.json({ permissions: result.rows });
  } catch (err) {
    console.error("[listUserPermissions]", err);
    res.status(500).json({ error: "Failed to load user permissions", detail: err.message });
  } finally {
    client.release();
  }
}

export async function updateUserPermissions(req, res) {
  const { companyId, userId: actorId } = req.session.user;
  const { userId } = req.params;
  const { permissions = [] } = req.body;

  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();

  try {
    await client.query("BEGIN");
    const assignments = await setPermissionAssignments(client, companyId, userId, permissions, "user_permissions", "user_id", "user", actorId, "user_id_assigned");
    await client.query("COMMIT");
    res.json({ message: "User permissions updated", permissions: assignments });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[updateUserPermissions]", err);
    res.status(500).json({ error: "Failed to update user permissions", detail: err.message });
  } finally {
    client.release();
  }
}

////////Permission module end/////////////////
