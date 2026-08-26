// utils/crypto.js
//
// AES-256-GCM encrypt/decrypt for companies.db_username / db_password.
// The README on your schema explicitly calls these out as
// "encrypted at the application layer" - this is that layer.

import crypto from "crypto";
import { getAppConfig } from "./env.js";

const ALGORITHM = "aes-256-gcm";
const { appEncryptionKey } = getAppConfig();
const KEY = Buffer.from(appEncryptionKey, "hex"); // 32 bytes

if (KEY.length !== 32) {
  throw new Error(
    "APP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

/**
 * Encrypts a plaintext string.
 * Output format: iv(hex):authTag(hex):ciphertext(hex)  -> stored as one VARCHAR
 */
export function encrypt(plainText) {
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a string produced by encrypt().
 */
export function decrypt(payload) {
  const [ivHex, authTagHex, dataHex] = payload.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

//for get the ipaddress and deviceinfo
export function getRequestInfo(req) {
  return {
    ipAddress:
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      req.ip,

    deviceInfo: req.headers["user-agent"] || "Unknown Device",
  };
}