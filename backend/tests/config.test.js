import test from "node:test";
import assert from "node:assert/strict";
import { getAppConfig } from "../utils/env.js";
import { buildInitialFinancialYearPayload, resolveFinancialYearPayload } from "../utils/financialYear.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";

test("getAppConfig provides safe defaults when env values are missing", () => {
  const previousEnv = { ...process.env };

  delete process.env.SESSION_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.JWT_ACCESS_SECRET;
  delete process.env.JWT_ACCESS_EXPIRES;
  delete process.env.APP_ENCRYPTION_KEY;

  try {
    const config = getAppConfig();
    assert.equal(config.sessionSecret, "25aff6c7be813d87809545b5be1c27c2");
    assert.equal(config.jwtSecret, "c9468946393742e073e6a9ccf5858c09f06696d11588bce5fd521d72c2c0b4dc");
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

test("procurement document series constants match the project flow", () => {
  assert.equal(DOCUMENT_TYPES.REQUISITIONS, 17);
  assert.equal(DOCUMENT_TYPES.GRN, 18);
  assert.equal(DOCUMENT_TYPES.SITE_ISSUE, 19);
});
