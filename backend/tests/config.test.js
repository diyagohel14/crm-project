import test from "node:test";
import assert from "node:assert/strict";
import { getAppConfig } from "../utils/env.js";
import { buildInitialFinancialYearPayload, resolveFinancialYearPayload } from "../utils/financialYear.js";

test("getAppConfig provides safe defaults when env values are missing", () => {
  const previousEnv = { ...process.env };

  delete process.env.SESSION_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.APP_ENCRYPTION_KEY;

  try {
    const config = getAppConfig();
    assert.equal(config.sessionSecret, "dev-session-secret-change-me");
    assert.equal(config.jwtSecret, "dev-jwt-secret-change-me");
    assert.match(config.appEncryptionKey, /^[a-f0-9]{64}$/);
  } finally {
    process.env = previousEnv;
  }
});
test("resolveFinancialYearPayload auto-selects the current fiscal year", () => {
  const payload = resolveFinancialYearPayload({}, new Date("2026-08-01"));

  assert.equal(payload.fy_name, "2026-27");
  assert.equal(payload.start_date, "2026-04-01");
  assert.equal(payload.end_date, "2027-03-31");
  assert.equal(payload.is_current, true);
  assert.equal(payload.status, "active");
});

test("buildInitialFinancialYearPayload returns a current active row for a new company", () => {
  const payload = buildInitialFinancialYearPayload({}, new Date("2026-08-01"));

  assert.equal(payload.fy_name, "2026-27");
  assert.equal(payload.start_date, "2026-04-01");
  assert.equal(payload.end_date, "2027-03-31");
  assert.equal(payload.is_current, true);
  assert.equal(payload.status, "active");
  assert.equal(payload.is_deleted, false);
});
