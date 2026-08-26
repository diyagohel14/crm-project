import "dotenv/config";

const DEFAULTS = {
  sessionSecret: "dev-session-secret-change-me",
  jwtSecret: "dev-jwt-secret-change-me",
  appEncryptionKey: "0000000000000000000000000000000000000000000000000000000000000000",
  adminDbHost: "localhost",
  adminDbPort: 5432,
  adminDbName: "crm_admin_db",
  adminDbUser: "postgres",
  adminDbPassword: "postgres",
  maintenanceDbHost: "localhost",
  maintenanceDbPort: 5432,
  maintenanceDbUser: "postgres",
  maintenanceDbPassword: "postgres",
  port: 4500,
  nodeEnv: "development",
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getAppConfig() {
  const appEncryptionKey = process.env.APP_ENCRYPTION_KEY || DEFAULTS.appEncryptionKey;

  return {
    sessionSecret: process.env.SESSION_SECRET || DEFAULTS.sessionSecret,
    jwtSecret: process.env.JWT_SECRET || DEFAULTS.jwtSecret,
    appEncryptionKey,
    adminDb: {
      host: process.env.ADMIN_DB_HOST || DEFAULTS.adminDbHost,
      port: toNumber(process.env.ADMIN_DB_PORT, DEFAULTS.adminDbPort),
      name: process.env.ADMIN_DB_NAME || DEFAULTS.adminDbName,
      user: process.env.ADMIN_DB_USER || DEFAULTS.adminDbUser,
      password: process.env.ADMIN_DB_PASSWORD || DEFAULTS.adminDbPassword,
    },
    maintenanceDb: {
      host: process.env.PG_MAINTENANCE_HOST || DEFAULTS.maintenanceDbHost,
      port: toNumber(process.env.PG_MAINTENANCE_PORT, DEFAULTS.maintenanceDbPort),
      user: process.env.PG_MAINTENANCE_USER || DEFAULTS.maintenanceDbUser,
      password: process.env.PG_MAINTENANCE_PASSWORD || DEFAULTS.maintenanceDbPassword,
    },
    port: toNumber(process.env.PORT, DEFAULTS.port),
    nodeEnv: process.env.NODE_ENV || DEFAULTS.nodeEnv,
  };
}
