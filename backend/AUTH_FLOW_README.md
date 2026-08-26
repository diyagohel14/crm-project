# CRM Project Setup Notes

This backend now provides a stronger multi-tenant CRM foundation with admin/company provisioning, tenant authentication, user/role management, and audit logging.

## 1. Company registration (Admin side)

`POST /api/admin/companies`

```json
{
  "companyName": "abc Pvt Ltd",
  "companyCode": "ABC01",
  "companyEmail": "info@abc.com",
  "subscriptionPlanId": 1,
  "superAdminFirstName": "Rahul",
  "superAdminLastName": "Shah",
  "superAdminEmail": "rahul@abc.com",
  "superAdminPassword": "abc@123",
  "db_name": "abc"
}
```

<!-- {
  "companyName": "Acme Pvt Ltd",
  "companyCode": "ACME01",
  "companyEmail": "info@acme.com",
  "subscriptionPlanId": 1,
  "superAdminFirstName": "Rahul",
  "superAdminLastName": "Shah",
  "superAdminEmail": "rahul@acme.com",
  "superAdminPassword": "StrongPass123!"
} -->

What happens, in order (`services/companyProvisioningService.js`):

1. A row is inserted into the Admin DB's `companies` table with `status = 'inactive'`
   (so a half-provisioned company never looks usable).
2. A brand new physical database is created:
   `CREATE DATABASE crm_company_abc` (derived from `companyCode`).
3. The full `02_company_db_schema.sql` is executed against that new database.
4. A `"Super Admin"` role is inserted into that company's `roles` table.
5. The super admin's `users` row is created in the **company DB**, with a
   bcrypt-hashed password.
6. A routing row is inserted into the Admin DB's `global_users` table
   (`email -> company_id`, **no password stored here**).
7. `companies.status` is flipped to `'active'`.

If any step fails, everything already done (company row, `global_users` row,
physical database) is dropped/rolled back — see the `rollback()` function.

## 2. Login (any user, any company)

`POST /api/auth/login`

```json
{ "email": "rahul@abc.com", "password": "abc@123" }
```

`services/authService.js`:

1. Look up `email` in the Admin DB's `global_users` → get `company_id`.
2. Look up that `company_id` in `companies` → get `db_name`/`db_host`/etc.
   (decrypted via `utils/crypto.js`), and get/create a cached `pg.Pool`
   for that company (`config/companyPoolManager.js`).
3. Query that company's own `users` table by email, and `bcrypt.compare()`
   the password against the hash stored there.
4. On success: update `last_login`, write an `audit_logs` row, and store
   in the session:
   ```js
   req.session.user = { userId, companyId, roleId, email, fullName }
   ```
   Deliberately **no DB credentials** go into the session — only IDs.
   Every later request re-derives the company's `pg.Pool` from the cache
   (or rebuilds it from the Admin DB if the process restarted).

## 3. Every subsequent authenticated request

`middleware/authMiddleware.js`:

- `requireAuth` — 401s if there's no `req.session.user`.
- `attachCompanyPool` — looks up `req.session.user.companyId` and attaches
  `req.companyPool`, so route handlers can just do
  `req.companyPool.query(...)` without re-deriving anything.
- `requireRole([...])` — simple role gate for admin-only routes.

## 4. Sub-users

`POST /api/auth/users` (requires login — typically restricted to the
Super Admin role via `requireRole`) creates another user under the
**same company**:

- Inserts into that company's `users` table (hashed password, assigned
  `role_id`/`department_id`).
- Inserts the matching routing row into the Admin DB's `global_users`
  so that new user can log in at all.

This is the same "one email → one company" pattern as the super admin,
just without re-running the schema or creating a new database.

## Setup

```bash
npm install
cp .env.example .env    # fill in real values
```

1. Create the admin database and run `sql/01_admin_master_db.sql` against it
   (via pgAdmin4, as your README already describes).
2. Make sure the Postgres user in `.env` (`PG_MAINTENANCE_USER`) has
   `CREATEDB` privilege — it's the one that runs `CREATE DATABASE` for
   every new company. In pgAdmin4: right-click the role → Properties →
   Privileges → "Can create databases".
3. `npm run dev`
4. `POST /api/admin/companies` to create your first company.
5. `POST /api/auth/login` with the super admin email/password you just set.

## Notes / things to decide as you go

- **Rate limiting login** and **account lockout** after N failed attempts
  aren't implemented here — worth adding given `users.status` already has
  a `'locked'` value ready for it.
- **Email verification / OTP** — your schema already has
  `otp_verification` and `password_reset_tokens` tables ready; this code
  doesn't wire them up yet since you didn't ask for that flow specifically.
- **Session store** — swap `MemoryStore` for `connect-pg-simple` before
  going to production (see the comment in `index.js`).
- **Multiple app server instances**: because `companyPoolManager.js`
  caches pools in an in-process `Map`, if you run more than one Node
  process you'll get one pool-per-process per company, which is fine —
  just be aware it's not a shared cache across instances.
