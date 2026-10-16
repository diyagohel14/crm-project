import { getCompanyPool } from "../config/companyPoolManager.js";
import { adminPool } from "../config/adminDb.js";
import { logAudit } from "../services/authService.js";
import { getRequestInfo } from "../utils/crypto.js";
import { buildPayslipPdf } from "../services/payslipPdfService.js";
import { computeTimesheetCost, recalcProjectCost } from "../services/costingService.js";

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

function hasAtMostTwoDecimalPlaces(value) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number * 100 - Math.round(number * 100)) < 1e-8;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

const attendanceStatuses = new Set(["present", "absent", "late", "half_day", "holiday", "on_leave"]);
const validTime = (value) => value === null || value === undefined || value === ""
  || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value));

export async function listAttendanceCorrections(req, res) {
  const clauses = ["c.company_id = $1"];
  const values = [req.user.companyId];
  if (req.query.status !== undefined) {
    if (!["pending", "approved", "rejected"].includes(req.query.status)) {
      return res.status(400).json({ error: "status is invalid" });
    }
    values.push(req.query.status);
    clauses.push(`c.status = $${values.length}`);
  }
  if (req.query.employeeId !== undefined) {
    const employeeId = positiveInteger(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId must be a positive integer" });
    values.push(employeeId);
    clauses.push(`a.employee_id = $${values.length}`);
  }
  for (const [key, operator] of [["fromDate", ">="], ["toDate", "<="]]) {
    if (req.query[key] === undefined) continue;
    const date = parseDate(req.query[key]);
    if (!date) return res.status(400).json({ error: `${key} must be a valid YYYY-MM-DD date` });
    values.push(date);
    clauses.push(`a.attendance_date ${operator} $${values.length}`);
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT c.*, a.employee_id, a.attendance_date,
           a.check_in AS current_check_in, a.check_out AS current_check_out,
           a.status AS current_status, a.notes AS current_notes,
           e.employee_code, e.first_name, e.last_name
    FROM hrms_attendance_corrections c
    JOIN hrms_attendance a ON a.attendance_id = c.attendance_id AND a.company_id = c.company_id
    JOIN hrms_employees e ON e.employee_id = a.employee_id AND e.company_id = a.company_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY c.created_at DESC, c.correction_id DESC
  `, values);
  return res.json({ corrections: result.rows });
}

export async function createAttendanceCorrection(req, res) {
  const attendanceId = positiveInteger(req.params.attendanceId);
  const payload = req.body || {};
  const reason = text(payload.reason);
  if (!attendanceId || reason.length < 3 || reason.length > 1000) {
    return res.status(400).json({ error: "A valid attendanceId and correction reason (3-1000 characters) are required" });
  }

  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let correction;
  try {
    await client.query("BEGIN");
    const attendanceResult = await client.query(`
      SELECT * FROM hrms_attendance
      WHERE attendance_id = $1 AND company_id = $2
      FOR UPDATE
    `, [attendanceId, companyId]);
    if (!attendanceResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Attendance record not found" });
    }
    const attendance = attendanceResult.rows[0];
    const lockedPayroll = await client.query(`
      SELECT payroll_id FROM hrms_payroll_runs
      WHERE company_id = $1 AND status IN ('approved', 'paid')
        AND pay_period_start <= $2 AND pay_period_end >= $2
      LIMIT 1
    `, [companyId, attendance.attendance_date]);
    if (lockedPayroll.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Attendance cannot be corrected after payroll is approved" });
    }

    const checkIn = Object.prototype.hasOwnProperty.call(payload, "checkIn") ? payload.checkIn : attendance.check_in;
    const checkOut = Object.prototype.hasOwnProperty.call(payload, "checkOut") ? payload.checkOut : attendance.check_out;
    const status = payload.status ?? attendance.status;
    if (!validTime(checkIn) || !validTime(checkOut) || !attendanceStatuses.has(status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Correction must contain valid checkIn/checkOut times and attendance status" });
    }
    const result = await client.query(`
      INSERT INTO hrms_attendance_corrections
        (attendance_id, original_check_in, original_check_out, original_status, original_notes,
         proposed_check_in, proposed_check_out, proposed_status, proposed_notes,
         reason, requested_by, company_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
      attendanceId, attendance.check_in, attendance.check_out, attendance.status, attendance.notes,
      checkIn || null, checkOut || null, status,
      Object.prototype.hasOwnProperty.call(payload, "notes") ? text(payload.notes) || null : attendance.notes,
      reason, req.user.userId, companyId,
    ]);
    correction = result.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ error: "A pending correction already exists for this attendance record" });
    }
    throw error;
  } finally {
    client.release();
  }

  await audit(req, companyPool, "hrms_attendance_corrections", correction.correction_id, "CREATE", "Attendance correction requested", correction);
  return res.status(201).json({ message: "Attendance correction requested", correction });
}

export async function reviewAttendanceCorrection(req, res) {
  const correctionId = positiveInteger(req.params.correctionId);
  const status = req.body?.status;
  if (!correctionId || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "A valid correctionId and status (approved or rejected) are required" });
  }

  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let correction;
  try {
    await client.query("BEGIN");
    const correctionResult = await client.query(`
      SELECT c.*, a.attendance_date
      FROM hrms_attendance_corrections c
      JOIN hrms_attendance a ON a.attendance_id = c.attendance_id AND a.company_id = c.company_id
      WHERE c.correction_id = $1 AND c.company_id = $2
      FOR UPDATE OF c, a
    `, [correctionId, companyId]);
    if (!correctionResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Attendance correction not found" });
    }
    correction = correctionResult.rows[0];
    if (correction.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Attendance correction is already ${correction.status}` });
    }
    if (Number(correction.requested_by) === Number(req.user.userId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "A user cannot review their own attendance correction" });
    }
    if (status === "approved") {
      const lockedPayroll = await client.query(`
        SELECT payroll_id FROM hrms_payroll_runs
        WHERE company_id = $1 AND status IN ('approved', 'paid')
          AND pay_period_start <= $2 AND pay_period_end >= $2
        LIMIT 1
      `, [companyId, correction.attendance_date]);
      if (lockedPayroll.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Attendance cannot be corrected after payroll is approved" });
      }
      await client.query(`
        UPDATE hrms_attendance
        SET check_in = $1, check_out = $2, status = $3, notes = $4, approved_by = $5, updated_at = NOW()
        WHERE attendance_id = $6 AND company_id = $7
      `, [
        correction.proposed_check_in, correction.proposed_check_out, correction.proposed_status,
        correction.proposed_notes, req.user.userId, correction.attendance_id, companyId,
      ]);
    }
    const reviewed = await client.query(`
      UPDATE hrms_attendance_corrections
      SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_remarks = $3
      WHERE correction_id = $4 AND company_id = $5 AND status = 'pending'
      RETURNING *
    `, [status, req.user.userId, text(req.body?.remarks) || null, correctionId, companyId]);
    correction = reviewed.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_attendance_corrections", correctionId, "UPDATE", `Attendance correction ${status}`, correction);
  return res.json({ message: `Attendance correction ${status}`, correction });
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
    JOIN shift_master s ON s.shift_id = r.shift_id AND s.status = 'active' AND s.is_deleted = FALSE
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
      AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL AND s.start_time <> s.end_time
    WHERE e.employee_id = $1 AND e.company_id = $5 AND e.is_deleted = FALSE AND e.status = 'active'
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

async function loadPayslip(companyPool, companyId, payrollId, employeeId) {
  const result = await companyPool.query(`
    SELECT p.payroll_id, p.pay_period_start, p.pay_period_end, p.status AS payroll_status,
           i.*, e.employee_code, e.first_name, e.last_name, e.department_id, e.designation_id
    FROM hrms_payroll_runs p
    JOIN hrms_payroll_items i ON i.payroll_id = p.payroll_id AND i.company_id = p.company_id
    JOIN hrms_employees e ON e.employee_id = i.employee_id AND e.company_id = i.company_id
    WHERE p.payroll_id = $1 AND i.employee_id = $2 AND p.company_id = $3
      AND p.status IN ('approved', 'paid') AND e.is_deleted = FALSE
  `, [payrollId, employeeId, companyId]);
  if (!result.rows.length) return null;
  const deductions = await companyPool.query(`
    SELECT rule_code, rule_name, is_statutory, amount
    FROM hrms_payroll_item_deductions
    WHERE payroll_item_id = $1 AND company_id = $2
    ORDER BY is_statutory DESC, rule_name
  `, [result.rows[0].payroll_item_id, companyId]);
  return { ...result.rows[0], deductions: deductions.rows };
}

export async function getPayslip(req, res) {
  const payrollId = positiveInteger(req.params.payrollId);
  const employeeId = positiveInteger(req.params.employeeId);
  if (!payrollId || !employeeId) return res.status(400).json({ error: "Valid payrollId and employeeId are required" });
  const companyPool = await getCompanyPool(req.user.companyId);
  const payslip = await loadPayslip(companyPool, req.user.companyId, payrollId, employeeId);
  if (!payslip) return res.status(404).json({ error: "Approved payslip not found" });
  return res.json({ payslip });
}

export async function getPayslipPdf(req, res) {
  const payrollId = positiveInteger(req.params.payrollId);
  const employeeId = positiveInteger(req.params.employeeId);
  if (!payrollId || !employeeId) return res.status(400).json({ error: "Valid payrollId and employeeId are required" });
  const companyPool = await getCompanyPool(req.user.companyId);
  const payslip = await loadPayslip(companyPool, req.user.companyId, payrollId, employeeId);
  if (!payslip) return res.status(404).json({ error: "Approved payslip not found" });
  const companyResult = await companyPool.query(
    "SELECT company_name FROM tbl_company_profile WHERE company_id = $1 AND is_deleted = FALSE LIMIT 1",
    [req.user.companyId]
  );
  if (!companyResult.rows.length) return res.status(404).json({ error: "Company profile not found" });

  const pdf = await buildPayslipPdf(payslip, companyResult.rows[0]);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="payslip-${payrollId}-${employeeId}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(pdf);
}

export async function listPayrollPayments(req, res) {
  const payrollId = positiveInteger(req.params.payrollId);
  if (!payrollId) return res.status(400).json({ error: "payrollId must be a positive integer" });
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT payment_id, payroll_id, employee_id, amount, paid_on, payment_method,
           payment_reference, status, recorded_by, reversed_by, reversed_at,
           reversal_reason, created_at
    FROM hrms_payroll_payments
    WHERE payroll_id = $1 AND company_id = $2
    ORDER BY paid_on DESC, payment_id DESC
  `, [payrollId, req.user.companyId]);
  return res.json({ payments: result.rows });
}

export async function recordPayrollPayment(req, res) {
  const payrollId = positiveInteger(req.params.payrollId);
  const employeeId = positiveInteger(req.body?.employeeId);
  const amount = finiteNonNegative(req.body?.amount);
  const paidOn = parseDate(req.body?.paidOn);
  const paymentMethod = text(req.body?.paymentMethod);
  const reference = text(req.body?.paymentReference) || null;
  if (
    !payrollId || !employeeId || amount === null || amount <= 0
    || Math.round(amount * 100) !== amount * 100 || !paidOn
    || !paymentMethod || paymentMethod.length > 40 || (reference && reference.length > 120)
  ) {
    return res.status(400).json({ error: "Valid employeeId, positive amount (up to 2 decimal places), paidOn, paymentMethod and optional paymentReference are required" });
  }

  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let payment;
  try {
    await client.query("BEGIN");
    const runResult = await client.query(`
      SELECT payroll_id, status
      FROM hrms_payroll_runs
      WHERE payroll_id = $1 AND company_id = $2
      FOR UPDATE
    `, [payrollId, companyId]);
    if (!runResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Payroll run not found" });
    }
    if (!["approved", "paid"].includes(runResult.rows[0].status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Payments can only be recorded for approved payroll" });
    }
    const itemResult = await client.query(`
      SELECT payroll_item_id, net_salary
      FROM hrms_payroll_items
      WHERE payroll_id = $1 AND employee_id = $2 AND company_id = $3
      FOR UPDATE
    `, [payrollId, employeeId, companyId]);
    if (!itemResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee payroll item not found" });
    }
    const paidResult = await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS paid
      FROM hrms_payroll_payments
      WHERE payroll_id = $1 AND employee_id = $2 AND company_id = $3 AND status = 'recorded'
    `, [payrollId, employeeId, companyId]);
    const outstanding = Number(itemResult.rows[0].net_salary) - Number(paidResult.rows[0].paid);
    if (amount > outstanding + 0.0001) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Payment exceeds the outstanding net salary of ${Math.max(outstanding, 0).toFixed(2)}` });
    }

    const inserted = await client.query(`
      INSERT INTO hrms_payroll_payments
        (payroll_id, employee_id, amount, paid_on, payment_method, payment_reference, recorded_by, company_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [payrollId, employeeId, amount, paidOn, paymentMethod, reference, req.user.userId, companyId]);
    payment = inserted.rows[0];
    const unpaidItems = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM hrms_payroll_items i
        WHERE i.payroll_id = $1 AND i.company_id = $2
          AND COALESCE((
            SELECT SUM(p.amount)
            FROM hrms_payroll_payments p
            WHERE p.payroll_id = i.payroll_id AND p.employee_id = i.employee_id
              AND p.company_id = i.company_id AND p.status = 'recorded'
          ), 0) < i.net_salary
      ) AS has_unpaid_items
    `, [payrollId, companyId]);
    if (!unpaidItems.rows[0].has_unpaid_items) {
      await client.query(`
        UPDATE hrms_payroll_runs SET status = 'paid', updated_at = NOW()
        WHERE payroll_id = $1 AND company_id = $2 AND status = 'approved'
      `, [payrollId, companyId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "This payment reference has already been recorded" });
    throw error;
  } finally {
    client.release();
  }

  await audit(req, companyPool, "hrms_payroll_payments", payment.payment_id, "CREATE", "Payroll payment recorded", payment);
  return res.status(201).json({ message: "Payroll payment recorded", payment });
}

export async function reversePayrollPayment(req, res) {
  const payrollId = positiveInteger(req.params.payrollId);
  const paymentId = positiveInteger(req.params.paymentId);
  const reason = text(req.body?.reason);
  if (!payrollId || !paymentId || reason.length < 3 || reason.length > 1000) {
    return res.status(400).json({ error: "Valid payrollId, paymentId and reversal reason (3-1000 characters) are required" });
  }

  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let payment;
  try {
    await client.query("BEGIN");
    const run = await client.query(`
      SELECT payroll_id FROM hrms_payroll_runs
      WHERE payroll_id = $1 AND company_id = $2
      FOR UPDATE
    `, [payrollId, companyId]);
    if (!run.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Payroll run not found" });
    }
    const result = await client.query(`
      UPDATE hrms_payroll_payments
      SET status = 'reversed', reversed_by = $1, reversed_at = NOW(), reversal_reason = $2
      WHERE payment_id = $3 AND payroll_id = $4 AND company_id = $5 AND status = 'recorded'
      RETURNING *
    `, [req.user.userId, reason, paymentId, payrollId, companyId]);
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Payment was not found or has already been reversed" });
    }
    payment = result.rows[0];
    await client.query(`
      UPDATE hrms_payroll_runs SET status = 'approved', updated_at = NOW()
      WHERE payroll_id = $1 AND company_id = $2 AND status = 'paid'
    `, [payrollId, companyId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_payroll_payments", paymentId, "UPDATE", "Payroll payment reversed", payment);
  return res.json({ message: "Payroll payment reversed", payment });
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

export async function listProjectAssignments(req, res) {
  const clauses = ["a.company_id = $1"];
  const values = [req.user.companyId];
  if (req.query.employeeId) {
    const employeeId = positiveInteger(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId must be a positive integer" });
    values.push(employeeId);
    clauses.push(`a.employee_id = $${values.length}`);
  }
  if (req.query.projectId) {
    const projectId = positiveInteger(req.query.projectId);
    if (!projectId) return res.status(400).json({ error: "projectId must be a positive integer" });
    values.push(projectId);
    clauses.push(`a.project_id = $${values.length}`);
  }
  if (req.query.status) {
    if (!["active", "closed", "cancelled"].includes(req.query.status)) {
      return res.status(400).json({ error: "status is invalid" });
    }
    values.push(req.query.status);
    clauses.push(`a.status = $${values.length}`);
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT a.*, e.employee_code, e.first_name, e.last_name,
           p.project_code, p.project_name, s.site_name
    FROM hrms_project_assignments a
    JOIN hrms_employees e ON e.employee_id = a.employee_id AND e.company_id = a.company_id
    JOIN tbl_project p ON p.project_id = a.project_id AND p.company_id = a.company_id
    JOIN tbl_project_sites s ON s.site_id = a.site_id AND s.project_id = a.project_id AND s.company_id = a.company_id
    WHERE ${clauses.join(" AND ")} AND e.is_deleted = FALSE AND p.is_deleted = FALSE AND s.is_deleted = FALSE
    ORDER BY a.start_date DESC, a.assignment_id DESC
  `, values);
  return res.json({ assignments: result.rows });
}

export async function createProjectAssignment(req, res) {
  const payload = req.body || {};
  const employeeId = positiveInteger(payload.employeeId);
  const projectId = positiveInteger(payload.projectId);
  const siteId = positiveInteger(payload.siteId);
  const startDate = parseDate(payload.startDate);
  const endDate = payload.endDate === undefined || payload.endDate === null || payload.endDate === ""
    ? null
    : parseDate(payload.endDate);
  const hourlyRate = finiteNonNegative(payload.hourlyRate);
  const overtimeRate = payload.overtimeRate === undefined
    ? (hourlyRate === null ? null : Math.round(hourlyRate * 1.5 * 100) / 100)
    : finiteNonNegative(payload.overtimeRate);
  if (!employeeId || !projectId || !siteId || !startDate || (payload.endDate && !endDate)
      || (endDate && endDate < startDate) || hourlyRate === null || overtimeRate === null
      || !hasAtMostTwoDecimalPlaces(payload.hourlyRate)
      || !hasAtMostTwoDecimalPlaces(overtimeRate)) {
    return res.status(400).json({ error: "Valid employeeId, projectId, siteId, date range and non-negative rates are required" });
  }

  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let assignment;
  try {
    await client.query("BEGIN");
    const employee = await client.query(`
      SELECT employee_id FROM hrms_employees
      WHERE employee_id = $1 AND company_id = $2 AND status = 'active' AND is_deleted = FALSE
      FOR UPDATE
    `, [employeeId, companyId]);
    if (!employee.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Active employee not found" });
    }
    const project = await client.query(`
      SELECT project_id FROM tbl_project
      WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE
        AND status IN ('planning', 'approved', 'in_progress', 'delayed')
    `, [projectId, companyId]);
    if (!project.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Open project not found" });
    }
    const site = await client.query(`
      SELECT site_id FROM tbl_project_sites
      WHERE site_id = $1 AND project_id = $2 AND company_id = $3
        AND status = 'active' AND is_deleted = FALSE
    `, [siteId, projectId, companyId]);
    if (!site.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Active site does not belong to the selected project" });
    }
    const overlap = await client.query(`
      SELECT assignment_id FROM hrms_project_assignments
      WHERE company_id = $1 AND employee_id = $2 AND project_id = $3 AND site_id = $4
        AND status = 'active' AND start_date <= COALESCE($6::date, 'infinity'::date)
        AND COALESCE(end_date, 'infinity'::date) >= $5::date
      LIMIT 1
    `, [companyId, employeeId, projectId, siteId, startDate, endDate]);
    if (overlap.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An active assignment already overlaps this employee, project and site date range" });
    }
    const inserted = await client.query(`
      INSERT INTO hrms_project_assignments
        (employee_id, project_id, site_id, start_date, end_date, hourly_rate, overtime_rate, assigned_by, company_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [employeeId, projectId, siteId, startDate, endDate, hourlyRate, overtimeRate, req.user.userId, companyId]);
    assignment = inserted.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_project_assignments", assignment.assignment_id, "CREATE", "Project assignment created", assignment);
  return res.status(201).json({ message: "Project assignment created", assignment });
}

export async function closeProjectAssignment(req, res) {
  const assignmentId = positiveInteger(req.params.assignmentId);
  const endDate = parseDate(req.body?.endDate);
  if (!assignmentId || !endDate) return res.status(400).json({ error: "Valid assignmentId and endDate are required" });
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let assignment;
  try {
    await client.query("BEGIN");
    const current = await client.query(`
      SELECT * FROM hrms_project_assignments
      WHERE assignment_id = $1 AND company_id = $2
      FOR UPDATE
    `, [assignmentId, companyId]);
    if (!current.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Project assignment not found" });
    }
    if (current.rows[0].status !== "active") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only active assignments can be closed" });
    }
    if (endDate < String(current.rows[0].start_date).slice(0, 10)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "endDate must not precede the assignment start date" });
    }
    const timesheets = await client.query(`
      SELECT MAX(work_date) AS last_work_date
      FROM hrms_project_timesheets
      WHERE assignment_id = $1 AND company_id = $2 AND status IN ('pending', 'approved')
    `, [assignmentId, companyId]);
    if (timesheets.rows[0].last_work_date && endDate < String(timesheets.rows[0].last_work_date).slice(0, 10)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Assignment cannot end before its latest approved timesheet" });
    }
    const updated = await client.query(`
      UPDATE hrms_project_assignments SET end_date = $1, status = 'closed', updated_at = NOW()
      WHERE assignment_id = $2 AND company_id = $3 RETURNING *
    `, [endDate, assignmentId, companyId]);
    assignment = updated.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_project_assignments", assignmentId, "UPDATE", "Project assignment closed", assignment);
  return res.json({ message: "Project assignment closed", assignment });
}

export async function listProjectTimesheets(req, res) {
  const clauses = ["t.company_id = $1"];
  const values = [req.user.companyId];
  for (const [key, column] of [["employeeId", "t.employee_id"], ["projectId", "t.project_id"], ["status", "t.status"]]) {
    if (req.query[key] === undefined) continue;
    const value = key === "status" ? req.query[key] : positiveInteger(req.query[key]);
    if (key === "status" ? !["pending", "approved", "rejected"].includes(value) : !value) {
      return res.status(400).json({ error: `${key} is invalid` });
    }
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  }
  for (const [key, operator] of [["fromDate", ">="], ["toDate", "<="]]) {
    if (req.query[key] === undefined) continue;
    const date = parseDate(req.query[key]);
    if (!date) return res.status(400).json({ error: `${key} must be a valid YYYY-MM-DD date` });
    values.push(date);
    clauses.push(`t.work_date ${operator} $${values.length}`);
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT t.*, e.employee_code, e.first_name, e.last_name, p.project_code, p.project_name, s.site_name
    FROM hrms_project_timesheets t
    JOIN hrms_employees e ON e.employee_id = t.employee_id AND e.company_id = t.company_id
    JOIN tbl_project p ON p.project_id = t.project_id AND p.company_id = t.company_id
    JOIN tbl_project_sites s ON s.site_id = t.site_id AND s.project_id = t.project_id AND s.company_id = t.company_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY t.work_date DESC, t.timesheet_id DESC
  `, values);
  return res.json({ timesheets: result.rows });
}

export async function createProjectTimesheet(req, res) {
  const payload = req.body || {};
  const assignmentId = positiveInteger(payload.assignmentId);
  const workDate = parseDate(payload.workDate);
  const regularHours = finiteNonNegative(payload.regularHours);
  const overtimeHours = payload.overtimeHours === undefined ? 0 : finiteNonNegative(payload.overtimeHours);
  const activity = text(payload.activity);
  if (!assignmentId || !workDate || workDate > utcToday() || regularHours === null || overtimeHours === null
      || regularHours + overtimeHours <= 0 || regularHours + overtimeHours > 24 || activity.length > 2000) {
    return res.status(400).json({ error: "Valid assignmentId, workDate, positive hours up to 24 and activity (max 2000 characters) are required" });
  }
  if (!hasAtMostTwoDecimalPlaces(payload.regularHours)
      || !hasAtMostTwoDecimalPlaces(payload.overtimeHours === undefined ? 0 : payload.overtimeHours)) {
    return res.status(400).json({ error: "Timesheet hours may have at most two decimal places" });
  }
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let timesheet;
  try {
    await client.query("BEGIN");
    const assignmentResult = await client.query(`
      SELECT a.*, e.employee_id
      FROM hrms_project_assignments a
      JOIN hrms_employees e ON e.employee_id = a.employee_id AND e.company_id = a.company_id
      JOIN tbl_project p ON p.project_id = a.project_id AND p.company_id = a.company_id
      JOIN tbl_project_sites s ON s.site_id = a.site_id AND s.project_id = a.project_id AND s.company_id = a.company_id
      WHERE a.assignment_id = $1 AND a.company_id = $2 AND a.status = 'active'
        AND e.status = 'active' AND e.is_deleted = FALSE
        AND p.is_deleted = FALSE AND p.status NOT IN ('completed', 'closed', 'cancelled', 'on_hold')
        AND s.status = 'active' AND s.is_deleted = FALSE
      FOR UPDATE OF a
    `, [assignmentId, companyId]);
    if (!assignmentResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Active project assignment not found" });
    }
    const assignment = assignmentResult.rows[0];
    const startDate = String(assignment.start_date).slice(0, 10);
    const endDate = assignment.end_date ? String(assignment.end_date).slice(0, 10) : null;
    if (workDate < startDate || (endDate && workDate > endDate)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "workDate must fall within the assignment dates" });
    }
    const activeEmployee = await client.query(`
      SELECT employee_id FROM hrms_employees
      WHERE employee_id = $1 AND company_id = $2 AND status = 'active' AND is_deleted = FALSE
      FOR UPDATE
    `, [assignment.employee_id, companyId]);
    if (!activeEmployee.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Employee is no longer active and cannot submit a timesheet" });
    }
    const existing = await client.query(`
      SELECT COALESCE(SUM(regular_hours + overtime_hours), 0) AS hours
      FROM hrms_project_timesheets
      WHERE employee_id = $1 AND company_id = $2 AND work_date = $3
        AND status IN ('pending', 'approved')
    `, [assignment.employee_id, companyId, workDate]);
    if (Number(existing.rows[0].hours) + regularHours + overtimeHours > 24) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Total submitted and approved timesheet hours cannot exceed 24 per employee per day" });
    }
    const hourlyRate = Number(assignment.hourly_rate);
    const overtimeRate = Number(assignment.overtime_rate);
    const totalCost = computeTimesheetCost({
      regular_hours: regularHours,
      overtime_hours: overtimeHours,
      rate_per_hour: hourlyRate,
      ot_rate_per_hour: overtimeRate,
    });
    const inserted = await client.query(`
      INSERT INTO hrms_project_timesheets
        (assignment_id, employee_id, project_id, site_id, work_date, regular_hours, overtime_hours,
         hourly_rate, overtime_rate, total_cost, activity, submitted_by, company_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      assignmentId, assignment.employee_id, assignment.project_id, assignment.site_id, workDate,
      regularHours, overtimeHours, hourlyRate, overtimeRate, totalCost, activity || null, req.user.userId, companyId,
    ]);
    timesheet = inserted.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "A timesheet already exists for this assignment and work date" });
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_project_timesheets", timesheet.timesheet_id, "CREATE", "Project timesheet submitted", timesheet);
  return res.status(201).json({ message: "Project timesheet submitted for approval", timesheet });
}

export async function reviewProjectTimesheet(req, res) {
  const timesheetId = positiveInteger(req.params.timesheetId);
  const status = req.body?.status;
  const remarks = text(req.body?.remarks);
  if (!timesheetId || !["approved", "rejected"].includes(status) || remarks.length > 1000) {
    return res.status(400).json({ error: "Valid timesheetId, approved/rejected status and remarks (max 1000 characters) are required" });
  }
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let timesheet;
  let projectId;
  try {
    await client.query("BEGIN");
    const current = await client.query(`
      SELECT * FROM hrms_project_timesheets
      WHERE timesheet_id = $1 AND company_id = $2
      FOR UPDATE
    `, [timesheetId, companyId]);
    if (!current.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Timesheet not found" });
    }
    if (current.rows[0].status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only pending timesheets can be reviewed" });
    }
    if (Number(current.rows[0].submitted_by) === Number(req.user.userId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Timesheet submitters cannot review their own timesheets" });
    }
    const updated = await client.query(`
      UPDATE hrms_project_timesheets
      SET status = $1, approved_by = $2, approved_at = NOW(), review_remarks = $3, updated_at = NOW()
      WHERE timesheet_id = $4 AND company_id = $5
      RETURNING *
    `, [status, req.user.userId, remarks || null, timesheetId, companyId]);
    timesheet = updated.rows[0];
    projectId = timesheet.project_id;
    if (status === "approved") {
      await recalcProjectCost(client, { projectId, companyId, category: "labour" });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_project_timesheets", timesheetId, "UPDATE", `Project timesheet ${status}`, timesheet);
  return res.json({ message: `Timesheet ${status}`, timesheet });
}

export async function listEmployeeExits(req, res) {
  const clauses = ["x.company_id = $1"];
  const values = [req.user.companyId];
  if (req.query.status) {
    if (!["pending", "approved", "rejected", "cancelled"].includes(req.query.status)) {
      return res.status(400).json({ error: "status is invalid" });
    }
    values.push(req.query.status);
    clauses.push(`x.status = $${values.length}`);
  }
  if (req.query.employeeId) {
    const employeeId = positiveInteger(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId must be a positive integer" });
    values.push(employeeId);
    clauses.push(`x.employee_id = $${values.length}`);
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT x.*, e.employee_code, e.first_name, e.last_name
    FROM hrms_employee_exits x
    JOIN hrms_employees e ON e.employee_id = x.employee_id AND e.company_id = x.company_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY x.created_at DESC, x.exit_id DESC
  `, values);
  return res.json({ exits: result.rows });
}

export async function createEmployeeExit(req, res) {
  const payload = req.body || {};
  const employeeId = positiveInteger(payload.employeeId);
  const lastWorkingDate = parseDate(payload.lastWorkingDate);
  const exitType = text(payload.exitType);
  const reason = text(payload.reason);
  if (!employeeId || !lastWorkingDate || !["resignation", "termination", "retirement", "contract_end", "other"].includes(exitType)
      || reason.length > 2000) {
    return res.status(400).json({ error: "Valid employeeId, lastWorkingDate, exitType and reason (max 2000 characters) are required" });
  }
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const employee = await companyPool.query(`
    SELECT employee_id FROM hrms_employees
    WHERE employee_id = $1 AND company_id = $2 AND status = 'active' AND is_deleted = FALSE
  `, [employeeId, companyId]);
  if (!employee.rows.length) return res.status(404).json({ error: "Active employee not found" });
  let result;
  try {
    result = await companyPool.query(`
      INSERT INTO hrms_employee_exits
        (employee_id, last_working_date, exit_type, reason, requested_by, company_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `, [employeeId, lastWorkingDate, exitType, reason || null, req.user.userId, companyId]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "A pending exit request already exists for this employee" });
    throw error;
  }
  await audit(req, companyPool, "hrms_employee_exits", result.rows[0].exit_id, "CREATE", "Employee exit requested", result.rows[0]);
  return res.status(201).json({ message: "Employee exit request submitted", exit: result.rows[0] });
}

export async function reviewEmployeeExit(req, res) {
  const exitId = positiveInteger(req.params.exitId);
  const status = req.body?.status;
  const remarks = text(req.body?.remarks);
  if (!exitId || !["approved", "rejected"].includes(status) || remarks.length > 1000) {
    return res.status(400).json({ error: "Valid exitId, approved/rejected status and remarks (max 1000 characters) are required" });
  }
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let exit;
  let employee;
  try {
    await client.query("BEGIN");
    const current = await client.query(`
      SELECT x.*, e.user_id, e.status AS employee_status
      FROM hrms_employee_exits x
      JOIN hrms_employees e ON e.employee_id = x.employee_id AND e.company_id = x.company_id
      WHERE x.exit_id = $1 AND x.company_id = $2
      FOR UPDATE OF x, e
    `, [exitId, companyId]);
    if (!current.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee exit request not found" });
    }
    exit = current.rows[0];
    if (exit.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only pending exit requests can be reviewed" });
    }
    if (Number(exit.requested_by) === Number(req.user.userId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Exit requesters cannot approve their own exit request" });
    }
    if (status === "approved" && exit.last_working_date > utcToday()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An exit cannot be approved before the last working date" });
    }
    const updated = await client.query(`
      UPDATE hrms_employee_exits
      SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_remarks = $3, updated_at = NOW()
      WHERE exit_id = $4 AND company_id = $5
      RETURNING *
    `, [status, req.user.userId, remarks || null, exitId, companyId]);
    exit = updated.rows[0];
    if (status === "approved") {
      const employeeResult = await client.query(`
        UPDATE hrms_employees SET status = 'terminated', updated_at = NOW()
        WHERE employee_id = $1 AND company_id = $2 AND status = 'active'
        RETURNING user_id, email
      `, [exit.employee_id, companyId]);
      if (!employeeResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Employee is no longer active; exit request cannot be approved" });
      }
      employee = employeeResult.rows[0];
      if (employee.user_id) {
        await client.query(`
          UPDATE users SET status = 'inactive', updated_at = NOW()
          WHERE user_id = $1 AND company_id = $2
        `, [employee.user_id, companyId]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_employee_exits", exitId, "APPROVE", `Employee exit ${status}`, exit);
  if (status === "approved" && employee?.user_id) {
    await adminPool.query(`
      UPDATE global_users SET status = 'inactive'
      WHERE email = $1 AND company_id = $2 AND is_deleted = FALSE
    `, [employee.email, companyId]);
  }
  return res.json({ message: `Employee exit ${status}`, exit });
}

export async function listTrainingCourses(req, res) {
  const clauses = ["t.company_id = $1"];
  const values = [req.user.companyId];
  if (req.query.status) {
    if (!["planned", "in_progress", "completed", "cancelled"].includes(req.query.status)) {
      return res.status(400).json({ error: "status is invalid" });
    }
    values.push(req.query.status);
    clauses.push(`t.status = $${values.length}`);
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT t.*, COUNT(p.participant_id) AS participant_count
    FROM hrms_training_courses t
    LEFT JOIN hrms_training_participants p
      ON p.training_id = t.training_id AND p.company_id = t.company_id
    WHERE ${clauses.join(" AND ")}
    GROUP BY t.training_id
    ORDER BY t.starts_on DESC NULLS LAST, t.training_id DESC
  `, values);
  return res.json({ trainings: result.rows });
}

export async function createTrainingCourse(req, res) {
  const payload = req.body || {};
  const title = text(payload.title);
  const provider = text(payload.provider);
  const description = text(payload.description);
  const startsOn = payload.startsOn ? parseDate(payload.startsOn) : null;
  const endsOn = payload.endsOn ? parseDate(payload.endsOn) : null;
  if (!title || title.length > 180 || provider.length > 180 || description.length > 4000
      || (payload.startsOn && !startsOn) || (payload.endsOn && !endsOn)
      || (startsOn && endsOn && endsOn < startsOn)) {
    return res.status(400).json({ error: "Valid title (max 180), provider (max 180), date range and description (max 4000) are required" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    INSERT INTO hrms_training_courses
      (title, provider, description, starts_on, ends_on, created_by, company_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [title, provider || null, description || null, startsOn, endsOn, req.user.userId, req.user.companyId]);
  await audit(req, companyPool, "hrms_training_courses", result.rows[0].training_id, "CREATE", "Training course created", result.rows[0]);
  return res.status(201).json({ message: "Training course created", training: result.rows[0] });
}

export async function updateTrainingCourse(req, res) {
  const trainingId = positiveInteger(req.params.trainingId);
  const status = req.body?.status;
  if (!trainingId || !["planned", "in_progress", "completed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Valid trainingId and status are required" });
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    UPDATE hrms_training_courses SET status = $1, updated_at = NOW()
    WHERE training_id = $2 AND company_id = $3 RETURNING *
  `, [status, trainingId, req.user.companyId]);
  if (!result.rows.length) return res.status(404).json({ error: "Training course not found" });
  await audit(req, companyPool, "hrms_training_courses", trainingId, "UPDATE", "Training course status updated", result.rows[0]);
  return res.json({ message: "Training course updated", training: result.rows[0] });
}

export async function listTrainingParticipants(req, res) {
  const trainingId = positiveInteger(req.params.trainingId);
  if (!trainingId) return res.status(400).json({ error: "trainingId must be a positive integer" });
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT p.*, e.employee_code, e.first_name, e.last_name
    FROM hrms_training_participants p
    JOIN hrms_employees e ON e.employee_id = p.employee_id AND e.company_id = p.company_id
    WHERE p.training_id = $1 AND p.company_id = $2
    ORDER BY e.first_name, e.last_name, e.employee_id
  `, [trainingId, req.user.companyId]);
  return res.json({ participants: result.rows });
}

export async function saveTrainingParticipant(req, res) {
  const trainingId = positiveInteger(req.params.trainingId);
  const employeeId = positiveInteger(req.body?.employeeId);
  const status = req.body?.status || "nominated";
  const completedOn = req.body?.completedOn ? parseDate(req.body.completedOn) : null;
  const resultNotes = text(req.body?.resultNotes);
  if (!trainingId || !employeeId || !["nominated", "in_progress", "completed", "failed", "cancelled"].includes(status)
      || (req.body?.completedOn && !completedOn) || resultNotes.length > 2000) {
    return res.status(400).json({ error: "Valid trainingId, employeeId, participant status, completion date and notes (max 2000 characters) are required" });
  }
  if (status === "completed" && !completedOn) {
    return res.status(400).json({ error: "completedOn is required when participant status is completed" });
  }
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let participant;
  try {
    await client.query("BEGIN");
    const [training, employee] = await Promise.all([
      client.query("SELECT training_id FROM hrms_training_courses WHERE training_id = $1 AND company_id = $2 FOR UPDATE", [trainingId, companyId]),
      client.query("SELECT employee_id FROM hrms_employees WHERE employee_id = $1 AND company_id = $2 AND status = 'active' AND is_deleted = FALSE", [employeeId, companyId]),
    ]);
    if (!training.rows.length || !employee.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Training course or active employee not found" });
    }
    const saved = await client.query(`
      INSERT INTO hrms_training_participants
        (training_id, employee_id, status, completed_on, result_notes, updated_by, company_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (training_id, employee_id, company_id)
      DO UPDATE SET status = EXCLUDED.status, completed_on = EXCLUDED.completed_on,
                    result_notes = EXCLUDED.result_notes, updated_by = EXCLUDED.updated_by,
                    updated_at = NOW()
      RETURNING *
    `, [trainingId, employeeId, status, completedOn, resultNotes || null, req.user.userId, companyId]);
    participant = saved.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_training_participants", participant.participant_id, "UPDATE", "Training participant updated", participant);
  return res.json({ message: "Training participant saved", participant });
}

export async function listAppraisals(req, res) {
  const clauses = ["a.company_id = $1"];
  const values = [req.user.companyId];
  if (req.query.status) {
    if (!["draft", "submitted", "approved", "rejected"].includes(req.query.status)) {
      return res.status(400).json({ error: "status is invalid" });
    }
    values.push(req.query.status);
    clauses.push(`a.status = $${values.length}`);
  }
  if (req.query.employeeId) {
    const employeeId = positiveInteger(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId must be a positive integer" });
    values.push(employeeId);
    clauses.push(`a.employee_id = $${values.length}`);
  }
  const companyPool = await getCompanyPool(req.user.companyId);
  const result = await companyPool.query(`
    SELECT a.*, e.employee_code, e.first_name, e.last_name,
           reviewer.first_name AS reviewer_first_name, reviewer.last_name AS reviewer_last_name
    FROM hrms_appraisals a
    JOIN hrms_employees e ON e.employee_id = a.employee_id AND e.company_id = a.company_id
    JOIN users reviewer ON reviewer.user_id = a.reviewer_user_id AND reviewer.company_id = a.company_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY a.period_end DESC, a.appraisal_id DESC
  `, values);
  return res.json({ appraisals: result.rows });
}

export async function createAppraisal(req, res) {
  const employeeId = positiveInteger(req.body?.employeeId);
  const reviewerUserId = positiveInteger(req.body?.reviewerUserId);
  const periodStart = parseDate(req.body?.periodStart);
  const periodEnd = parseDate(req.body?.periodEnd);
  if (!employeeId || !reviewerUserId || !periodStart || !periodEnd || periodEnd < periodStart) {
    return res.status(400).json({ error: "Valid employeeId, reviewerUserId and appraisal period are required" });
  }
  if (reviewerUserId === Number(req.user.userId)) {
    return res.status(400).json({ error: "An appraisal reviewer cannot be the employee creating the appraisal" });
  }
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const validation = await companyPool.query(`
    SELECT e.employee_id
    FROM hrms_employees e
    JOIN users u ON u.user_id = $2 AND u.company_id = e.company_id AND u.status = 'active' AND u.is_deleted = FALSE
    WHERE e.employee_id = $1 AND e.company_id = $3 AND e.is_deleted = FALSE
  `, [employeeId, reviewerUserId, companyId]);
  if (!validation.rows.length) return res.status(404).json({ error: "Employee or active reviewer not found" });
  let result;
  try {
    result = await companyPool.query(`
      INSERT INTO hrms_appraisals
        (employee_id, reviewer_user_id, period_start, period_end, company_id)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [employeeId, reviewerUserId, periodStart, periodEnd, companyId]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "An appraisal already exists for this employee and period" });
    throw error;
  }
  await audit(req, companyPool, "hrms_appraisals", result.rows[0].appraisal_id, "CREATE", "Appraisal created", result.rows[0]);
  return res.status(201).json({ message: "Appraisal created", appraisal: result.rows[0] });
}

export async function submitAppraisal(req, res) {
  const appraisalId = positiveInteger(req.params.appraisalId);
  const rating = req.body?.rating === undefined || req.body?.rating === null ? null : Number(req.body.rating);
  const achievements = text(req.body?.achievements);
  const goals = text(req.body?.goals);
  const feedback = text(req.body?.feedback);
  if (!appraisalId || (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5))
      || achievements.length > 4000 || goals.length > 4000 || feedback.length > 4000) {
    return res.status(400).json({ error: "Valid appraisalId, rating (1-5) and review text (max 4000 characters per field) are required" });
  }
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const result = await companyPool.query(`
    UPDATE hrms_appraisals
    SET rating = $1, achievements = $2, goals = $3, feedback = $4, status = 'submitted', updated_at = NOW()
    WHERE appraisal_id = $5 AND company_id = $6 AND reviewer_user_id = $7 AND status = 'draft'
    RETURNING *
  `, [rating, achievements || null, goals || null, feedback || null, appraisalId, companyId, req.user.userId]);
  if (!result.rows.length) {
    const exists = await companyPool.query(
      "SELECT status FROM hrms_appraisals WHERE appraisal_id = $1 AND company_id = $2",
      [appraisalId, companyId]
    );
    if (!exists.rows.length) return res.status(404).json({ error: "Appraisal not found" });
    return res.status(409).json({ error: "Only the assigned reviewer can submit a draft appraisal" });
  }
  await audit(req, companyPool, "hrms_appraisals", appraisalId, "UPDATE", "Appraisal submitted", result.rows[0]);
  return res.json({ message: "Appraisal submitted for approval", appraisal: result.rows[0] });
}

export async function reviewAppraisal(req, res) {
  const appraisalId = positiveInteger(req.params.appraisalId);
  const status = req.body?.status;
  if (!appraisalId || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Valid appraisalId and approved/rejected status are required" });
  }
  const companyId = req.user.companyId;
  const companyPool = await getCompanyPool(companyId);
  const client = await companyPool.connect();
  let appraisal;
  try {
    await client.query("BEGIN");
    const current = await client.query(`
      SELECT * FROM hrms_appraisals
      WHERE appraisal_id = $1 AND company_id = $2
      FOR UPDATE
    `, [appraisalId, companyId]);
    if (!current.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Appraisal not found" });
    }
    if (current.rows[0].status !== "submitted") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only submitted appraisals can be reviewed" });
    }
    if (Number(current.rows[0].reviewer_user_id) === Number(req.user.userId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Appraisal reviewers cannot approve their own appraisals" });
    }
    const result = await client.query(`
      UPDATE hrms_appraisals SET status = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
      WHERE appraisal_id = $3 AND company_id = $4 RETURNING *
    `, [status, req.user.userId, appraisalId, companyId]);
    appraisal = result.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await audit(req, companyPool, "hrms_appraisals", appraisalId, "APPROVE", `Appraisal ${status}`, appraisal);
  return res.json({ message: `Appraisal ${status}`, appraisal });
}
