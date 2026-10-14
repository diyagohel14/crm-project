import { getCompanyPool } from "../config/companyPoolManager.js";
import { logAudit } from "../services/authService.js";
import { getRequestInfo } from "../utils/crypto.js";

async function audit(req, companyPool, tableName, tableId, actionType, description, value) {
  const { companyId, userId, roleId } = req.user;
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  await logAudit(companyPool, {
    module_name: "HRMS",
    page_name: "HRMS Operations",
    table_name: tableName,
    table_id: String(tableId),
    action_type: actionType,
    action_description: description,
    new_value: JSON.stringify(value),
    user_id: userId,
    role_id: roleId,
    ip_address: ipAddress,
    device_info: deviceInfo,
    company_id: companyId,
  });
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

export async function listShiftRosters(req, res) {
  const companyPool = await getCompanyPool(req.user.companyId);
  const params = [req.user.companyId];
  const clauses = ["r.company_id = $1"];
  let index = 2;

  if (req.query.employeeId) {
    const employeeId = positiveInteger(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId must be a positive integer" });
    clauses.push(`r.employee_id = $${index++}`);
    params.push(employeeId);
  }
  if (req.query.fromDate) {
    const fromDate = parseDate(req.query.fromDate);
    if (!fromDate) return res.status(400).json({ error: "fromDate must be a valid YYYY-MM-DD date" });
    clauses.push(`r.roster_date >= $${index++}`);
    params.push(fromDate);
  }
  if (req.query.toDate) {
    const toDate = parseDate(req.query.toDate);
    if (!toDate) return res.status(400).json({ error: "toDate must be a valid YYYY-MM-DD date" });
    clauses.push(`r.roster_date <= $${index++}`);
    params.push(toDate);
  }

  const result = await companyPool.query(`
    SELECT r.*, e.employee_code, e.first_name, e.last_name, s.shift_name, s.start_time, s.end_time
    FROM hrms_shift_rosters r
    JOIN hrms_employees e ON e.employee_id = r.employee_id AND e.company_id = r.company_id
    JOIN shift_master s ON s.shift_id = r.shift_id
    WHERE ${clauses.join(" AND ")} AND e.is_deleted = FALSE
    ORDER BY r.roster_date DESC, e.employee_code
  `, params);
  return res.json({ rosters: result.rows });
}

export async function saveShiftRoster(req, res) {
  const { employeeId, shiftId, rosterDate } = req.body || {};
  const employee = positiveInteger(employeeId);
  const shift = positiveInteger(shiftId);
  const date = parseDate(rosterDate);
  if (!employee || !shift || !date) {
    return res.status(400).json({ error: "employeeId, shiftId and a valid rosterDate are required" });
  }

  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    INSERT INTO hrms_shift_rosters (employee_id, shift_id, roster_date, assigned_by, company_id)
    SELECT e.employee_id, s.shift_id, $3, $4, $5
    FROM hrms_employees e
    JOIN shift_master s ON s.shift_id = $2 AND s.is_deleted = FALSE AND s.status = 'active'
    WHERE e.employee_id = $1 AND e.company_id = $5 AND e.is_deleted = FALSE
    ON CONFLICT (employee_id, roster_date, company_id)
    DO UPDATE SET shift_id = EXCLUDED.shift_id, assigned_by = EXCLUDED.assigned_by, updated_at = NOW()
    RETURNING *
  `, [employee, shift, date, req.user.userId, req.user.companyId]);
  if (!result.rows.length) return res.status(404).json({ error: "Active employee or shift not found" });

  await audit(req, companyPool, "hrms_shift_rosters", result.rows[0].shift_roster_id, "UPDATE", "Shift roster saved", result.rows[0]);
  return res.status(201).json({ message: "Shift roster saved", roster: result.rows[0] });
}

export async function listAttendanceAlerts(req, res) {
  const date = parseDate(req.query.date || utcToday());
  if (!date) return res.status(400).json({ error: "date must be a valid YYYY-MM-DD date" });
  const graceMinutes = req.query.graceMinutes === undefined ? 0 : Number(req.query.graceMinutes);
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 720) {
    return res.status(400).json({ error: "graceMinutes must be an integer from 0 to 720" });
  }

  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT e.employee_id, e.employee_code, e.first_name, e.last_name,
           a.attendance_id, a.attendance_date, a.check_in, a.check_out, a.status AS attendance_status,
           COALESCE(r.shift_id, e.shift_id) AS shift_id, s.shift_name, s.start_time, s.end_time,
           CASE
             WHEN a.attendance_id IS NULL THEN 'missing_attendance'
             WHEN a.check_in IS NULL AND a.status NOT IN ('absent', 'holiday', 'on_leave') THEN 'missing_check_in'
             WHEN a.check_out IS NULL AND a.check_in IS NOT NULL THEN 'missing_check_out'
             WHEN a.check_in > (s.start_time + ($2::integer * INTERVAL '1 minute')) THEN 'late_check_in'
           END AS alert_type
    FROM hrms_employees e
    LEFT JOIN hrms_attendance a ON a.employee_id = e.employee_id
      AND a.attendance_date = $1 AND a.company_id = e.company_id
    LEFT JOIN hrms_shift_rosters r ON r.employee_id = e.employee_id
      AND r.roster_date = $1 AND r.company_id = e.company_id
    LEFT JOIN shift_master s ON s.shift_id = COALESCE(r.shift_id, e.shift_id)
    WHERE e.company_id = $3 AND e.is_deleted = FALSE AND e.status = 'active'
      AND (a.attendance_id IS NULL OR
           (a.check_in IS NULL AND a.status NOT IN ('absent', 'holiday', 'on_leave')) OR
           (a.check_out IS NULL AND a.check_in IS NOT NULL) OR
           (a.check_in > (s.start_time + ($2::integer * INTERVAL '1 minute'))))
    ORDER BY e.employee_code
  `, [date, graceMinutes, req.user.companyId]);
  return res.json({ date, graceMinutes, alerts: result.rows });
}

export async function listOvertimeRequests(req, res) {
  const companyPool = await getCompanyPool(req.user.companyId);
  const params = [req.user.companyId];
  const clauses = ["o.company_id = $1"];
  if (req.query.status) {
    if (!["pending", "approved", "rejected", "cancelled"].includes(req.query.status)) {
      return res.status(400).json({ error: "Invalid overtime request status" });
    }
    clauses.push("o.status = $2");
    params.push(req.query.status);
  }
  const result = await companyPool.query(`
    SELECT o.*, e.employee_code, e.first_name, e.last_name
    FROM hrms_overtime_requests o
    JOIN hrms_employees e ON e.employee_id = o.employee_id AND e.company_id = o.company_id
    WHERE ${clauses.join(" AND ")} AND e.is_deleted = FALSE
    ORDER BY o.work_date DESC, o.created_at DESC
  `, params);
  return res.json({ overtimeRequests: result.rows });
}

export async function createOvertimeRequest(req, res) {
  const payload = req.body || {};
  const employeeId = positiveInteger(payload.employeeId);
  const workDate = parseDate(payload.workDate);
  const hours = finiteNonNegative(payload.hours);
  const hourlyRate = payload.hourlyRate === undefined ? null : finiteNonNegative(payload.hourlyRate);
  if (!employeeId || !workDate || hours === null || hours <= 0 || hours > 24 || (payload.hourlyRate !== undefined && hourlyRate === null)) {
    return res.status(400).json({ error: "Valid employeeId, workDate, hours (0-24) and optional hourlyRate are required" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    INSERT INTO hrms_overtime_requests (employee_id, work_date, hours, hourly_rate, reason, requested_by, company_id)
    SELECT employee_id, $2, $3, $4, $5, $6, $7
    FROM hrms_employees
    WHERE employee_id = $1 AND company_id = $7 AND is_deleted = FALSE
    RETURNING *
  `, [employeeId, workDate, hours, hourlyRate, text(payload.reason) || null, req.user.userId, req.user.companyId]);
  if (!result.rows.length) return res.status(404).json({ error: "Employee not found" });
  await audit(req, companyPool, "hrms_overtime_requests", result.rows[0].overtime_request_id, "CREATE", "Overtime request created", result.rows[0]);
  return res.status(201).json({ message: "Overtime request created", overtimeRequest: result.rows[0] });
}

export async function reviewOvertimeRequest(req, res) {
  const payload = req.body || {};
  const requestId = positiveInteger(req.params.requestId);
  const status = payload.status;
  if (!requestId || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "A valid requestId and status (approved or rejected) are required" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    UPDATE hrms_overtime_requests
    SET status = $1, approved_by = $2, approved_at = NOW(), remarks = $3, updated_at = NOW()
    WHERE overtime_request_id = $4 AND company_id = $5 AND status = 'pending'
    RETURNING *
  `, [status, req.user.userId, text(payload.remarks) || null, requestId, req.user.companyId]);
  if (!result.rows.length) {
    const existing = await companyPool.query(
      "SELECT status FROM hrms_overtime_requests WHERE overtime_request_id = $1 AND company_id = $2",
      [requestId, req.user.companyId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: "Overtime request not found" });
    return res.status(409).json({ error: `Overtime request is already ${existing.rows[0].status}` });
  }
  await audit(req, companyPool, "hrms_overtime_requests", requestId, "UPDATE", `Overtime request ${status}`, result.rows[0]);
  return res.json({ message: `Overtime request ${status}`, overtimeRequest: result.rows[0] });
}

export async function listLeaveBalances(req, res) {
  const companyPool = await getCompanyPool(req.user.companyId);
  const params = [req.user.companyId];
  const clauses = ["b.company_id = $1"];
  if (req.query.employeeId) {
    const employeeId = positiveInteger(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId must be a positive integer" });
    clauses.push("b.employee_id = $2");
    params.push(employeeId);
  }
  if (req.query.year) {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return res.status(400).json({ error: "year is invalid" });
    clauses.push(`b.leave_year = $${params.length + 1}`);
    params.push(year);
  }
  const result = await companyPool.query(`
    SELECT b.*, e.employee_code, e.first_name, e.last_name,
           b.opening_days + b.accrued_days + b.adjusted_days - b.used_days AS available_days
    FROM hrms_leave_balances b
    JOIN hrms_employees e ON e.employee_id = b.employee_id AND e.company_id = b.company_id
    WHERE ${clauses.join(" AND ")} AND e.is_deleted = FALSE
    ORDER BY b.leave_year DESC, e.employee_code, b.leave_type
  `, params);
  return res.json({ leaveBalances: result.rows });
}

export async function saveLeaveBalance(req, res) {
  const employeeId = positiveInteger(req.params.employeeId);
  const year = Number(req.body?.year);
  const leaveType = text(req.body?.leaveType);
  const openingDays = finiteNonNegative(req.body?.openingDays ?? 0);
  const accruedDays = finiteNonNegative(req.body?.accruedDays ?? 0);
  const adjustedDays = Number(req.body?.adjustedDays ?? 0);
  if (
    !employeeId || !Number.isInteger(year) || year < 1900 || year > 2200
    || !leaveType || leaveType.length > 30 || openingDays === null
    || accruedDays === null || !Number.isFinite(adjustedDays)
  ) {
    return res.status(400).json({ error: "Valid leaveType, year, openingDays, accruedDays and adjustedDays are required" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    INSERT INTO hrms_leave_balances
      (employee_id, leave_type, leave_year, opening_days, accrued_days, adjusted_days, updated_by, company_id)
    SELECT employee_id, $2, $3, $4, $5, $6, $7, $8
    FROM hrms_employees
    WHERE employee_id = $1 AND company_id = $8 AND is_deleted = FALSE
    ON CONFLICT (employee_id, leave_type, leave_year, company_id)
    DO UPDATE SET opening_days = EXCLUDED.opening_days, accrued_days = EXCLUDED.accrued_days,
      adjusted_days = EXCLUDED.adjusted_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    RETURNING *
  `, [employeeId, leaveType, year, openingDays, accruedDays, adjustedDays, req.user.userId, req.user.companyId]);
  if (!result.rows.length) return res.status(404).json({ error: "Employee not found" });
  await audit(req, companyPool, "hrms_leave_balances", result.rows[0].leave_balance_id, "UPDATE", "Leave balance saved", result.rows[0]);
  return res.json({ message: "Leave balance saved", leaveBalance: result.rows[0] });
}

export async function listEmployeeDocuments(req, res) {
  const employeeId = positiveInteger(req.params.employeeId);
  if (!employeeId) return res.status(400).json({ error: "employeeId must be a positive integer" });
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT d.*
    FROM hrms_employee_documents d
    JOIN hrms_employees e ON e.employee_id = d.employee_id AND e.company_id = d.company_id
    WHERE d.employee_id = $1 AND d.company_id = $2 AND d.is_deleted = FALSE AND e.is_deleted = FALSE
    ORDER BY d.created_at DESC
  `, [employeeId, req.user.companyId]);
  return res.json({ documents: result.rows });
}

export async function createEmployeeDocument(req, res) {
  const employeeId = positiveInteger(req.params.employeeId);
  const payload = req.body || {};
  const { documentType, fileName, storageKey } = payload;
  const normalizedDocumentType = text(documentType);
  const normalizedFileName = text(fileName);
  const normalizedStorageKey = text(storageKey);
  const issuedOn = payload.issuedOn ? parseDate(payload.issuedOn) : null;
  const expiresOn = payload.expiresOn ? parseDate(payload.expiresOn) : null;
  if (
    !employeeId || !normalizedDocumentType || normalizedDocumentType.length > 80
    || !normalizedFileName || normalizedFileName.length > 255
    || !normalizedStorageKey || normalizedStorageKey.length > 1024
  ) {
    return res.status(400).json({ error: "documentType, fileName and storageKey are required" });
  }
  if ((payload.issuedOn && !issuedOn) || (payload.expiresOn && !expiresOn)) {
    return res.status(400).json({ error: "issuedOn and expiresOn must be valid YYYY-MM-DD dates" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    INSERT INTO hrms_employee_documents
      (employee_id, document_type, file_name, storage_key, issued_on, expires_on, uploaded_by, company_id)
    SELECT employee_id, $2, $3, $4, $5, $6, $7, $8
    FROM hrms_employees
    WHERE employee_id = $1 AND company_id = $8 AND is_deleted = FALSE
    RETURNING *
  `, [
    employeeId, normalizedDocumentType, normalizedFileName, normalizedStorageKey, issuedOn, expiresOn,
    req.user.userId, req.user.companyId,
  ]);
  if (!result.rows.length) return res.status(404).json({ error: "Employee not found" });
  await audit(req, companyPool, "hrms_employee_documents", result.rows[0].document_id, "CREATE", "Employee document metadata saved", result.rows[0]);
  return res.status(201).json({ message: "Employee document recorded", document: result.rows[0] });
}

export async function deleteEmployeeDocument(req, res) {
  const documentId = positiveInteger(req.params.documentId);
  if (!documentId) return res.status(400).json({ error: "documentId must be a positive integer" });
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    UPDATE hrms_employee_documents SET is_deleted = TRUE, updated_at = NOW()
    WHERE document_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *
  `, [documentId, req.user.companyId]);
  if (!result.rows.length) return res.status(404).json({ error: "Employee document not found" });
  await audit(req, companyPool, "hrms_employee_documents", documentId, "DELETE", "Employee document archived", result.rows[0]);
  return res.json({ message: "Employee document archived" });
}

export async function listOnboardingTasks(req, res) {
  const companyPool = await getCompanyPool(req.user.companyId);
  const params = [req.user.companyId];
  const clauses = ["t.company_id = $1", "t.is_deleted = FALSE"];
  if (req.query.employeeId) {
    const employeeId = positiveInteger(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId must be a positive integer" });
    clauses.push("t.employee_id = $2");
    params.push(employeeId);
  }
  const result = await companyPool.query(`
    SELECT t.*, e.employee_code, e.first_name, e.last_name
    FROM hrms_onboarding_tasks t
    JOIN hrms_employees e ON e.employee_id = t.employee_id AND e.company_id = t.company_id
    WHERE ${clauses.join(" AND ")} AND e.is_deleted = FALSE
    ORDER BY t.due_date NULLS LAST, t.created_at DESC
  `, params);
  return res.json({ onboardingTasks: result.rows });
}

export async function createOnboardingTask(req, res) {
  const payload = req.body || {};
  const employeeId = positiveInteger(payload.employeeId);
  const title = text(payload.title);
  const dueDate = payload.dueDate ? parseDate(payload.dueDate) : null;
  const assignedTo = payload.assignedTo === undefined || payload.assignedTo === null || payload.assignedTo === ""
    ? null
    : positiveInteger(payload.assignedTo);
  if (
    !employeeId || !title || title.length > 150 || (payload.dueDate && !dueDate)
    || (payload.assignedTo !== undefined && payload.assignedTo !== null && payload.assignedTo !== "" && !assignedTo)
  ) {
    return res.status(400).json({ error: "Valid employeeId, title and optional dueDate are required" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    INSERT INTO hrms_onboarding_tasks
      (employee_id, title, description, due_date, assigned_to, created_by, company_id)
    SELECT employee_id, $2, $3, $4, $5, $6, $7
    FROM hrms_employees
    WHERE employee_id = $1 AND company_id = $7 AND is_deleted = FALSE
    RETURNING *
  `, [
    employeeId, title, text(payload.description) || null, dueDate,
    assignedTo, req.user.userId, req.user.companyId,
  ]);
  if (!result.rows.length) return res.status(404).json({ error: "Employee not found" });
  await audit(req, companyPool, "hrms_onboarding_tasks", result.rows[0].task_id, "CREATE", "Onboarding task created", result.rows[0]);
  return res.status(201).json({ message: "Onboarding task created", task: result.rows[0] });
}

export async function updateOnboardingTask(req, res) {
  const payload = req.body || {};
  const taskId = positiveInteger(req.params.taskId);
  const status = payload.status;
  if (!taskId || !["pending", "in_progress", "completed", "skipped"].includes(status)) {
    return res.status(400).json({ error: "Valid taskId and task status are required" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    UPDATE hrms_onboarding_tasks
    SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE task_id = $2 AND company_id = $3 AND is_deleted = FALSE
    RETURNING *
  `, [status, taskId, req.user.companyId]);
  if (!result.rows.length) return res.status(404).json({ error: "Onboarding task not found" });
  await audit(req, companyPool, "hrms_onboarding_tasks", taskId, "UPDATE", "Onboarding task updated", result.rows[0]);
  return res.json({ message: "Onboarding task updated", task: result.rows[0] });
}

export async function listDeductionRules(req, res) {
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(
    "SELECT * FROM hrms_deduction_rules WHERE company_id = $1 ORDER BY is_statutory DESC, rule_name",
    [req.user.companyId]
  );
  return res.json({ deductionRules: result.rows });
}

export async function saveDeductionRule(req, res) {
  const payload = req.body || {};
  const ruleId = req.params.ruleId ? positiveInteger(req.params.ruleId) : null;
  const { code, name, calculationMethod, calculationBasis, rate } = payload;
  const normalizedCode = text(code);
  const normalizedName = text(name);
  const amount = finiteNonNegative(rate);
  if (
    (req.params.ruleId && !ruleId) || !normalizedCode || normalizedCode.length > 40
    || !normalizedName || normalizedName.length > 100 || !["fixed", "percentage"].includes(calculationMethod)
    || !["basic_salary", "gross_salary"].includes(calculationBasis) || amount === null
    || (calculationMethod === "percentage" && amount > 100)
  ) {
    return res.status(400).json({ error: "Valid code, name, calculationMethod, calculationBasis and non-negative rate are required" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const values = [
    normalizedCode, normalizedName, calculationMethod, calculationBasis, amount,
    payload.isStatutory === true, payload.isActive !== false, req.user.companyId, req.user.userId,
  ];
  const result = ruleId
    ? await companyPool.query(`
        UPDATE hrms_deduction_rules
        SET rule_code = $1, rule_name = $2, calculation_method = $3, calculation_basis = $4,
            rate = $5, is_statutory = $6, is_active = $7, updated_by = $9, updated_at = NOW()
        WHERE rule_id = $10 AND company_id = $8 RETURNING *
      `, [...values, ruleId])
    : await companyPool.query(`
        INSERT INTO hrms_deduction_rules
          (rule_code, rule_name, calculation_method, calculation_basis, rate, is_statutory, is_active, company_id, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *
      `, values);
  if (!result.rows.length) return res.status(404).json({ error: "Deduction rule not found" });
  await audit(req, companyPool, "hrms_deduction_rules", result.rows[0].rule_id, ruleId ? "UPDATE" : "CREATE", "Payroll deduction rule saved", result.rows[0]);
  return res.status(ruleId ? 200 : 201).json({ message: "Deduction rule saved", deductionRule: result.rows[0] });
}

export async function getPayslip(req, res) {
  const payrollId = positiveInteger(req.params.payrollId);
  const employeeId = positiveInteger(req.params.employeeId);
  if (!payrollId || !employeeId) return res.status(400).json({ error: "Valid payrollId and employeeId are required" });
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT p.payroll_id, p.pay_period_start, p.pay_period_end, p.status AS payroll_status,
           i.*, e.employee_code, e.first_name, e.last_name, e.department_id, e.designation_id
    FROM hrms_payroll_runs p
    JOIN hrms_payroll_items i ON i.payroll_id = p.payroll_id AND i.company_id = p.company_id
    JOIN hrms_employees e ON e.employee_id = i.employee_id AND e.company_id = i.company_id
    WHERE p.payroll_id = $1 AND i.employee_id = $2 AND p.company_id = $3
      AND p.status IN ('approved', 'paid') AND e.is_deleted = FALSE
  `, [payrollId, employeeId, req.user.companyId]);
  if (!result.rows.length) return res.status(404).json({ error: "Approved payslip not found" });
  const deductions = await companyPool.query(`
    SELECT rule_code, rule_name, is_statutory, amount
    FROM hrms_payroll_item_deductions
    WHERE payroll_item_id = $1 AND company_id = $2
    ORDER BY is_statutory DESC, rule_name
  `, [result.rows[0].payroll_item_id, req.user.companyId]);
  return res.json({ payslip: { ...result.rows[0], deductions: deductions.rows } });
}

export async function getHrmsAnalytics(req, res) {
  const defaultFromDate = `${utcToday().slice(0, 7)}-01`;
  const fromDate = req.query.fromDate ? parseDate(req.query.fromDate) : defaultFromDate;
  const toDate = req.query.toDate ? parseDate(req.query.toDate) : utcToday();
  if (!fromDate || !toDate) return res.status(400).json({ error: "fromDate and toDate must be valid YYYY-MM-DD dates" });
  if (fromDate > toDate) return res.status(400).json({ error: "fromDate must not be after toDate" });
  const companyPool = await getCompanyPool(req.user.companyId);
  const companyId = req.user.companyId;
  const [workforce, departments, branches, attendance, leave, payroll, onboarding] = await Promise.all([
    companyPool.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'active') AS active_employees,
             COUNT(*) FILTER (WHERE status = 'on_leave') AS employees_on_leave,
             COUNT(*) FILTER (WHERE status = 'terminated') AS terminated_employees
      FROM hrms_employees WHERE company_id = $1 AND is_deleted = FALSE
    `, [companyId]),
    companyPool.query(`
      SELECT COALESCE(d.department_name, 'Unassigned') AS department,
             COUNT(*) FILTER (WHERE e.status = 'active') AS active_employees,
             COUNT(*) AS employee_count
      FROM hrms_employees e
      LEFT JOIN departments d ON d.department_id = e.department_id
      WHERE e.company_id = $1 AND e.is_deleted = FALSE
      GROUP BY COALESCE(d.department_name, 'Unassigned')
      ORDER BY department
    `, [companyId]),
    companyPool.query(`
      SELECT COALESCE(b.branch_name, 'Unassigned') AS branch,
             COUNT(*) FILTER (WHERE e.status = 'active') AS active_employees,
             COUNT(*) AS employee_count
      FROM hrms_employees e
      LEFT JOIN branch_mst b ON b.branch_id = e.branch_id
      WHERE e.company_id = $1 AND e.is_deleted = FALSE
      GROUP BY COALESCE(b.branch_name, 'Unassigned')
      ORDER BY branch
    `, [companyId]),
    companyPool.query(`
      SELECT status, COUNT(*) AS record_count
      FROM hrms_attendance
      WHERE company_id = $1 AND attendance_date BETWEEN $2 AND $3
      GROUP BY status ORDER BY status
    `, [companyId, fromDate, toDate]),
    companyPool.query(`
      SELECT status, COUNT(*) AS request_count, COALESCE(SUM(total_days), 0) AS leave_days
      FROM hrms_leave_requests
      WHERE company_id = $1 AND is_deleted = FALSE AND start_date <= $3 AND end_date >= $2
      GROUP BY status ORDER BY status
    `, [companyId, fromDate, toDate]),
    companyPool.query(`
      SELECT COUNT(*) AS payroll_runs, COALESCE(SUM(total_gross), 0) AS gross_payroll,
             COALESCE(SUM(total_deductions), 0) AS deductions, COALESCE(SUM(total_net), 0) AS net_payroll
      FROM hrms_payroll_runs
      WHERE company_id = $1 AND pay_period_start <= $3 AND pay_period_end >= $2
    `, [companyId, fromDate, toDate]),
    companyPool.query(`
      SELECT status, COUNT(*) AS task_count
      FROM hrms_onboarding_tasks
      WHERE company_id = $1 AND is_deleted = FALSE
      GROUP BY status ORDER BY status
    `, [companyId]),
  ]);
  return res.json({
    period: { fromDate, toDate },
    workforce: workforce.rows[0],
    departmentBreakdown: departments.rows,
    branchBreakdown: branches.rows,
    attendance: attendance.rows,
    leaveRequests: leave.rows,
    payroll: payroll.rows[0],
    onboardingTasks: onboarding.rows,
  });
}
