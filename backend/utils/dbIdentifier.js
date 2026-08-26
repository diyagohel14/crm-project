// utils/dbIdentifier.js

/**
 * Turns a db_name (e.g. "ACME-01") into a safe, lowercase
 * Postgres database name, e.g. "crm_company_acme_01".
 * Throws if the result would be empty or too long.
 */
export function buildCompanyDbName(db_name) {
  const cleaned = String(db_name)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!cleaned) {
    throw new Error("company_code produced an empty database name");
  }

  const dbName = `crm_company_${cleaned}`;

  if (dbName.length > 63) {
    // Postgres identifier limit
    throw new Error(`Generated database name is too long: ${dbName}`);
  }

  return dbName;
}

/** Postgres identifier quoting (for names we've already whitelisted). */
export function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}
