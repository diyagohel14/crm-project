# HRMS API

HRMS routes are mounted at `/api/hrms`. Requests require the existing bearer-token authentication and the listed permission. All records are scoped to the authenticated company.

## Existing workforce workflows

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET, POST | `/employees` | `hrms_employee:view`, `hrms_employee:create` | Search/list and create employee profiles |
| GET, PUT, DELETE | `/employees/:employeeId` | `hrms_employee:view`, `hrms_employee:update`, `hrms_employee:delete` | Read, update, or archive an employee |
| GET, POST | `/attendance` | `hrms_attendance:view`, `hrms_attendance:create` | List attendance or add a daily record; duplicate employee/date records return 409 and require a correction request |
| POST | `/attendance/:attendanceId/corrections` | `hrms_attendance:correction:create` | Request a correction with a reason |
| GET | `/attendance-corrections?status=pending&employeeId=123` | `hrms_attendance:view` | Review queue/history, including original and proposed values |
| PUT | `/attendance-corrections/:correctionId/review` | `hrms_attendance:correction:approve` | Approve or reject a correction; requesters cannot review their own |
| GET | `/attendance/alerts?date=YYYY-MM-DD&graceMinutes=10` | `hrms_attendance:view` | Report missing punches and late check-ins |
| GET, POST | `/leave-requests` | `hrms_leave:view`, `hrms_leave:create` | List and submit leave requests |
| PUT | `/leave-requests/:leaveId` | `hrms_leave:update` | Change a leave request's status |
| GET | `/payroll` | `hrms_payroll:view` | List payroll runs |
| POST | `/payroll` | `hrms_payroll:create` | Generate a draft payroll run |
| PUT | `/payroll/:payrollId/approve` | `hrms_payroll:approve` | Approve a draft run |
| GET | `/payroll/:payrollId/payslips/:employeeId` | `hrms_payroll:view` | Read an approved employee payslip as JSON |
| GET | `/payroll/:payrollId/payslips/:employeeId.pdf` | `hrms_payroll:view` | Download a private, no-store PDF for an approved or paid run |
| GET | `/payroll/:payrollId/payments` | `hrms_payroll:view` | List payment ledger entries |
| POST | `/payroll/:payrollId/payments` | `hrms_payroll:payment:create` | Record a payment against an employee's approved net pay |
| POST | `/payroll/:payrollId/payments/:paymentId/reverse` | `hrms_payroll:payment:reverse` | Reverse a payment with a reason |

Employee bank name/account, IFSC and tax ID are returned only with `hrms_employee:private:view`. Creating or updating those fields requires `hrms_employee:private:update`. Deactivated tenant users cannot continue using existing JWTs.

## Workforce operations

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET, POST | `/rosters` | `hrms_roster:view`, `hrms_roster:create` | List or assign an employee's shift for a date |
| GET, POST | `/overtime-requests` | `hrms_overtime:view`, `hrms_overtime:create` | List or submit overtime requests |
| PUT | `/overtime-requests/:requestId/review` | `hrms_overtime:approve` | Approve or reject a pending overtime request |
| GET | `/leave-balances?employeeId=123&year=2026` | `hrms_leave_balance:view` | List balances and available days |
| PUT | `/leave-balances/:employeeId` | `hrms_leave_balance:update` | Set opening, accrued, and adjusted days |
| GET, POST | `/employees/:employeeId/documents` | `hrms_document:view`, `hrms_document:create` | List or register employee document metadata |
| DELETE | `/documents/:documentId` | `hrms_document:delete` | Archive document metadata |
| GET, POST | `/onboarding-tasks` | `hrms_onboarding:view`, `hrms_onboarding:create` | List or create onboarding tasks |
| PUT | `/onboarding-tasks/:taskId` | `hrms_onboarding:update` | Update onboarding task status |
| GET | `/analytics?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD` | `hrms_analytics:view` | Workforce, department, branch, attendance, leave, payroll, and onboarding summaries |
| GET, POST | `/project-assignments` | `hrms_project_assignment:view`, `hrms_project_assignment:create` | List or assign active employees to active project sites with effective dates and labour rates |
| PUT | `/project-assignments/:assignmentId/close` | `hrms_project_assignment:update` | Close an assignment without invalidating pending or approved timesheets |
| GET, POST | `/project-timesheets` | `hrms_project_timesheet:view`, `hrms_project_timesheet:create` | List or submit assignment-bound daily hours (maximum 24 hours per employee/date) |
| PUT | `/project-timesheets/:timesheetId/review` | `hrms_project_timesheet:approve` | Approve or reject a submitted timesheet; approved timesheets update project labour actuals |
| GET, POST | `/employee-exits` | `hrms_employee_exit:view`, `hrms_employee_exit:create` | List or request employee exit |
| PUT | `/employee-exits/:exitId/review` | `hrms_employee_exit:approve` | Approve/reject an exit; approval terminates the employee and deactivates their linked user |
| GET, POST | `/training` | `hrms_training:view`, `hrms_training:create` | List or create training courses |
| PUT | `/training/:trainingId` | `hrms_training:update` | Update a course status |
| GET | `/training/:trainingId/participants` | `hrms_training:view` | List course participants |
| PUT | `/training/:trainingId/participants` | `hrms_training:update` | Enrol/update a participant and completion outcome |
| GET, POST | `/appraisals` | `hrms_appraisal:view`, `hrms_appraisal:create` | List or create appraisal cycles |
| PUT | `/appraisals/:appraisalId/submit` | `hrms_appraisal:update` | Assigned reviewer submits rating and feedback |
| PUT | `/appraisals/:appraisalId/review` | `hrms_appraisal:approve` | Approve or reject a submitted appraisal; reviewer cannot approve their own |

Document registration stores a `storageKey` supplied by the caller; it does not upload or serve file contents. Connect this metadata to the deployment's approved private file-storage service before exposing document download links.

## Configurable payroll deductions

Create or edit company deduction rules using `POST /deduction-rules` or `PUT /deduction-rules/:ruleId`. A rule accepts `code`, `name`, `calculationMethod` (`fixed` or `percentage`), `calculationBasis` (`basic_salary` or `gross_salary`), `rate`, `isStatutory`, and `isActive`. Percentage rates are limited to 0–100.

Payroll generation snapshots active rules into the payroll-item deduction rows. Submitted salary amounts remain authoritative: recorded attendance is returned as an exception report and does not prorate salary. Only approved overtime requests within the pay period are included; each must have an hourly rate and is claimed by one payroll run. A nonzero client-supplied overtime amount is rejected to prevent double counting. Approved payroll runs are locked against item edits. Payment entries cannot exceed net pay; a run is marked paid when all employee net pay is recorded, and reversals reopen it as approved when necessary.

Example deduction rule:

```json
{
  "code": "RETIREMENT",
  "name": "Retirement contribution",
  "calculationMethod": "percentage",
  "calculationBasis": "basic_salary",
  "rate": 8,
  "isStatutory": true,
  "isActive": true
}
```

Example payroll item (the `items` array is submitted to `POST /payroll`):

```json
{
  "employeeId": 42,
  "basicSalary": 50000,
  "allowances": 5000,
  "overtime": 0,
  "bonus": 0,
  "otherEarnings": 0,
  "deductions": 250
}
```

Statutory rules are intentionally configurable; no jurisdiction-specific tax, social-security, or labor-law rates are built into this module. Verify the applicable rates and calculation bases with the organization's payroll/legal advisers before production use. JSON and PDF payslips are available only for approved or paid payroll runs.

Attendance exceptions currently report recorded absences, late/half-day statuses and missing punches. The system cannot infer entirely missing workdays until company work calendars, holidays and expected shifts are configured. Attendance approval remains separate from payroll; approved overtime is the only attendance-adjacent amount calculated automatically.

Project timesheet costs are added to project labour actuals alongside existing manpower-log costs; timesheet costs represent named employee hours, while manpower logs remain suitable for aggregated/subcontract labour. Timesheets are not automatically added to employee payroll.

Approved exits retain employee and payroll history while deactivating the employee and linked user account. Exit is allowed only on or after the last working date. Training records currently track courses/participants and completion outcomes; certification expiry reminders and appraisal notifications are not implemented.

## Database rollout

- New company databases receive all HRMS tables from `sql/02_company_db_schema.sql`.
- Provisioning applies `sql/migrations/005_hrms_workflows.sql` and `006_hrms_project_assignment_update_permission.sql` after base schema creation.
- Existing company databases must have `003_hrms_module.sql`, `004_hrms_operations.sql`, `005_hrms_workflows.sql`, and `006_hrms_project_assignment_update_permission.sql` applied in order. Back up each database and inspect migration outcomes before rollout.
- If payroll creation reports `column "payroll_id" does not exist` on `hrms_overtime_requests`, apply `005_hrms_workflows.sql` to the same tenant database selected for the authenticated company, then retry the request. The migration adds this nullable link so each approved overtime request can be claimed by at most one payroll run.
