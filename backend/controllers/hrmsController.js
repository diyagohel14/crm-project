import { getCompanyPool } from "../config/companyPoolManager.js";
import { logAudit } from "../services/authService.js";
import { hasPermission } from "../services/permissionService.js";
import { getRequestInfo } from "../utils/crypto.js";
import {
  calculateConfiguredDeduction,
  calculateLeaveDays,
  calculateLeaveDaysByYear,
  calculateOvertimePay,
  calculatePayrollBreakdown,
  canTransitionLeaveStatus,
  isValidDateOnly,
  isValidTime,
} from "../services/hrmsService.js";

const employeeStatusSet = new Set(["active", "inactive", "on_leave", "terminated", "pending"]);
const attendanceStatusSet = new Set(["present", "absent", "late", "half_day", "holiday", "on_leave"]);
const leaveStatusSet = new Set(["pending", "approved", "rejected", "cancelled"]);
const payrollStatusSet = new Set(["draft", "approved", "paid"]);

function sanitizeString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeStatus(value, fallback, allowedSet) {
  const normalized = sanitizeString(value) ?? fallback;
  return allowedSet.has(normalized) ? normalized : fallback;
}

function buildEmployeeCode() {
  return `EMP-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function employeeResponse(employee, user) {
  if (hasPermission(user.permissions || [], "hrms_employee:private:view")) return employee;
  const {
    bank_name,
    bank_account_no,
    ifsc_code,
    tax_id,
    ...publicEmployee
  } = employee;
  return publicEmployee;
}

function hasPrivateEmployeeFields(payload) {
  return ["bankName", "bank_name", "bankAccountNo", "bank_account_no", "ifscCode", "ifsc_code", "taxId", "tax_id"].some((field) =>
    Object.prototype.hasOwnProperty.call(payload, field)
  );
}

export async function listEmployees(req, res) {
  const { companyId } = req.user;
  const companyPool = await getCompanyPool(companyId);
  const { status, departmentId, search } = req.query;
  const params = [companyId];
  const clauses = ["e.company_id = $1", "e.is_deleted = FALSE"];
  let index = 2;

  if (status) {
    clauses.push(`e.status = $${index}`);
    params.push(status);
    index += 1;
  }

  if (departmentId) {
    clauses.push(`e.department_id = $${index}`);
    params.push(departmentId);
    index += 1;
  }

  if (search) {
    clauses.push(`(
      LOWER(e.first_name) LIKE $${index}
      OR LOWER(e.last_name) LIKE $${index}
      OR LOWER(e.email) LIKE $${index}
      OR LOWER(e.employee_code) LIKE $${index}
    )`);
    const term = `%${String(search).toLowerCase()}%`;
    params.push(term);
    index += 1;
  }

  const result = await companyPool.query(`
    SELECT e.*, d.department_name, ds.designation_name, b.branch_name, sm.shift_name
    FROM hrms_employees e
    LEFT JOIN departments d ON d.department_id = e.department_id
    LEFT JOIN designations ds ON ds.designation_id = e.designation_id
    LEFT JOIN branch_mst b ON b.branch_id = e.branch_id
    LEFT JOIN shift_master sm ON sm.shift_id = e.shift_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.created_at DESC
  `, params);

  return res.json({ employees: result.rows.map((employee) => employeeResponse(employee, req.user)) });
}

export async function createEmployee(req, res) {
  const { companyId, userId, roleId } = req.user;
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  const companyPool = await getCompanyPool(companyId);
  const payload = req.body || {};

  const firstName = sanitizeString(payload.firstName ?? payload.first_name);
  const email = sanitizeString(payload.email);
  const phone = sanitizeString(payload.phone);
  const joiningDate = sanitizeString(payload.joiningDate ?? payload.joining_date) || new Date().toISOString().slice(0, 10);
  const status = normalizeStatus(payload.status ?? "active", "active", employeeStatusSet);

  if (!firstName || !email || !phone) {
    return res.status(400).json({ error: "firstName, email and phone are required" });
  }
  if (hasPrivateEmployeeFields(payload) && !hasPermission(req.user.permissions || [], "hrms_employee:private:update")) {
    return res.status(403).json({ error: "Missing required permission: hrms_employee:private:update" });
  }

  try {
    const result = await companyPool.query(`
      INSERT INTO hrms_employees (
        company_id, employee_code, first_name, last_name, email, phone, gender,
        date_of_birth, joining_date, employment_type, status, department_id,
        designation_id, branch_id, shift_id, manager_user_id, work_location,
        address_line1, city_id, state_id, country_id, pincode,
        emergency_contact_name, emergency_contact_phone, bank_name,
        bank_account_no, ifsc_code, tax_id, created_by, user_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
      ) RETURNING *
    `, [
      companyId,
      sanitizeString(payload.employeeCode ?? payload.employee_code) || buildEmployeeCode(),
      firstName,
      sanitizeString(payload.lastName ?? payload.last_name),
      email,
      phone,
      sanitizeString(payload.gender),
      sanitizeString(payload.dateOfBirth ?? payload.date_of_birth),
      joiningDate,
      sanitizeString(payload.employmentType ?? payload.employment_type) || "full_time",
      status,
      payload.departmentId ?? payload.department_id ?? null,
      payload.designationId ?? payload.designation_id ?? null,
      payload.branchId ?? payload.branch_id ?? null,
      payload.shiftId ?? payload.shift_id ?? null,
      payload.managerUserId ?? payload.manager_user_id ?? null,
      sanitizeString(payload.workLocation ?? payload.work_location),
      sanitizeString(payload.addressLine1 ?? payload.address_line1),
      payload.cityId ?? payload.city_id ?? null,
      payload.stateId ?? payload.state_id ?? null,
      payload.countryId ?? payload.country_id ?? null,
      sanitizeString(payload.pincode),
      sanitizeString(payload.emergencyContactName ?? payload.emergency_contact_name),
      sanitizeString(payload.emergencyContactPhone ?? payload.emergency_contact_phone),
      sanitizeString(payload.bankName ?? payload.bank_name),
      sanitizeString(payload.bankAccountNo ?? payload.bank_account_no),
      sanitizeString(payload.ifscCode ?? payload.ifsc_code),
      sanitizeString(payload.taxId ?? payload.tax_id),
      userId,
      userId,
    ]);

    await logAudit(companyPool, {
      module_name: "HRMS",
      page_name: "Employee Create",
      table_name: "hrms_employees",
      table_id: String(result.rows[0].employee_id),
      action_type: "CREATE",
      action_description: "Employee profile created",
      new_value: JSON.stringify(result.rows[0]),
      user_id: userId,
      role_id: roleId,
      ip_address: ipAddress,
      device_info: deviceInfo,
      company_id: companyId,
    });

    return res.status(201).json({ message: "Employee created", employee: employeeResponse(result.rows[0], req.user) });
  } catch (error) {
    console.error("[createEmployee]", error);
    return res.status(500).json({ error: "Failed to create employee", detail: error.message });
  }
}

export async function getEmployee(req, res) {
  const { companyId } = req.user;
  const { employeeId } = req.params;
  const companyPool = await getCompanyPool(companyId);

  const result = await companyPool.query(`
    SELECT e.*, d.department_name, ds.designation_name
    FROM hrms_employees e
    LEFT JOIN departments d ON d.department_id = e.department_id
    LEFT JOIN designations ds ON ds.designation_id = e.designation_id
    WHERE e.company_id = $1 AND e.employee_id = $2 AND e.is_deleted = FALSE
  `, [companyId, employeeId]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Employee not found" });
  }

  return res.json({ employee: employeeResponse(result.rows[0], req.user) });
}

export async function updateEmployee(req, res) {
  const { companyId, userId, roleId } = req.user;
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  const { employeeId } = req.params;
  const companyPool = await getCompanyPool(companyId);
  const payload = req.body || {};
  const updates = [];
  const values = [];
  let index = 1;

  const map = {
    firstName: "first_name",
    lastName: "last_name",
    email: "email",
    phone: "phone",
    gender: "gender",
    dateOfBirth: "date_of_birth",
    joiningDate: "joining_date",
    employmentType: "employment_type",
    status: "status",
    departmentId: "department_id",
    designationId: "designation_id",
    branchId: "branch_id",
    shiftId: "shift_id",
    managerUserId: "manager_user_id",
    workLocation: "work_location",
    addressLine1: "address_line1",
    cityId: "city_id",
    stateId: "state_id",
    countryId: "country_id",
    pincode: "pincode",
    emergencyContactName: "emergency_contact_name",
    emergencyContactPhone: "emergency_contact_phone",
    bankName: "bank_name",
    bankAccountNo: "bank_account_no",
    ifscCode: "ifsc_code",
    taxId: "tax_id",
  };

  for (const [key, value] of Object.entries(payload)) {
    const column = map[key];
    if (value === undefined || !column) continue;
    updates.push(`${column} = $${index}`);
    values.push(value === null ? null : value);
    index += 1;
  }

  if (hasPrivateEmployeeFields(payload) && !hasPermission(req.user.permissions || [], "hrms_employee:private:update")) {
    return res.status(403).json({ error: "Missing required permission: hrms_employee:private:update" });
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No employee fields provided to update" });
  }

  updates.push("updated_at = NOW()");
  values.push(employeeId, companyId);

  const result = await companyPool.query(`
    UPDATE hrms_employees
    SET ${updates.join(", ")}
    WHERE employee_id = $${index} AND company_id = $${index + 1} AND is_deleted = FALSE
    RETURNING *
  `, values);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Employee not found" });
  }

  await logAudit(companyPool, {
    module_name: "HRMS",
    page_name: "Employee Update",
    table_name: "hrms_employees",
    table_id: String(result.rows[0].employee_id),
    action_type: "UPDATE",
    action_description: "Employee profile updated",
    new_value: JSON.stringify(result.rows[0]),
    user_id: userId,
    role_id: roleId,
    ip_address: ipAddress,
    device_info: deviceInfo,
    company_id: companyId,
  });

  return res.json({ message: "Employee updated", employee: employeeResponse(result.rows[0], req.user) });
}

export async function deleteEmployee(req, res) {
  const { companyId, userId, roleId } = req.user;
  const { employeeId } = req.params;
  const companyPool = await getCompanyPool(companyId);
  const { ipAddress, deviceInfo } = getRequestInfo(req);

  const result = await companyPool.query(`
    UPDATE hrms_employees
    SET is_deleted = TRUE, status = 'inactive', updated_at = NOW()
    WHERE employee_id = $1 AND company_id = $2 AND is_deleted = FALSE
    RETURNING *
  `, [employeeId, companyId]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Employee not found" });
  }

  await logAudit(companyPool, {
    module_name: "HRMS",
    page_name: "Employee Delete",
    table_name: "hrms_employees",
    table_id: String(result.rows[0].employee_id),
    action_type: "DELETE",
    action_description: "Employee profile archived",
    new_value: JSON.stringify(result.rows[0]),
    user_id: userId,
    role_id: roleId,
    ip_address: ipAddress,
    device_info: deviceInfo,
    company_id: companyId,
  });

  return res.json({ message: "Employee deleted", employee: employeeResponse(result.rows[0], req.user) });
}

export async function listAttendance(req, res) {
  const { companyId } = req.user;
  const { employeeId, fromDate, toDate, status } = req.query;
  const companyPool = await getCompanyPool(companyId);
  const params = [companyId];
  const clauses = ["a.company_id = $1"];
  let index = 2;

  if (employeeId !== undefined) {
    const validatedEmployeeId = Number(employeeId);
    if (!Number.isInteger(validatedEmployeeId) || validatedEmployeeId <= 0) {
      return res.status(400).json({ error: "employeeId must be a positive integer" });
    }
    clauses.push(`a.employee_id = $${index}`);
    params.push(validatedEmployeeId);
    index += 1;
  }

  if (fromDate !== undefined) {
    if (!isValidDateOnly(fromDate)) return res.status(400).json({ error: "fromDate must be a valid YYYY-MM-DD date" });
    clauses.push(`a.attendance_date >= $${index}`);
    params.push(fromDate);
    index += 1;
  }

  if (toDate !== undefined) {
    if (!isValidDateOnly(toDate)) return res.status(400).json({ error: "toDate must be a valid YYYY-MM-DD date" });
    clauses.push(`a.attendance_date <= $${index}`);
    params.push(toDate);
    index += 1;
  }

  if (fromDate && toDate && fromDate > toDate) {
    return res.status(400).json({ error: "fromDate must not be after toDate" });
  }

  if (status !== undefined) {
    if (!attendanceStatusSet.has(status)) return res.status(400).json({ error: "status is invalid" });
    clauses.push(`a.status = $${index}`);
    params.push(status);
    index += 1;
  }

  const result = await companyPool.query(`
    SELECT a.*, e.first_name, e.last_name, e.employee_code
    FROM hrms_attendance a
    JOIN hrms_employees e ON e.employee_id = a.employee_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY a.attendance_date DESC
  `, params);

  return res.json({ attendance: result.rows });
}

export async function createAttendance(req, res) {
  const { companyId, userId, roleId } = req.user;
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  const companyPool = await getCompanyPool(companyId);
  const payload = req.body || {};
  const employeeId = Number(payload.employeeId ?? payload.employee_id);
  const attendanceDate = sanitizeString(payload.attendanceDate ?? payload.attendance_date) || new Date().toISOString().slice(0, 10);
  const rawStatus = sanitizeString(payload.status ?? "present");
  const status = normalizeStatus(rawStatus, "present", attendanceStatusSet);
  const checkIn = sanitizeString(payload.checkIn ?? payload.check_in);
  const checkOut = sanitizeString(payload.checkOut ?? payload.check_out);

  if (!Number.isInteger(employeeId) || employeeId <= 0 || !isValidDateOnly(attendanceDate)) {
    return res.status(400).json({ error: "A positive employeeId and valid attendanceDate are required" });
  }
  if (!attendanceStatusSet.has(rawStatus)) {
    return res.status(400).json({ error: "Invalid attendance status" });
  }
  if ((checkIn && !isValidTime(checkIn)) || (checkOut && !isValidTime(checkOut))) {
    return res.status(400).json({ error: "checkIn and checkOut must use HH:MM or HH:MM:SS format" });
  }
  const attendanceExists = await companyPool.query(
    `SELECT 1 FROM hrms_employees e
     WHERE e.employee_id = $1 AND e.company_id = $2 AND e.is_deleted = FALSE AND e.status = 'active'`,
    [employeeId, companyId]
  );
  if (!attendanceExists.rows.length) {
    return res.status(404).json({ error: "Active employee not found" });
  }
  let result;
  try {
    result = await companyPool.query(`
        INSERT INTO hrms_attendance (employee_id, attendance_date, check_in, check_out, status, notes, company_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
          `, [employeeId, attendanceDate, checkIn || null, checkOut || null, status, sanitizeString(payload.notes) || null, companyId]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Attendance already exists for this employee and date; submit a correction request" });
    }
    throw error;
  }

  await logAudit(companyPool, {
    module_name: "HRMS",
    page_name: "Attendance",
    table_name: "hrms_attendance",
    table_id: String(result.rows[0].attendance_id),
    action_type: "CREATE",
    action_description: "Attendance record created",
    new_value: JSON.stringify(result.rows[0]),
    user_id: userId,
    role_id: roleId,
    ip_address: ipAddress,
    device_info: deviceInfo,
    company_id: companyId,
  });

  return res.status(201).json({ message: "Attendance saved", attendance: result.rows[0] });
}

export async function listLeaveRequests(req, res) {
  const { companyId } = req.user;
  const { employeeId, status } = req.query;
  const companyPool = await getCompanyPool(companyId);
  const params = [companyId];
  const clauses = ["l.company_id = $1"];
  let index = 2;

  if (employeeId) {
    clauses.push(`l.employee_id = $${index}`);
    params.push(employeeId);
    index += 1;
  }

  if (status) {
    clauses.push(`l.status = $${index}`);
    params.push(status);
    index += 1;
  }

  const result = await companyPool.query(`
    SELECT l.*, e.first_name, e.last_name, e.employee_code
    FROM hrms_leave_requests l
    JOIN hrms_employees e ON e.employee_id = l.employee_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY l.created_at DESC
  `, params);

  return res.json({ leaveRequests: result.rows });
}

export async function createLeaveRequest(req, res) {
  const { companyId, userId, roleId } = req.user;
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  const companyPool = await getCompanyPool(companyId);
  const payload = req.body || {};
  const employeeId = Number(payload.employeeId ?? payload.employee_id);
  const startDate = sanitizeString(payload.startDate ?? payload.start_date);
  const endDate = sanitizeString(payload.endDate ?? payload.end_date);
  const leaveType = sanitizeString(payload.leaveType ?? payload.leave_type) || "casual";

  if (!employeeId || !startDate || !endDate) {
    return res.status(400).json({ error: "employeeId, startDate and endDate are required" });
  }

  const totalDays = calculateLeaveDays(startDate, endDate);
  if (totalDays === 0) {
    return res.status(400).json({ error: "startDate and endDate must be valid dates in ascending order" });
  }
  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
    return res.status(400).json({ error: "startDate and endDate must be valid YYYY-MM-DD dates" });
  }
  const employee = await companyPool.query(
    `SELECT employee_id FROM hrms_employees
     WHERE employee_id = $1 AND company_id = $2 AND is_deleted = FALSE AND status = 'active'`,
    [employeeId, companyId]
  );
  if (!employee.rows.length) return res.status(404).json({ error: "Active employee not found" });
  const result = await companyPool.query(`
    INSERT INTO hrms_leave_requests (
      employee_id, leave_type, start_date, end_date, total_days, reason,
      status, requested_by, company_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *
  `, [employeeId, leaveType, startDate, endDate, totalDays, sanitizeString(payload.reason), "pending", userId, companyId]);

  await logAudit(companyPool, {
    module_name: "HRMS",
    page_name: "Leave Request",
    table_name: "hrms_leave_requests",
    table_id: String(result.rows[0].leave_id),
    action_type: "CREATE",
    action_description: "Leave request submitted",
    new_value: JSON.stringify(result.rows[0]),
    user_id: userId,
    role_id: roleId,
    ip_address: ipAddress,
    device_info: deviceInfo,
    company_id: companyId,
  });

  return res.status(201).json({ message: "Leave request created", leaveRequest: result.rows[0] });
}

export async function updateLeaveRequest(req, res) {
  const { companyId, userId, roleId } = req.user;
  const { leaveId } = req.params;
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  const payload = req.body || {};
  const companyPool = await getCompanyPool(companyId);
  const status = sanitizeString(payload.status);
  if (!leaveStatusSet.has(status)) {
    return res.status(400).json({ error: "status must be pending, approved, rejected or cancelled" });
  }

  const client = await companyPool.connect();
  let leaveRequest;
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(`
      SELECT * FROM hrms_leave_requests
      WHERE leave_id = $1 AND company_id = $2 AND is_deleted = FALSE
      FOR UPDATE
    `, [leaveId, companyId]);
    if (currentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Leave request not found" });
    }
    const current = currentResult.rows[0];
    if (!canTransitionLeaveStatus(current.status, status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Leave request cannot transition from ${current.status} to ${status}` });
    }
    if (["approved", "rejected"].includes(status)) {
      if (!hasPermission(req.user.permissions || [], "hrms_leave:approve")) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Missing required permission: hrms_leave:approve" });
      }
      if (Number(current.requested_by) === Number(userId)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "A user cannot approve or reject their own leave request" });
      }
    }
    if (status === "cancelled" && current.status === "pending"
      && Number(current.requested_by) !== Number(userId)
      && !hasPermission(req.user.permissions || [], "hrms_leave:approve")) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Only the requester or a leave approver can cancel a pending request" });
    }
    const result = await client.query(`
      UPDATE hrms_leave_requests
      SET status = $1, approved_by = $2, approved_at = CASE WHEN $1 IN ('approved', 'rejected') THEN NOW() ELSE NULL END,
          remarks = $3, updated_at = NOW()
      WHERE leave_id = $4 AND company_id = $5
      RETURNING *
    `, [status, userId, sanitizeString(payload.remarks), leaveId, companyId]);
    leaveRequest = result.rows[0];

    const approvalDelta = Number(status === "approved") - Number(current.status === "approved");
    if (approvalDelta !== 0) {
      for (const { year, days } of calculateLeaveDaysByYear(current.start_date, current.end_date)) {
        if (approvalDelta > 0) {
          await client.query(`
            INSERT INTO hrms_leave_balances
              (employee_id, leave_type, leave_year, used_days, updated_by, company_id)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (employee_id, leave_type, leave_year, company_id)
            DO UPDATE SET used_days = hrms_leave_balances.used_days + $4,
              updated_by = $5, updated_at = NOW()
          `, [current.employee_id, current.leave_type, year, days, userId, companyId]);
        } else {
          await client.query(`
            UPDATE hrms_leave_balances
            SET used_days = GREATEST(0, used_days - $1), updated_by = $2, updated_at = NOW()
            WHERE employee_id = $3 AND leave_type = $4 AND leave_year = $5 AND company_id = $6
          `, [days, userId, current.employee_id, current.leave_type, year, companyId]);
        }
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!leaveRequest) {
    return res.status(404).json({ error: "Leave request not found" });
  }

  await logAudit(companyPool, {
    module_name: "HRMS",
    page_name: "Leave Approval",
    table_name: "hrms_leave_requests",
    table_id: String(leaveRequest.leave_id),
    action_type: "UPDATE",
    action_description: `Leave request status changed to ${leaveRequest.status}`,
    new_value: JSON.stringify(leaveRequest),
    user_id: userId,
    role_id: roleId,
    ip_address: ipAddress,
    device_info: deviceInfo,
    company_id: companyId,
  });

  return res.json({ message: "Leave request updated", leaveRequest });
}

export async function listPayrollRuns(req, res) {
  const { companyId } = req.user;
  const companyPool = await getCompanyPool(companyId);
  const result = await companyPool.query(`
    SELECT p.*, COUNT(pi.payroll_item_id) AS employee_count, SUM(pi.net_salary) AS net_payroll_total,
           (SELECT COALESCE(SUM(pm.amount), 0)
            FROM hrms_payroll_payments pm
            WHERE pm.payroll_id = p.payroll_id AND pm.company_id = p.company_id
              AND pm.status = 'recorded') AS total_paid
    FROM hrms_payroll_runs p
    LEFT JOIN hrms_payroll_items pi ON pi.payroll_id = p.payroll_id AND pi.company_id = p.company_id
    WHERE p.company_id = $1
    GROUP BY p.payroll_id
    ORDER BY p.pay_period_end DESC
  `, [companyId]);

  return res.json({ payrollRuns: result.rows });
}

export async function createPayrollRun(req, res) {
  const { companyId, userId, roleId } = req.user;
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  const companyPool = await getCompanyPool(companyId);
  const payload = req.body || {};
  const payPeriodStart = sanitizeString(payload.payPeriodStart ?? payload.pay_period_start) || new Date().toISOString().slice(0, 10);
  const payPeriodEnd = sanitizeString(payload.payPeriodEnd ?? payload.pay_period_end) || new Date().toISOString().slice(0, 10);
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!items.length) {
    return res.status(400).json({ error: "At least one payroll item is required" });
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const isValidDate = (value) => datePattern.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!isValidDate(payPeriodStart) || !isValidDate(payPeriodEnd) || payPeriodStart > payPeriodEnd) {
    return res.status(400).json({ error: "Valid pay period dates are required and start must not be after end" });
  }

  if (items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    return res.status(400).json({ error: "Each payroll item must be an object" });
  }
  const employeeIds = items.map((item) => Number(item.employeeId ?? item.employee_id));
  if (employeeIds.some((id) => !Number.isInteger(id) || id <= 0) || new Set(employeeIds).size !== employeeIds.length) {
    return res.status(400).json({ error: "Each payroll item must have a unique positive employeeId" });
  }
  const amountFields = [
    ["basicSalary", "basic_salary"],
    ["allowances", "allowanceAmount", "allowance_amount"],
    ["bonus", "bonusAmount", "bonus_amount"],
    ["otherEarnings", "other_earnings"],
    ["deductions", "deductionAmount", "deduction_amount"],
  ];
  if (items.some((item) => Number(item.overtime ?? item.overtimeAmount ?? item.overtime_amount ?? 0) !== 0)) {
    return res.status(400).json({ error: "Overtime must come from approved overtime requests, not payroll item input" });
  }
  if (items.some((item) => amountFields.some((aliases) => {
    const value = aliases.map((key) => item[key]).find((field) => field !== undefined && field !== null);
    return value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0);
  }))) {
    return res.status(400).json({ error: "Payroll earnings and deductions must be finite non-negative amounts" });
  }

  const client = await companyPool.connect();
  let payrollRun;
  let itemRows = [];
  let attendanceExceptions = [];
  let totals = { grossSalary: 0, deductions: 0, netSalary: 0 };
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [companyId, 1050505]);
    const alreadyProcessed = await client.query(`
      SELECT DISTINCT i.employee_id
      FROM hrms_payroll_items i
      JOIN hrms_payroll_runs p ON p.payroll_id = i.payroll_id AND p.company_id = i.company_id
      WHERE i.company_id = $1 AND i.employee_id = ANY($2::integer[])
        AND p.status IN ('draft', 'approved', 'paid')
        AND p.pay_period_start <= $4 AND p.pay_period_end >= $3
    `, [companyId, employeeIds, payPeriodStart, payPeriodEnd]);
    if (alreadyProcessed.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "One or more employees already have payroll in an overlapping period",
        employeeIds: alreadyProcessed.rows.map(({ employee_id }) => employee_id),
      });
    }

    const employees = await client.query(`
      SELECT employee_id FROM hrms_employees
      WHERE company_id = $1 AND is_deleted = FALSE AND status = 'active'
        AND employee_id = ANY($2::integer[])
    `, [companyId, employeeIds]);
    if (employees.rows.length !== employeeIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Payroll includes an employee who is not active in this company" });
    }

    const [ruleResult, overtimeResult, attendanceResult] = await Promise.all([
      client.query(`
        SELECT rule_code, rule_name, calculation_method, calculation_basis, rate, is_statutory
        FROM hrms_deduction_rules
        WHERE company_id = $1 AND is_active = TRUE
        ORDER BY rule_id
      `, [companyId]),
      client.query(`
        SELECT overtime_request_id, employee_id, hours, hourly_rate
        FROM hrms_overtime_requests
        WHERE company_id = $1 AND status = 'approved'
          AND work_date BETWEEN $2 AND $3 AND employee_id = ANY($4::integer[])
          AND payroll_id IS NULL
        ORDER BY overtime_request_id
        FOR UPDATE
      `, [companyId, payPeriodStart, payPeriodEnd, employeeIds]),
      client.query(`
        SELECT employee_id, attendance_date, status, check_in, check_out
        FROM hrms_attendance
        WHERE company_id = $1 AND employee_id = ANY($2::integer[])
          AND attendance_date BETWEEN $3 AND $4
          AND (status IN ('absent', 'late', 'half_day')
            OR (status NOT IN ('absent', 'holiday', 'on_leave') AND check_in IS NULL)
            OR (check_in IS NOT NULL AND check_out IS NULL))
        ORDER BY employee_id, attendance_date
      `, [companyId, employeeIds, payPeriodStart, payPeriodEnd]),
    ]);
    if (overtimeResult.rows.some(({ hourly_rate }) => hourly_rate === null)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Every approved overtime request in this pay period needs an hourly rate before payroll can be generated" });
    }
    attendanceExceptions = attendanceResult.rows;
    const overtimeByEmployee = new Map();
    const overtimeIdsByEmployee = new Map();
    for (const request of overtimeResult.rows) {
      const amount = calculateOvertimePay(request.hours, request.hourly_rate);
      overtimeByEmployee.set(
        request.employee_id,
        Math.round(((overtimeByEmployee.get(request.employee_id) || 0) + amount) * 100) / 100
      );
      const ids = overtimeIdsByEmployee.get(request.employee_id) || [];
      ids.push(request.overtime_request_id);
      overtimeIdsByEmployee.set(request.employee_id, ids);
    }

    const preparedItems = items.map((item, index) => {
      const employeeId = employeeIds[index];
      const earnings = {
        basicSalary: Number(item.basicSalary ?? item.basic_salary ?? 0),
        allowances: Number(item.allowances ?? item.allowanceAmount ?? item.allowance_amount ?? 0),
        overtime: overtimeByEmployee.get(employeeId) || 0,
        bonus: Number(item.bonus ?? item.bonusAmount ?? item.bonus_amount ?? 0),
        otherEarnings: Number(item.otherEarnings ?? item.other_earnings ?? 0),
        deductions: Number(item.deductions ?? item.deductionAmount ?? item.deduction_amount ?? 0),
      };
      const baseSalary = calculatePayrollBreakdown({ ...earnings, deductions: 0 });
      const deductionLines = ruleResult.rows.map((rule) => ({
        rule,
        amount: calculateConfiguredDeduction(rule, baseSalary),
      }));
      const statutoryDeductionAmount = deductionLines
        .filter(({ rule }) => rule.is_statutory)
        .reduce((total, line) => Math.round((total + line.amount) * 100) / 100, 0);
      const configuredDeductionAmount = deductionLines
        .reduce((total, line) => Math.round((total + line.amount) * 100) / 100, 0);
      const breakdown = calculatePayrollBreakdown({
        ...earnings,
        deductions: earnings.deductions + configuredDeductionAmount,
      });
      return { employeeId, breakdown, deductionLines, statutoryDeductionAmount };
    });

    if (preparedItems.some(({ breakdown }) => breakdown.deductions > breakdown.grossSalary)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Total deductions cannot exceed an employee's gross salary" });
    }

    totals = preparedItems.reduce((acc, item) => ({
      grossSalary: Math.round((acc.grossSalary + item.breakdown.grossSalary) * 100) / 100,
      deductions: Math.round((acc.deductions + item.breakdown.deductions) * 100) / 100,
      netSalary: Math.round((acc.netSalary + item.breakdown.netSalary) * 100) / 100,
    }), totals);

    const runResult = await client.query(`
      INSERT INTO hrms_payroll_runs
        (pay_period_start, pay_period_end, total_gross, total_deductions, total_net, status, generated_by, company_id)
      VALUES ($1,$2,$3,$4,$5,'draft',$6,$7)
      RETURNING *
    `, [payPeriodStart, payPeriodEnd, totals.grossSalary, totals.deductions, totals.netSalary, userId, companyId]);
    payrollRun = runResult.rows[0];

    const overtimeRequestIds = [...overtimeIdsByEmployee.values()].flat();
    if (overtimeRequestIds.length) {
      const claimedOvertime = await client.query(`
        UPDATE hrms_overtime_requests
        SET payroll_id = $1, updated_at = NOW()
        WHERE overtime_request_id = ANY($2::integer[]) AND company_id = $3
          AND status = 'approved' AND payroll_id IS NULL
        RETURNING overtime_request_id
      `, [payrollRun.payroll_id, overtimeRequestIds, companyId]);
      if (claimedOvertime.rows.length !== overtimeRequestIds.length) {
        throw Object.assign(new Error("Some approved overtime requests were already claimed by another payroll run"), { status: 409 });
      }
    }

    for (const item of preparedItems) {
      const { breakdown } = item;
      const result = await client.query(`
        INSERT INTO hrms_payroll_items (
          payroll_id, employee_id, basic_salary, allowance_amount, overtime_amount, bonus_amount,
          other_earnings, deduction_amount, statutory_deduction_amount, gross_salary, net_salary, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
      `, [
        payrollRun.payroll_id, item.employeeId, breakdown.basicSalary, breakdown.allowances,
        breakdown.overtime, breakdown.bonus, breakdown.otherEarnings, breakdown.deductions,
        item.statutoryDeductionAmount, breakdown.grossSalary, breakdown.netSalary, companyId,
      ]);
      itemRows.push(result.rows[0]);
      for (const deduction of item.deductionLines) {
        if (deduction.amount <= 0) continue;
        await client.query(`
          INSERT INTO hrms_payroll_item_deductions
            (payroll_item_id, rule_code, rule_name, is_statutory, amount, company_id)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [
          result.rows[0].payroll_item_id, deduction.rule.rule_code, deduction.rule.rule_name,
          deduction.rule.is_statutory, deduction.amount, companyId,
        ]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status === 409) {
      return res.status(409).json({ error: error.message });
    }
    throw error;
  } finally {
    client.release();
  }

  await logAudit(companyPool, {
    module_name: "HRMS",
    page_name: "Payroll Run",
    table_name: "hrms_payroll_runs",
    table_id: String(payrollRun.payroll_id),
    action_type: "CREATE",
    action_description: "Payroll run generated",
    new_value: JSON.stringify({ payrollRun, items: itemRows }),
    user_id: userId,
    role_id: roleId,
    ip_address: ipAddress,
    device_info: deviceInfo,
    company_id: companyId,
  });

  return res.status(201).json({
    message: "Payroll run created",
    payrollRun,
    items: itemRows,
    attendanceExceptions,
  });
}

export async function approvePayrollRun(req, res) {
  const { companyId, userId, roleId } = req.user;
  const { ipAddress, deviceInfo } = getRequestInfo(req);
  const { payrollId } = req.params;
  const companyPool = await getCompanyPool(companyId);

  const result = await companyPool.query(`
    UPDATE hrms_payroll_runs
    SET status = 'approved', approved_by = $1, approved_at = NOW(), locked_at = NOW(), updated_at = NOW()
    WHERE payroll_id = $2 AND company_id = $3 AND status = 'draft'
    RETURNING *
  `, [userId, payrollId, companyId]);

  if (result.rows.length === 0) {
    const existing = await companyPool.query(
      "SELECT status FROM hrms_payroll_runs WHERE payroll_id = $1 AND company_id = $2",
      [payrollId, companyId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: "Payroll run not found" });
    return res.status(409).json({ error: `Only draft payroll can be approved; this run is ${existing.rows[0].status}` });
  }

  await logAudit(companyPool, {
    module_name: "HRMS",
    page_name: "Payroll Approval",
    table_name: "hrms_payroll_runs",
    table_id: String(result.rows[0].payroll_id),
    action_type: "APPROVE",
    action_description: "Payroll run approved",
    new_value: JSON.stringify(result.rows[0]),
    user_id: userId,
    role_id: roleId,
    ip_address: ipAddress,
    device_info: deviceInfo,
    company_id: companyId,
  });

  return res.json({ message: "Payroll approved", payrollRun: result.rows[0] });
}
