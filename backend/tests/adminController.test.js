import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyProvisionInput } from "../controllers/adminController.js";

test("normalizeCompanyProvisionInput falls back to companyCode when db_name is missing", () => {
  const input = normalizeCompanyProvisionInput({
    companyName: "Acme",
    companyCode: "ACME",
    superAdminEmail: "owner@example.com",
    superAdminPassword: "secret",
    superAdminFirstName: "Owner",
  });

  assert.equal(input.db_name, "ACME");
});

test("normalizeCompanyProvisionInput uses companyName when no code is present", () => {
  const input = normalizeCompanyProvisionInput({
    companyName: "Northwind",
    superAdminEmail: "owner@example.com",
    superAdminPassword: "secret",
    superAdminFirstName: "Owner",
  });

  assert.equal(input.db_name, "Northwind");
});
