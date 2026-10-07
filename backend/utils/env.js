import "dotenv/config";

const DEFAULTS = {
  sessionSecret: "25aff6c7be813d87809545b5be1c27c2",
  jwtSecret: "c9468946393742e073e6a9ccf5858c09f06696d11588bce5fd521d72c2c0b4dc",
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
  const nodeEnv = process.env.NODE_ENV || DEFAULTS.nodeEnv;
  if (nodeEnv === "production") {
    const required = [
      ["SESSION_SECRET", process.env.SESSION_SECRET],
      ["JWT_ACCESS_SECRET or JWT_SECRET", process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET],
      ["APP_ENCRYPTION_KEY", process.env.APP_ENCRYPTION_KEY],
      ["ADMIN_DB_HOST", process.env.ADMIN_DB_HOST],
      ["ADMIN_DB_NAME", process.env.ADMIN_DB_NAME],
      ["ADMIN_DB_USER", process.env.ADMIN_DB_USER],
      ["ADMIN_DB_PASSWORD", process.env.ADMIN_DB_PASSWORD],
      ["PG_MAINTENANCE_HOST", process.env.PG_MAINTENANCE_HOST],
      ["PG_MAINTENANCE_USER", process.env.PG_MAINTENANCE_USER],
      ["PG_MAINTENANCE_PASSWORD", process.env.PG_MAINTENANCE_PASSWORD],
    ];
    const missing = required.find(([, value]) => !value);
    if (missing) {
      throw new Error(`Missing required production environment variable: ${missing[0]}`);
    }

    const secrets = [process.env.SESSION_SECRET, process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET];
    if (secrets.some((secret) => secret.length < 32) || new Set(secrets).size !== secrets.length) {
      throw new Error("Production SESSION_SECRET and JWT secret must be unique and at least 32 characters");
    }
    if (!/^[a-f0-9]{64}$/i.test(process.env.APP_ENCRYPTION_KEY)) {
      throw new Error("Production APP_ENCRYPTION_KEY must be a 64-character hex string");
    }
  }

  const appEncryptionKey = process.env.APP_ENCRYPTION_KEY || DEFAULTS.appEncryptionKey;

  return {
    sessionSecret: process.env.SESSION_SECRET || DEFAULTS.sessionSecret,
    jwtSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || DEFAULTS.jwtSecret,
    jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || "15m",
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
    nodeEnv,
  };
}
