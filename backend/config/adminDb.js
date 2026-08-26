// config/adminDb.js
//
// ONE fixed pool for the shared Admin/Master database (companies,
// subscription_plans, global_users, login_audit_logs).
// Every request touches this pool first to figure out which company
// database to talk to next.

import pg from "pg";
import { getAppConfig } from "../utils/env.js";

const { Pool } = pg;
const config = getAppConfig();

export const adminPool = new Pool({
  host: config.adminDb.host,
  port: config.adminDb.port,
  database: config.adminDb.name,
  user: config.adminDb.user,
  password: config.adminDb.password,
  max: 10,
});

adminPool.on("error", (err) => {
  console.error("[adminPool] Unexpected error on idle client", err);
});
