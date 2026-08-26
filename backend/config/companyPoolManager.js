// config/companyPoolManager.js
//
// Every tenant has its own physical Postgres database. Rather than
// opening a fresh connection per request (slow) or one giant pool per
// company at boot (wasteful for companies nobody is using right now),
// we lazily create a pg.Pool the first time a company is touched and
// cache it in memory for the life of the process.

import pg from "pg";
import { adminPool } from "./adminDb.js";
import { decrypt } from "../utils/crypto.js";

const { Pool } = pg;

/** company_id -> pg.Pool */
const poolCache = new Map();

/**
 * Returns (creating if necessary) the pg.Pool for a given company_id,
 * by looking up its connection info in the Admin DB.
 */
export async function getCompanyPool(companyId) {
  if (poolCache.has(companyId)) {
    return poolCache.get(companyId);
  }

  const { rows } = await adminPool.query(
    `SELECT company_id, db_name, db_host, db_port, db_username, db_password, status, is_deleted
       FROM companies
      WHERE company_id = $1`,
    [companyId]
  );

  const company = rows[0];

  if (!company) {
    throw new Error(`No company found for company_id=${companyId}`);
  }
  if (company.is_deleted) {
    throw new Error(`Company ${companyId} has been deleted`);
  }
  if (company.status !== "active") {
    throw new Error(`Company ${companyId} is not active (status=${company.status})`);
  }

  const pool = new Pool({
    host: company.db_host,
    port: company.db_port,
    database: company.db_name,
    user: decrypt(company.db_username),
    password: decrypt(company.db_password),
    max: 5,
  });

  pool.on("error", (err) => {
    console.error(`[companyPool:${companyId}] Unexpected error on idle client`, err);
  });

  poolCache.set(companyId, pool);
  return pool;
}

/** Call this if a company's credentials change or it's suspended, so stale pools aren't reused. */
export async function evictCompanyPool(companyId) {
  const pool = poolCache.get(companyId);
  if (pool) {
    await pool.end();
    poolCache.delete(companyId);
  }
}
