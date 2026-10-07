# CRM-ERP Project Flow

## What this project is

A Node.js/Express API for a multi-tenant CRM and MEP project ERP. The repository currently contains the backend only; tenant and platform data are stored in PostgreSQL.

## Main workflow

1. **Platform setup:** Create the admin database using `backend/sql/01_admin_master_db.sql`. Configure the backend environment, then bootstrap the first platform admin at `POST /api/admin/register`. Unauthenticated registration is allowed only while no admin exists; later registrations require an admin bearer token.
2. **Company provisioning:** A platform admin signs in at `POST /api/admin/login`, then provisions a tenant through `POST /api/admin/companies`. The service creates the company's database, applies `backend/sql/02_company_db_schema.sql`, seeds the Super Admin role, permissions and financial year, creates the tenant owner, and activates the company.
3. **Tenant login:** A company user signs in at `POST /api/auth/login`. The shared `global_users` table maps the email to a company; the password is checked against that company's `users` table. The API returns a bearer JWT. Protected routes enforce tenant permissions.
4. **CRM to order:** Create a lead, track activities and follow-ups, then convert a qualified lead into a customer. Create an enquiry/RFQ for that customer, attach tender documents and activities, prepare and link a quotation, then create a sales order when the quotation is accepted.
5. **Project delivery:** Create a project manually or from a sales order. Maintain project sites, BOQ, budget categories, milestones, tasks, documents and daily progress reports (DPRs). Record manpower and equipment usage; these postings recalculate project/category actual costs.
6. **Procurement and stock:** Raise project requisitions, process purchase orders and goods receipts (GRNs), then issue material to the site. Inventory receipts/issues and transfers/adjustments update stock records.
7. **Billing and closeout:** Use proforma invoices, delivery challans and sales invoices for customer billing; purchase invoices and debit/credit notes support supplier/customer adjustments. Progress projects through their controlled status transitions to completion and closure.

## API areas

- `/api/admin`: platform admins, subscription plans and company provisioning
- `/api/auth`: tenant login, profile, users, roles and permissions
- `/api/master`, `/api/party`, `/api/items`: company setup, customers/vendors and item masters
<!-- - `/api/crm`, `/api/lead`, `/api/enquiry`: CRM masters, leads, activities, follow-ups and RFQs -->
- `/api/quotation`, `/api/sales_order`, `/api/project`: sales conversion and project delivery controls
- `/api/procurement`, `/api/purchase_order`, `/api/purchase_invoice`: purchasing and receiving
- `/api/inventory`, `/api/manpower`, `/api/equipment`: stores, site labour and equipment costing
- `/api/proforma`, `/api/delivery_challan`, `/api/invoice`, `/api/credit_note`, `/api/debit_note`: billing and adjustments
- `/health`: process health check

Routes require a company JWT and their matching permission unless the endpoint is a public login/bootstrap endpoint. Permissions are seeded for new companies; give sub-user roles only the permissions their jobs require.

## Database changes

New tenants receive the current full schema automatically. For existing tenant databases, apply migrations in order against each company database:

```text
backend/sql/migrations/001_crm_pipeline.sql
backend/sql/migrations/002_manpower_equipment.sql
```

The CRM migration adds leads, enquiries, activities and enquiry documents. The manpower/equipment migration adds registers and project usage logs. Back up each tenant database before applying migrations.

## Configuration and run

Install dependencies from `backend/`, set environment variables, then run `npm start` (or `npm run dev`). The API listens on `PORT` (default `4500`). Required connection settings are `ADMIN_DB_HOST`, `ADMIN_DB_NAME`, `ADMIN_DB_USER`, `ADMIN_DB_PASSWORD`, `PG_MAINTENANCE_HOST`, `PG_MAINTENANCE_USER` and `PG_MAINTENANCE_PASSWORD`; `ADMIN_DB_PORT` and `PG_MAINTENANCE_PORT` default to `5432`.

Set `SESSION_SECRET` and `JWT_ACCESS_SECRET` (or `JWT_SECRET`) to different random strings of at least 32 characters. Set `APP_ENCRYPTION_KEY` to a unique 64-character hexadecimal key. Production startup rejects missing production secrets or database credentials. Never use the development defaults in production. The maintenance PostgreSQL role needs permission to create tenant databases.

Run automated checks from `backend/` with `npm test`. The suite uses Node's built-in test runner; live database behavior still needs verification against a configured PostgreSQL instance.
