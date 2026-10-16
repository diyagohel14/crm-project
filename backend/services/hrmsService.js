export function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return numericValue;
}

export function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidTime(value) {
  return typeof value === "string"
    && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

export function canTransitionLeaveStatus(currentStatus, nextStatus) {
  return (currentStatus === "pending" && ["approved", "rejected", "cancelled"].includes(nextStatus))
    || (currentStatus === "approved" && nextStatus === "cancelled");
}

export function calculatePayrollBreakdown(input = {}) {
  const roundMoney = (value) => Math.round(value * 100) / 100;
  const basicSalary = roundMoney(toNumber(input.basicSalary, 0));
  const allowances = roundMoney(toNumber(input.allowances, 0));
  const overtime = roundMoney(toNumber(input.overtime, 0));
  const bonus = roundMoney(toNumber(input.bonus, 0));
  const otherEarnings = roundMoney(toNumber(input.otherEarnings, 0));
  const deductions = roundMoney(toNumber(input.deductions, 0));

  const grossSalary = roundMoney(basicSalary + allowances + overtime + bonus + otherEarnings);
  const deductionTotal = deductions;
  const netSalary = roundMoney(Math.max(grossSalary - deductionTotal, 0));

  return {
    basicSalary,
    allowances,
    overtime,
    bonus,
    otherEarnings,
    grossSalary,
    deductions: deductionTotal,
    netSalary,
  };
}

export function calculateLeaveDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  if (end < start) {
    return 0;
  }

  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export function calculateOvertimePay(hours, hourlyRate, multiplier = 1.5) {
  const normalizedHours = Number(hours);
  const normalizedRate = Number(hourlyRate);
  const normalizedMultiplier = Number(multiplier);

  if (
    !Number.isFinite(normalizedHours) || normalizedHours < 0
    || !Number.isFinite(normalizedRate) || normalizedRate < 0
    || !Number.isFinite(normalizedMultiplier) || normalizedMultiplier < 0
  ) {
    throw new RangeError("Overtime values must be finite non-negative numbers");
  }

  return Math.round(normalizedHours * normalizedRate * normalizedMultiplier * 100) / 100;
}

export function calculateConfiguredDeduction(rule, salary) {
  const rate = Number(rule.rate);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new RangeError("Deduction rate must be a finite non-negative number");
  }

  if (rule.calculation_method === "fixed") {
    return Math.round(rate * 100) / 100;
  }

  if (rule.calculation_method !== "percentage") {
    throw new RangeError("Unsupported deduction calculation method");
  }

  const basis = rule.calculation_basis === "basic_salary"
    ? Number(salary.basicSalary)
    : Number(salary.grossSalary);
  if (!Number.isFinite(basis) || basis < 0) {
    throw new RangeError("Deduction basis must be a finite non-negative number");
  }

  return Math.round((basis * rate / 100) * 100) / 100;
}

export function calculateLeaveDaysByYear(startDate, endDate) {
  const totalDays = calculateLeaveDays(startDate, endDate);
  if (totalDays === 0) return [];

  const toDateOnly = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value;
  const start = new Date(`${toDateOnly(startDate)}T00:00:00.000Z`);
  const end = new Date(`${toDateOnly(endDate)}T00:00:00.000Z`);
  const daysByYear = new Map();

  for (let current = start; current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    const year = current.getUTCFullYear();
    daysByYear.set(year, (daysByYear.get(year) || 0) + 1);
  }

  return [...daysByYear].map(([year, days]) => ({ year, days }));
}
