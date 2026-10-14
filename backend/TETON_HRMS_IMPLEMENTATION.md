# Teton Projects HRMS — Implementation Notes

This document describes the HRMS baseline and the recommended next implementation steps for a project-oriented engineering company. It is a proposed workflow, not a statement of Teton Projects' confirmed internal HR policies.

## Existing HRMS APIs

All routes are mounted at `/api/hrms` and require authentication plus the corresponding permission.

| Area | Endpoints | Permission keys |
|---|---|---|
| Employees | `GET/POST /employees`, `GET/PUT/DELETE /employees/:employeeId` | `hrms_employee:view/create/update/delete` |
| Attendance | `GET/POST /attendance`, `GET /attendance/alerts` | `hrms_attendance:view/create` |
| Leave | `GET/POST /leave-requests`, `PUT /leave-requests/:leaveId` | `hrms_leave:view/create/update` |
| Payroll | `GET/POST /payroll`, `PUT /payroll/:payrollId/approve`, `GET /payroll/:payrollId/payslips/:employeeId` | `hrms_payroll:view/create/approve` |
| Shift roster | `GET/POST /rosters` | `hrms_roster:view/create` |
| Overtime | `GET/POST /overtime-requests`, `PUT /overtime-requests/:requestId/review` | `hrms_overtime:view/create/approve` |
| Leave balances | `GET /leave-balances`, `PUT /leave-balances/:employeeId` | `hrms_leave_balance:view/update` |
| Employee documents | `GET/POST /employees/:employeeId/documents`, `DELETE /documents/:documentId` | `hrms_document:view/create/delete` |
| Onboarding | `GET/POST /onboarding-tasks`, `PUT /onboarding-tasks/:taskId` | `hrms_onboarding:view/create/update` |
| Deduction rules | `GET/POST /deduction-rules`, `PUT /deduction-rules/:ruleId` | `hrms_payroll:view/create/update` |
| Analytics | `GET /analytics` | `hrms_analytics:view` |

## Recommended operational workflow

1. HR configures departments, designations, shifts, holidays, leave types, and salary components.
2. HR creates the employee record, verifies required documents, and assigns onboarding tasks.
3. HR assigns a manager, branch/work location, shift, and (when applicable) project/site.
4. Employees or authorized supervisors record attendance. Missing punches and attendance changes should be reviewed and auditable.
5. Employees submit leave requests. An authorized manager reviews the request; leave balances and attendance must be updated consistently.
6. Employees/supervisors submit overtime. A designated approver reviews it before payroll includes it.
7. HR closes the attendance period, generates draft payroll, checks exceptions, and sends it to an authorized approver.
8. Approved payroll values should be locked. Any later correction should be recorded as an adjustment/reversal with an audit trail.
9. Accounts records the payment and the system makes the payslip available to authorized users.
10. Approved timesheets/work allocation should eventually feed project-wise labour cost; do not allocate an employee's full salary to one project if they work across multiple projects.
11. When an employee exits, deactivate access and retain historical attendance/payroll records; do not hard-delete historical employee data.

## Security and tenant notes

- HRMS routes now enforce `requirePermission(...)` rather than only checking that the caller is authenticated.
- Each role/user needs the matching HRMS permissions in that company's `permissions`, `role_permissions`, and/or `user_permissions` tables. Existing migration `004_hrms_operations.sql` seeds the baseline permissions for the Super Admin role when run after the company profile exists.
- Before production rollout, verify HRMS permissions are also provisioned for newly created tenant databases. A table existing in `02_company_db_schema.sql` does not by itself guarantee that permission rows are present.
- Keep company scoping in every query and validate that referenced employee/payroll/leave IDs belong to the authenticated company.
- Restrict salary, bank, tax, and employee document data to authorized roles. Store uploaded document metadata and storage keys rather than public, guessable file paths.

## Suggested next features for a project-based company

1. Employee-to-project/site assignments with effective start/end dates.
2. Daily timesheets containing employee, project, site, work date, regular hours, overtime hours, activity, and approval state.
3. Attendance correction requests with reviewer, reason, old/new values, and audit record.
4. Payroll payment records and PDF payslip generation.
5. Employee exit checklist, asset return, access revocation, and final settlement.
6. Training/certification register with expiry reminders.
7. Recruitment pipeline and appraisal only after the core attendance/payroll flow is stable.

## Rollout checklist

- Back up each tenant database before applying migrations.
- For existing databases, apply `003_hrms_module.sql` and then `004_hrms_operations.sql` as appropriate; inspect each migration before rerunning it.
- Confirm permission rows and role assignments for every tenant, including new tenant creation.
- Run `npm test` in `backend` and manually test allowed/denied requests in Thunder Client.
- Test company isolation, duplicate employee codes, leave approval/cancellation, overtime approval, payroll approval, and post-approval edit attempts.
