// controllers/adminController.js
import { adminPool } from "../config/adminDb.js";
import { registerCompanyWithSuperAdmin } from "../services/companyProvisioningService.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { getCompanyPool, evictCompanyPool } from "../config/companyPoolManager.js";
import { buildCompanyDbName, quoteIdent } from "../utils/dbIdentifier.js";
import { getAppConfig } from "../utils/env.js";
import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool, Client } = pg;
const config = getAppConfig();

export function normalizeCompanyProvisionInput(input = {}) {
  return {
    ...input,
    db_name: input.db_name ?? input.companyCode ?? input.companyName ?? null,
  };
}

////////////////Admin Auth module start///////////////////
export async function registerAdmin(req, res) {
  const { full_name, email, password } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: "Name, Email and Password are required" });
  }

  try {
    const hashedPassword = await hashPassword(password);
    const result = await adminPool.query(
      `INSERT INTO admins (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING *`,
      [full_name, email, hashedPassword]
    );
    return res.status(201).json({ message: "Admin registered successfully", admin: result.rows[0] });

  } catch (err) {
    console.error("[registerAdmin]", err);
    return res.status(500).json({ error: "Failed to register admin", detail: err.message });
  }
}

export async function loginAdmin(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and Password are required" });
  }

  try {
    const result = await adminPool.query(
      `SELECT * FROM admins WHERE email = $1`,
      [email]
    );
    const admin = result.rows[0];

    if (!admin) {
      return res.status(401).json({ error: "Invalid Email or Password" });
    }

    const isPasswordValid = await verifyPassword(password, admin.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid Email and Password" });
    }

    const token = jwt.sign({ email }, config.jwtSecret, { expiresIn: "7d" });

    req.session.admin = {
      id: admin.admin_id, full_name: admin.full_name, email: admin.email
    }

    const update = await adminPool.query(
      `UPDATE admins SET last_login = now() WHERE admin_id = $1`,
      [admin.admin_id]
    )
    return res.status(200).json({ message: "Login successful", token, admin: req.session.admin });

  } catch (err) {
    console.error("[loginAdmin]", err);
    return res.status(400).json({ error: "Failed to Login Admin", detail: err.message });
  }
}

export async function logoutAdmin(req, res) {
  req.session.destroy((err) => {
    if (err) {
      console.error("[logoutAdmin]", err);
      return res.status(500).json({ error: "Failed to log out" });
    }
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out" });
  });
}

////////////////Admin Auth module end///////////////////

////////////////Subscription plan module start///////////////////
export async function viewPalnns(req, res) {
  try {
    const result = await adminPool.query(
      `SELECT * FROM subscription_plans WHERE is_deleted = FALSE`
    );
    return res.status(200).json({ subscriptionPlans: result.rows });
  } catch (err) {
    console.error("[viewPalnns]", err);
    return res.status(500).json({ error: "Failed to view subscription plans", detail: err.message });
  }
}

export async function createPalnns(req, res) {
  const { plan_name, max_users, rate, duration_days } = req.body;

  if (!plan_name || !max_users || !rate || !duration_days) {
    return res.status(400).json({ error: "plan_name, max_users, price and duration_days are required" });
  }

  try {
    const result = await adminPool.query(
      `INSERT INTO subscription_plans (plan_name, max_users, rate, duration_days)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [plan_name, max_users, rate, duration_days]
    );

    return res.status(201).json({ message: "Subscription plan created successfully", subscriptionPlan: result.rows[0] });
  } catch (err) {
    console.error("[createPalnns]", err);
    return res.status(500).json({ error: "Failed to create subscription plan", detail: err.message });
  }
}

export async function updatePalnns(req, res) {
  const { planId } = req.params;
  const { plan_name, max_users, rate, duration_days } = req.body;

  if (!plan_name || !max_users || !rate || !duration_days) {
    return res.status(400).json({ error: "plan_name, max_users, rate and duration_days are required" });
  }

  try {
    const result = await adminPool.query(
      `UPDATE subscription_plans SET plan_name = $1, max_users = $2, rate = $3, duration_days = $4 WHERE plan_id = $5 RETURNING *`,
      [plan_name, max_users, rate, duration_days, planId]
    );

    return res.status(200).json({ message: "Subscription plan updated successfully", subscriptionPlan: result.rows[0] });
  } catch (err) {
    console.error("[updatePalnns]", err);
    return res.status(500).json({ error: "Failed to update subscription plan", detail: err.message });
  }
}

export async function deletePalnns(req, res) {
  try {
    const { planId } = req.params;
    const result = await adminPool.query(
      `UPDATE subscription_plans SET is_deleted = TRUE WHERE plan_id = $1 RETURNING *`,
      [planId]
    );

    return res.status(200).json({ message: "Subscription plan deleted successfully", subscriptionPlan: result.rows[0] });
  } catch (err) {
    console.error("[deletePalnns]", err);
    return res.status(500).json({ error: "Failed to delete subscription plan", detail: err.message });
  }
}

////////////////Subscription plan module end///////////////////

////////////////Admin Company & profile module start///////////////////
export async function createCompany(req, res) {
  const normalizedInput = normalizeCompanyProvisionInput(req.body);
  const {
    companyName,
    companyCode,
    companyEmail,
    gstNo,
    phone,
    address,
    subscriptionPlanId,
    superAdminFirstName,
    superAdminLastName,
    superAdminEmail,
    superAdminPhone,
    superAdminPassword,
    db_name,
  } = normalizedInput;

  if (!companyName || !companyCode || !superAdminEmail || !superAdminPhone || !superAdminPassword || !superAdminFirstName || !db_name) {
    return res.status(400).json({
      error:
        "companyName, companyCode, superAdminFirstName, superAdminEmail, superAdminPhone, superAdminPassword and databaseName are required",
    });
  }

  try {
    const result = await registerCompanyWithSuperAdmin({
      companyName,
      companyCode,
      companyEmail,
      gstNo,
      phone,
      address,
      subscriptionPlanId,
      superAdminFirstName,
      superAdminLastName,
      superAdminEmail,
      superAdminPhone,
      superAdminPassword,
      db_name,
    });

    return res.status(201).json({
      message: "Company created and provisioned successfully",
      companyId: result.companyId,
      dbName: result.dbName,
      user_id: result.superAdminUserId,
    });
  } catch (err) {
    console.error("[createCompany]", err);

    // company_code / db_name collision, or duplicate super admin email
    if (err.code === "23505") {
      return res.status(409).json({ error: "Company code or super admin email already exists" });
    }

    return res.status(500).json({ error: "Failed to create company", detail: err.message });
  }
}

export async function viewCompany(req, res) {
  try {
    const { companyId } = req.params;
    let result;
    if (companyId) {
      result = await adminPool.query(
        `SELECT * FROM companies WHERE company_id = $1`,
        [companyId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "Company not found"
        });
      }
    } else {
      result = await adminPool.query(
        `SELECT * FROM companies`
      );
    }

    return res.status(200).json({ companies: result.rows });

  } catch (err) {
    console.error("[viewCompany]", err);
    return res.status(500).json({ error: "Failed to view company", detail: err.message });
  }
}

export async function deleteCompany(req, res) {
  // NOTE: this is a SOFT delete only. It deactivates the company and its
  // login-routing rows but deliberately does NOT touch the tenant's
  // physical database - that data is not reversible once dropped, so
  // destroying it is a separate, explicit action (see hardDeleteCompany below).
  try {
    const { companyId } = req.params;

    const result = await adminPool.query(`SELECT company_id FROM companies WHERE company_id = $1 AND is_deleted = FALSE`, [companyId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    await evictCompanyPool(companyId).catch(() => { });
    await adminPool.query(`UPDATE global_users SET is_deleted = TRUE, status = 'inactive' WHERE company_id = $1`, [companyId]);
    await adminPool.query(`UPDATE companies SET is_deleted = TRUE, status = 'inactive', updated_at = NOW() WHERE company_id = $1`, [companyId]);

    return res.status(200).json({ message: "Company deactivated successfully. Its database has NOT been deleted; use the harddelete endpoint to permanently remove it." });

  } catch (err) {
    console.error("[deleteCompany]", err);
    return res.status(500).json({ error: "Failed to delete company", detail: err.message });
  }
}

/**
 * Permanently and irreversibly drops a company's physical database.
 * Only allowed on a company that has ALREADY been soft-deleted via
 * deleteCompany, and only if the caller echoes back the company's exact
 * company_code as confirmation - this is a deliberate two-step gate
 * against a single misclick destroying a tenant's data.
 */
export async function hardDeleteCompany(req, res) {
  const dbHost = process.env.PG_MAINTENANCE_HOST;
  const dbPort = Number(process.env.PG_MAINTENANCE_PORT);
  const dbUser = process.env.PG_MAINTENANCE_USER;
  const dbPassword = process.env.PG_MAINTENANCE_PASSWORD;

  try {
    const { companyId } = req.params;
    const { confirmCompanyCode } = req.body || {};

    const result = await adminPool.query(
      `SELECT company_code, db_name, is_deleted FROM companies WHERE company_id = $1`,
      [companyId]
    );
    const company = result.rows[0];

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }
    if (!company.is_deleted) {
      return res.status(409).json({ error: "Company must be deactivated (soft-deleted) before it can be deleted" });
    }
    if (!confirmCompanyCode || confirmCompanyCode !== company.company_code) {
      return res.status(400).json({ error: "confirmCompanyCode must match the company's company_code exactly to deleted its data" });
    }

    await evictCompanyPool(companyId).catch(() => { });

    const dbName = company.db_name;
    if (dbName) {
      const maintenanceClient = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPassword, database: "postgres" });
      try {
        await maintenanceClient.connect();
        // terminate any lingering connections before dropping
        await maintenanceClient.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [dbName]
        );
        await maintenanceClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)}`);
      } finally {
        await maintenanceClient.end();
      }
    }

    await adminPool.query(`DELETE FROM global_users WHERE company_id = $1`, [companyId]);
    await adminPool.query(`DELETE FROM companies WHERE company_id = $1`, [companyId]);

    return res.status(200).json({ message: "Company permanently deleted - its database has been dropped" });

  } catch (err) {
    console.error("[hardDeleteCompany]", err);
    return res.status(500).json({ error: "Failed to deleted company", detail: err.message });
  }
}

export async function changeStatus(req, res) {
  try {
    const { companyId, status } = req.params;
    const result = await adminPool.query(
      `UPDATE companies SET status = $1 WHERE company_id = $2 RETURNING *`,
      [status, companyId]
    );

    return res.status(200).json({ message: "Company status updated successfully", company: result.rows[0] });

  } catch (err) {
    console.error("[changeStatus]", err);
    return res.status(500).json({ error: "Failed to change company status", detail: err.message });
  }
}

////////////////Admin Company & profile module end///////////////////