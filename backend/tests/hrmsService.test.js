import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERMISSIONS } from "../constants/defaultPermissions.js";
import {
  calculateConfiguredDeduction,
  calculateLeaveDays,
  calculateLeaveDaysByYear,
  calculateOvertimePay,
  calculatePayrollBreakdown,
} from "../services/hrmsService.js";

test("calculatePayrollBreakdown returns gross, deductions and net pay", () => {
  const result = calculatePayrollBreakdown({
    basicSalary: 50000,
    allowances: 5000,
    overtime: 2000,
    bonus: 3000,
    deductions: 4000,
  });

  assert.equal(result.grossSalary, 60000);
  assert.equal(result.deductions, 4000);
  assert.equal(result.netSalary, 56000);
});

test("calculatePayrollBreakdown rounds monetary values to cents", () => {
  const result = calculatePayrollBreakdown({
    basicSalary: 0.105,
    allowances: 0.105,
  });

  assert.equal(result.basicSalary, 0.11);
  assert.equal(result.allowances, 0.11);
  assert.equal(result.grossSalary, 0.22);
});

test("calculateLeaveDays counts inclusive dates", () => {
  assert.equal(calculateLeaveDays("2026-09-10", "2026-09-12"), 3);
  assert.equal(calculateLeaveDays("2026-09-12", "2026-09-10"), 0);
});

test("calculateOvertimePay applies the multiplier and rounds to cents", () => {
  assert.equal(calculateOvertimePay(2.5, 20, 1.5), 75);
  assert.throws(() => calculateOvertimePay(-1, 20), RangeError);
});

test("calculateConfiguredDeduction supports fixed and percentage rules", () => {
  const salary = { basicSalary: 50000, grossSalary: 60000 };
  assert.equal(calculateConfiguredDeduction({
    calculation_method: "fixed",
    rate: 250,
  }, salary), 250);
  assert.equal(calculateConfiguredDeduction({
    calculation_method: "percentage",
    calculation_basis: "basic_salary",
    rate: 12,
  }, salary), 6000);
});

test("calculateLeaveDaysByYear splits inclusive leave days at year boundaries", () => {
  assert.deepEqual(calculateLeaveDaysByYear("2026-12-30", "2027-01-02"), [
    { year: 2026, days: 2 },
    { year: 2027, days: 2 },
  ]);
  assert.deepEqual(calculateLeaveDaysByYear(new Date("2026-12-31T00:00:00.000Z"), new Date("2027-01-01T00:00:00.000Z")), [
    { year: 2026, days: 1 },
    { year: 2027, days: 1 },
  ]);
});

test("default HRMS permissions cover the added operations", () => {
  const permissions = new Set(DEFAULT_PERMISSIONS.map(({ permissionName }) => permissionName));
  for (const permission of [
    "hrms_roster:view",
    "hrms_overtime:approve",
    "hrms_leave_balance:update",
    "hrms_document:create",
    "hrms_onboarding:update",
    "hrms_payroll:update",
    "hrms_analytics:view",
  ]) {
    assert.equal(permissions.has(permission), true, `${permission} must be provisioned`);
  }
});
