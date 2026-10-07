import test from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, getRequestInfo } from "../utils/crypto.js";
import { buildCompanyDbName, quoteIdent } from "../utils/dbIdentifier.js";
import { getCurrentFinancialYearDetails } from "../utils/financialYear.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { revokeToken, isTokenRevoked } from "../utils/tokenRevocation.js";

test("crypto encrypts and decrypts plaintext", () => {
  const payload = encrypt("company-password");
  assert.notEqual(payload, "company-password");
  assert.equal(decrypt(payload), "company-password");
  assert.throws(() => decrypt(`${payload.slice(0, -1)}0`));
});

test("getRequestInfo prefers the first forwarded IP and user agent", () => {
  const info = getRequestInfo({
    headers: { "x-forwarded-for": " 203.0.113.10, 10.0.0.2 ", "user-agent": "Test Browser" },
    socket: { remoteAddress: "127.0.0.1" },
    ip: "127.0.0.1",
  });
  assert.deepEqual(info, { ipAddress: "203.0.113.10", deviceInfo: "Test Browser" });
});

test("buildCompanyDbName normalizes and validates PostgreSQL identifiers", () => {
  assert.equal(buildCompanyDbName("ACME-01"), "crm_company_acme_01");
  assert.equal(quoteIdent('company"name'), '"company""name"');
  assert.throws(() => buildCompanyDbName("---"), /empty database name/);
  assert.throws(() => buildCompanyDbName("a".repeat(70)), /too long/);
});

test("financial year boundaries follow April 1", () => {
  assert.deepEqual(getCurrentFinancialYearDetails(new Date("2026-03-31")), {
    fyName: "2025-26",
    startDate: "2025-04-01",
    endDate: "2026-03-31",
  });
  assert.deepEqual(getCurrentFinancialYearDetails(new Date("2026-04-01")), {
    fyName: "2026-27",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
  });
});

test("password hashing verifies only the original password", async () => {
  const hash = await hashPassword("correct horse");
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("wrong horse", hash), false);
});

test("token revocation expires entries and ignores invalid input", () => {
  const tokenId = `test-token-${Date.now()}`;
  revokeToken(tokenId, Math.floor(Date.now() / 1000) + 60);
  assert.equal(isTokenRevoked(tokenId), true);
  assert.equal(isTokenRevoked("missing-token"), false);
  revokeToken(null, null);
});
