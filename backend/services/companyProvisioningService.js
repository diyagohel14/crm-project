// services/companyProvisioningService.js
//
// This is step 1-4 of your flow:
//   1. Admin creates a company            -> row in Admin DB "companies"
//   2. A fresh physical DB is created     -> CREATE DATABASE
//   3. 02_company_db_schema.sql is run    -> against that new DB
//   4. A superuser is created             -> "users" row in the company DB
//                                          + a routing row in "global_users"
//
// If any step fails, everything already done is rolled back so you
// never end up with an orphaned company row, an empty database, or a
// company with no way to log in.

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { adminPool } from "../config/adminDb.js";
import { encrypt } from "../utils/crypto.js";
import { hashPassword } from "../utils/password.js";
import { buildCompanyDbName, quoteIdent } from "../utils/dbIdentifier.js";
import { getCompanyPool, evictCompanyPool } from "../config/companyPoolManager.js";
import { DEFAULT_PERMISSIONS } from "../constants/defaultPermissions.js";
import { DEFAULT_DOCUMENT_TYPES, DOCUMENT_SERIES } from "../constants/documentTypes.js";
import { buildInitialFinancialYearPayload } from "../utils/financialYear.js";


async function ensurePermissionRecord(pool, companyId, permissionName, moduleName, userId) {
  const existing = await pool.query(
    `SELECT permission_id
       FROM permissions
      WHERE permission_name = $1 AND company_id = $2`,
    [permissionName, companyId]
  );

  if (existing.rows[0]) {
    return existing.rows[0].permission_id;
  }

  const inserted = await pool.query(
    `INSERT INTO permissions (permission_name, module_name, status, user_id, company_id)
     VALUES ($1, $2, TRUE, $3, $4)
     RETURNING permission_id`,
    [permissionName, moduleName || "General", userId, companyId]
  );

  return inserted.rows[0].permission_id;
}

const { Pool, Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL_PATH = path.join(__dirname, "..", "sql", "02_company_db_schema.sql");
const SCHEMA_SQL = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");

/**
 * @param {object} input
 * @param {string} input.companyName
 * @param {string} input.companyCode      short unique code, also used to derive db_name
 * @param {string} [input.companyEmail]
 * @param {string} [input.gstNo]
 * @param {string} [input.phone]
 * @param {string} [input.address]
 * @param {number} [input.subscriptionPlanId]
 * @param {string} input.superAdminFirstName
 * @param {string} [input.superAdminLastName]
 * @param {string} input.superAdminEmail   login email for the company's first user
 * @param {string} input.superAdminPhone   login phone for the company's first user
 * @param {string} input.superAdminPassword
 * @param {string} input.db_name
 *
 * @returns {{ companyId: number, dbName: string, superAdminUserId: number }}
 */
export async function registerCompanyWithSuperAdmin(input) {
  const dbName = buildCompanyDbName(input.db_name ?? input.companyCode);

  // DB server the new company database will live on. In a single-server
  // setup this is the same host/port as the admin DB and your maintenance
  // creds. For a sharded/multi-server setup, choose the target host here.
  const dbHost = process.env.PG_MAINTENANCE_HOST;
  const dbPort = Number(process.env.PG_MAINTENANCE_PORT);
  const dbUser = process.env.PG_MAINTENANCE_USER;
  const dbPassword = process.env.PG_MAINTENANCE_PASSWORD;

  let companyId = null;
  let physicalDbCreated = false;

  try {
    // ---- 1. Insert the company row first, so we have a company_id ----
    const insertCompanySql = `
      INSERT INTO companies
        (company_name, company_code, company_email, gst_no, phone, address,
         db_name, db_host, db_port, db_username, db_password,
         status, subscription_plan_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'inactive',$12)
      RETURNING company_id
    `;
    const companyResult = await adminPool.query(insertCompanySql, [
      input.companyName,
      input.companyCode,
      input.companyEmail ?? null,
      input.gstNo ?? null,
      input.phone ?? null,
      input.address ?? null,
      dbName,
      dbHost,
      dbPort,
      encrypt(dbUser),
      encrypt(dbPassword),
      input.subscriptionPlanId ?? null,
    ]);
    companyId = companyResult.rows[0].company_id;

    // ---- 2. Physically create the database (cannot be parameterized) ----
    const maintenanceClient = new Client({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: "postgres", // connect to the default maintenance DB to run CREATE DATABASE
    });
    await maintenanceClient.connect();
    try {
      await maintenanceClient.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
      physicalDbCreated = true;
    } finally {
      await maintenanceClient.end();
    }

    // ---- 3. Run the full company schema against the new database ----
    const schemaPool = new Pool({ host: dbHost, port: dbPort, user: dbUser, password: dbPassword, database: dbName });
    try {
      // node-pg's simple query protocol runs a whole multi-statement
      // script fine as long as there are no bind parameters.
      await schemaPool.query(SCHEMA_SQL);

      // ---- 4a. Seed a default "Super Admin" role ----
      const roleResult = await schemaPool.query(
        `INSERT INTO roles (role_name, description, company_id) VALUES ($1,$2,$3) RETURNING role_id`,
        ["Super Admin", "Full access - company owner account", companyId]
      );
      const superAdminRoleId = roleResult.rows[0].role_id;

      // ---- 4b. Create the superuser in the company DB ----
      const passwordHash = await hashPassword(input.superAdminPassword);
      const userResult = await schemaPool.query(
        `INSERT INTO users
           (first_name, last_name, email, username, password, phone, status, is_email_verified, company_id, role_id)
         VALUES ($1,$2,$3,$4,$5,$6, 'active', TRUE, $7, $8)
         RETURNING user_id`,
        [
          input.superAdminFirstName,
          input.superAdminLastName ?? null,
          input.superAdminEmail,
          input.superAdminEmail, // default username = email; adjust if you want a separate field
          passwordHash,
          input.superAdminPhone,
          companyId,
          superAdminRoleId,
        ]
      );
      const superAdminUserId = userResult.rows[0].user_id;

      const financialYearPayload = buildInitialFinancialYearPayload({ user_id: superAdminUserId }, new Date());
      const financialQuery = await schemaPool.query(
        `INSERT INTO financial_years (fy_name, start_date, end_date, is_current, status, is_deleted, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING financial_year_id`,
        [
          financialYearPayload.fy_name,
          financialYearPayload.start_date,
          financialYearPayload.end_date,
          financialYearPayload.is_current,
          financialYearPayload.status,
          financialYearPayload.is_deleted,
          financialYearPayload.user_id,
        ]
      );

      for (const permission of DEFAULT_PERMISSIONS) {
        const permissionId = await ensurePermissionRecord(
          schemaPool,
          companyId,
          permission.permissionName,
          permission.moduleName,
          superAdminUserId
        );

        await schemaPool.query(
          `INSERT INTO role_permissions (role_id, permission_id, is_allowed, user_id, company_id)
           SELECT $1, $2, TRUE, $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2 AND company_id = $4
           )`,
          [superAdminRoleId, permissionId, superAdminUserId, companyId]
        );

        await schemaPool.query(
          `INSERT INTO user_permissions (user_id, permission_id, is_allowed, user_id_assigned, company_id)
           SELECT $1, $2, TRUE, $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM user_permissions WHERE user_id = $1 AND permission_id = $2 AND company_id = $4
           )`,
          [superAdminUserId, permissionId, superAdminUserId, companyId]
        );
      }

      for (const docType of DEFAULT_DOCUMENT_TYPES) {
        await schemaPool.query(
          `INSERT INTO document_type (doc_type_id, document_type_name, user_id, company_id)
           SELECT $1, $2, $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM document_type WHERE doc_type_id = $1 AND company_id = $4
           )`,
          [docType.document_type_id, docType.document_type_name, superAdminUserId, companyId]
        );
      }

      for (const docSeries of DOCUMENT_SERIES) {
        await schemaPool.query(
          `INSERT INTO document_series (document_type_id, prefix, postfix, financial_year_id, padding_length, user_id, company_id)
           SELECT $1, $2, $3, $4, $5, $6, $7
           WHERE NOT EXISTS (
             SELECT 1 FROM document_series WHERE document_type_id = $1 AND company_id = $7
           )`,
          [docSeries.document_type_id, docSeries.prefix, docSeries.postfix, financialQuery.rows[0].financial_year_id, docSeries.padding_length, superAdminUserId, companyId]
        );
      }

      // ---- 4c. Create the company profile row in the company DB ---- 

      const company_pro = await schemaPool.query(
        `INSERT INTO tbl_company_profile (company_name, gst_no, email, phone, address_line1, contact_name, company_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING company_profile_id`,
        [input.companyName, input.gstNo ?? null, input.companyEmail ?? null, input.phone ?? null, input.address ?? null, input.superAdminFirstName, companyId]
      );

      const company_profile_id = company_pro.rows[0].company_profile_id;
      await schemaPool.query(
        `INSERT INTO tbl_company_bank_detail (company_profile_id, company_id) VALUES ($1,$2)`,
        [company_profile_id, companyId]
      )
      // ---- 4c. Register the login-routing row in the Admin DB ----
      // NOTE: no password stored here - the real password check happens
      // against the company DB's users table. This row only answers
      // "which company does this email belong to?"
      await adminPool.query(
        `INSERT INTO global_users (email, username, phone, company_id, status) VALUES ($1,$2,$3,$4,'active')`,
        [input.superAdminEmail, input.superAdminEmail, input.superAdminPhone, companyId]
      );

      // ---- 5. Everything succeeded - flip the company to active ----
      await adminPool.query(`UPDATE companies SET status = 'active', updated_at = now() WHERE company_id = $1`, [
        companyId,
      ]);

      return { companyId, dbName, superAdminUserId };
    } finally {
      await schemaPool.end();
    }
  } catch (err) {
    // ---- Rollback whatever partially succeeded ----
    await rollback({ companyId, dbName, physicalDbCreated, dbHost, dbPort, dbUser, dbPassword });
    throw err;
  }
}

async function rollback({ companyId, dbName, physicalDbCreated, dbHost, dbPort, dbUser, dbPassword }) {
  console.error(`[provisioning] Rolling back failed company setup (company_id=${companyId ?? "n/a"})`);

  if (companyId) {
    await evictCompanyPool(companyId).catch(() => { });
    await adminPool.query(`DELETE FROM global_users WHERE company_id = $1`, [companyId]).catch(() => { });
    await adminPool.query(`DELETE FROM companies WHERE company_id = $1`, [companyId]).catch(() => { });
  }

  if (physicalDbCreated && dbName) {
    const maintenanceClient = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPassword, database: "postgres" });
    try {
      await maintenanceClient.connect();
      // terminate any lingering connections before dropping
      await maintenanceClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
      await maintenanceClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)}`);
    } catch (dropErr) {
      console.error(`[provisioning] Failed to drop database ${dbName} during rollback`, dropErr);
    } finally {
      await maintenanceClient.end();
    }
  }
}
