# Teton Projects HRMS — Implementation Notes

This document describes the HRMS baseline and the recommended next implementation steps for a project-oriented engineering company. It is a proposed workflow, not a statement of Teton Projects' confirmed internal HR policies.

## Existing HRMS APIs

All routes are mounted at `/api/hrms` and require authentication plus the corresponding permission.

| Area | Endpoints | Permission keys |
|---|---|---|
| Employees | `GET/POST /employees`, `GET/PUT/DELETE /employees/:employeeId` | `hrms_employee:view/create/update/delete`; private fields additionally require `hrms_employee:private:view/update` |
| Attendance | `GET/POST /attendance`, `GET /attendance/alerts`, attendance correction request/review endpoints | `hrms_attendance:*` and `hrms_attendance:correction:*` |
| Leave | `GET/POST /leave-requests`, `PUT /leave-requests/:leaveId` | `hrms_leave:view/create/update/approve` |
| Payroll | Payroll runs, payment ledger, JSON and PDF payslips | `hrms_payroll:*`, `hrms_payroll:payment:*` |
| Shift roster | `GET/POST /rosters` | `hrms_roster:view/create` |
| Overtime | `GET/POST /overtime-requests`, `PUT /overtime-requests/:requestId/review` | `hrms_overtime:view/create/approve` |
| Leave balances | `GET /leave-balances`, `PUT /leave-balances/:employeeId` | `hrms_leave_balance:view/update` |
| Employee documents | `GET/POST /employees/:employeeId/documents`, `DELETE /documents/:documentId` | `hrms_document:view/create/delete` |
| Onboarding | `GET/POST /onboarding-tasks`, `PUT /onboarding-tasks/:taskId` | `hrms_onboarding:view/create/update` |
| Deduction rules | `GET/POST /deduction-rules`, `PUT /deduction-rules/:ruleId` | `hrms_payroll:view/create/update` |
| Analytics | `GET /analytics` | `hrms_analytics:view` |
| Project labour | `/project-assignments` and `/project-timesheets` | `hrms_project_assignment:*`, `hrms_project_timesheet:*` |
| Employee exits | `/employee-exits` | `hrms_employee_exit:*` |
| Training | `/training` and `/training/:trainingId/participants` | `hrms_training:*` |
| Appraisals | `/appraisals` | `hrms_appraisal:*` |

## Recommended operational workflow

1. HR configures departments, designations, shifts, holidays, leave types, and salary components.
2. HR creates the employee record, verifies required documents, and assigns onboarding tasks.
3. HR assigns a manager, branch/work location, shift, and (when applicable) project/site.
4. Authorized users record attendance; corrections are submitted with a reason and reviewed by another user. Missing punches are reported. Missing full workdays are not inferred without an expected-work calendar.
5. Employees submit leave requests. An authorized manager reviews the request; leave balances and attendance must be updated consistently.
6. Employees/supervisors submit overtime. A designated approver reviews it before payroll includes it.
7. HR generates draft payroll from explicitly submitted salary components. Attendance is surfaced as an exception report and does not change the submitted salary. Only approved, rate-bearing overtime requests are included, and each overtime request is claimed once.
8. Payroll approval locks payroll items. Corrections after approval require a separate adjustment process; direct payroll-item edits are rejected.
9. Accounts records and, when needed, reverses payments against employee net pay. Approved/paid payslips are available as JSON and PDF.
10. Approved project/site timesheets update project labour actuals alongside existing manpower-log costs. They are not automatically added to payroll and should not duplicate aggregate subcontract/manpower costs.
11. An approved exit on or after the last working date terminates the employee and deactivates the linked user while retaining attendance/payroll history.
12. HR can maintain training courses/participants and appraisal cycles with reviewer submission and independent approval.

## Security and tenant notes

- HRMS routes now enforce `requirePermission(...)` rather than only checking that the caller is authenticated.
- Each role/user needs the matching HRMS permissions in that company's `permissions`, `role_permissions`, and/or `user_permissions` tables. Migrations `004_hrms_operations.sql` through `006_hrms_project_assignment_update_permission.sql` seed required permissions for the Super Admin role after the company profile exists.
- New tenant provisioning runs workflow migrations `005` and `006` after base schema and company profile creation. Existing tenants must run them explicitly.
- Keep company scoping in every query and validate that referenced employee/payroll/leave IDs belong to the authenticated company.
- Restrict salary, bank, tax, and employee document data to authorized roles. Tenant-user status is checked during authenticated requests so exit deactivation also rejects already-issued JWTs.
- Employee document APIs store metadata and storage keys only; private storage/download integration remains deployment-specific.

## Remaining production policy and workflow work

1. Define calendars, holidays, expected workdays, and jurisdiction/company-specific attendance policies before reporting missing attendance days.
2. Add an approved payroll adjustment/final-settlement workflow, bank-file integration, and reconciliation policy; statutory calculations remain configurable and require payroll/legal configuration.
3. Add exit checklist items for assets, documents, access outside the ERP, and final settlement. The current exit flow only deactivates the linked ERP user and preserves records.
4. Add training certification identifiers, expiry dates, and reminder delivery.
5. Add recruitment and notification workflows if required by the company's HR policy.
6. Validate tenant-specific role assignments; migrations provision permissions but do not grant every permission to all existing roles.

## Rollout checklist

- Back up each tenant database before applying migrations.
- For existing databases, apply `003_hrms_module.sql`, `004_hrms_operations.sql`, `005_hrms_workflows.sql`, then `006_hrms_project_assignment_update_permission.sql` as appropriate; inspect each migration before rollout.
- Confirm permission rows and role assignments for every tenant, including new tenant creation.
- Run `npm test` in `backend` and manually test allowed/denied requests in Thunder Client.
- Test company isolation, employee private-field permissions, attendance correction and leave approval, overtime claimed once, payroll locking/payment reversal, timesheet approval/costing, PDF authorization, exit token invalidation, and post-approval edits.
