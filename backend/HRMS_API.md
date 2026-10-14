# HRMS API

HRMS routes are mounted at `/api/hrms`. Requests require the existing bearer-token authentication and the listed permission. All records are scoped to the authenticated company.

## Existing workforce workflows

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET, POST | `/employees` | `hrms_employee:view`, `hrms_employee:create` | Search/list and create employee profiles |
| GET, PUT, DELETE | `/employees/:employeeId` | `hrms_employee:view`, `hrms_employee:update`, `hrms_employee:delete` | Read, update, or archive an employee |
| GET, POST | `/attendance` | `hrms_attendance:view`, `hrms_attendance:create` | List and upsert daily attendance |
| GET | `/attendance/alerts?date=YYYY-MM-DD&graceMinutes=10` | `hrms_attendance:view` | Report missing punches and late check-ins |
| GET, POST | `/leave-requests` | `hrms_leave:view`, `hrms_leave:create` | List and submit leave requests |
| PUT | `/leave-requests/:leaveId` | `hrms_leave:update` | Change a leave request's status |
| GET | `/payroll` | `hrms_payroll:view` | List payroll runs |
| POST | `/payroll` | `hrms_payroll:create` | Generate a draft payroll run |
| PUT | `/payroll/:payrollId/approve` | `hrms_payroll:approve` | Approve a draft run |
| GET | `/payroll/:payrollId/payslips/:employeeId` | `hrms_payroll:view` | Read an approved employee payslip as JSON |

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

Document registration stores a `storageKey` supplied by the caller; it does not upload or serve file contents. Connect this metadata to the deployment's approved private file-storage service before exposing document download links.

## Configurable payroll deductions

Create or edit company deduction rules using `POST /deduction-rules` or `PUT /deduction-rules/:ruleId`. A rule accepts `code`, `name`, `calculationMethod` (`fixed` or `percentage`), `calculationBasis` (`basic_salary` or `gross_salary`), `rate`, `isStatutory`, and `isActive`. Percentage rates are limited to 0–100.

Payroll generation snapshots active rules into the payroll-item deduction rows. Approved overtime requests with an hourly rate are added to the payroll item for work dates inside the pay period. Other approved overtime requests without a rate remain visible for payroll review and must be included in the submitted overtime amount where applicable.

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

Statutory rules are intentionally configurable; no jurisdiction-specific tax, social-security, or labor-law rates are built into this module. Verify the applicable rates and calculation bases with the organization's payroll/legal advisers before production use. Payslips are returned as structured JSON and are not rendered as PDF.

## Database rollout

- New company databases receive all HRMS tables from `sql/02_company_db_schema.sql`.
- Existing company databases must have `sql/migrations/003_hrms_module.sql` and then `sql/migrations/004_hrms_operations.sql` applied once each.
