import test from "node:test";
import assert from "node:assert/strict";
import { adminPool } from "../config/adminDb.js";
import { getCompanyPool, evictCompanyPool } from "../config/companyPoolManager.js";
import { encrypt } from "../utils/crypto.js";

test("getCompanyPool rechecks tenant status before returning a cached pool", async () => {
  const companyId = 987654321;
  const originalQuery = adminPool.query;
  let status = "active";
  adminPool.query = async () => ({
    rows: [{
      company_id: companyId,
      db_name: "crm_company_pool_test",
      db_host: "localhost",
      db_port: 5432,
      db_username: encrypt("test_user"),
      db_password: encrypt("test_password"),
      status,
      is_deleted: false,
    }],
  });

  try {
    await getCompanyPool(companyId);
    status = "suspended";
    await assert.rejects(getCompanyPool(companyId), /is not active/);
  } finally {
    await evictCompanyPool(companyId);
    adminPool.query = originalQuery;
  }
});
