-- MIGRATION 004: HRMS OPERATIONS
-- Apply once to each existing company database after 003_hrms_module.sql.
-- New company databases receive these objects from 02_company_db_schema.sql.
-- Safe to re-run.

BEGIN;

ALTER TABLE hrms_payroll_items
    ADD COLUMN IF NOT EXISTS statutory_deduction_amount NUMERIC(18,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS hrms_shift_rosters (
    shift_roster_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    shift_id INTEGER NOT NULL REFERENCES shift_master(shift_id),
    roster_date DATE NOT NULL,
    assigned_by INTEGER REFERENCES users(user_id),
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, roster_date, company_id)
);

CREATE TABLE IF NOT EXISTS hrms_overtime_requests (
    overtime_request_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    work_date DATE NOT NULL,
    hours NUMERIC(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
    hourly_rate NUMERIC(18,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    requested_by INTEGER REFERENCES users(user_id),
    approved_by INTEGER REFERENCES users(user_id),
    approved_at TIMESTAMP,
    remarks TEXT,
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hrms_leave_balances (
    leave_balance_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    leave_type VARCHAR(30) NOT NULL,
    leave_year INTEGER NOT NULL CHECK (leave_year BETWEEN 1900 AND 2200),
    opening_days NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (opening_days >= 0),
    accrued_days NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (accrued_days >= 0),
    used_days NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
    adjusted_days NUMERIC(8,2) NOT NULL DEFAULT 0,
    updated_by INTEGER REFERENCES users(user_id),
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, leave_type, leave_year, company_id)
);

CREATE TABLE IF NOT EXISTS hrms_employee_documents (
    document_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    document_type VARCHAR(80) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    storage_key VARCHAR(1024) NOT NULL,
    issued_on DATE,
    expires_on DATE,
    uploaded_by INTEGER REFERENCES users(user_id),
    company_id INTEGER NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hrms_onboarding_tasks (
    task_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    title VARCHAR(150) NOT NULL,
    description TEXT,
    due_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
    assigned_to INTEGER REFERENCES users(user_id),
    created_by INTEGER REFERENCES users(user_id),
    completed_at TIMESTAMP,
    company_id INTEGER NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hrms_deduction_rules (
    rule_id SERIAL PRIMARY KEY,
    rule_code VARCHAR(40) NOT NULL,
    rule_name VARCHAR(100) NOT NULL,
    calculation_method VARCHAR(20) NOT NULL
        CHECK (calculation_method IN ('fixed', 'percentage')),
    calculation_basis VARCHAR(20) NOT NULL
        CHECK (calculation_basis IN ('basic_salary', 'gross_salary')),
    rate NUMERIC(18,4) NOT NULL CHECK (rate >= 0),
    is_statutory BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    company_id INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(user_id),
    updated_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rule_code, company_id),
    CHECK (calculation_method <> 'percentage' OR rate <= 100)
);

CREATE TABLE IF NOT EXISTS hrms_payroll_item_deductions (
    payroll_item_deduction_id SERIAL PRIMARY KEY,
    payroll_item_id INTEGER NOT NULL REFERENCES hrms_payroll_items(payroll_item_id),
    rule_code VARCHAR(40) NOT NULL,
    rule_name VARCHAR(100) NOT NULL,
    is_statutory BOOLEAN NOT NULL DEFAULT FALSE,
    amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (payroll_item_id, rule_code, company_id)
);

CREATE INDEX IF NOT EXISTS idx_hrms_rosters_company_date
    ON hrms_shift_rosters(company_id, roster_date);
CREATE INDEX IF NOT EXISTS idx_hrms_overtime_company_status_date
    ON hrms_overtime_requests(company_id, status, work_date);
CREATE INDEX IF NOT EXISTS idx_hrms_leave_balances_employee_year
    ON hrms_leave_balances(company_id, employee_id, leave_year);
CREATE INDEX IF NOT EXISTS idx_hrms_documents_employee
    ON hrms_employee_documents(company_id, employee_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_hrms_onboarding_employee_status
    ON hrms_onboarding_tasks(company_id, employee_id, status) WHERE is_deleted = FALSE;

DO $$
DECLARE
    cid INTEGER;
    role_record RECORD;
    permission_record RECORD;
    pid INTEGER;
BEGIN
    SELECT company_id INTO cid
    FROM tbl_company_profile
    ORDER BY company_profile_id
    LIMIT 1;
    IF cid IS NULL THEN
        RAISE EXCEPTION 'tbl_company_profile is empty - cannot determine company_id';
    END IF;

    FOR permission_record IN SELECT * FROM (VALUES
        ('hrms_employee:view', 'HRMS'),
        ('hrms_employee:create', 'HRMS'),
        ('hrms_employee:update', 'HRMS'),
        ('hrms_employee:delete', 'HRMS'),
        ('hrms_attendance:view', 'HRMS'),
        ('hrms_attendance:create', 'HRMS'),
        ('hrms_leave:view', 'HRMS'),
        ('hrms_leave:create', 'HRMS'),
        ('hrms_leave:update', 'HRMS'),
        ('hrms_payroll:view', 'HRMS'),
        ('hrms_payroll:create', 'HRMS'),
        ('hrms_payroll:approve', 'HRMS'),
        ('hrms_payroll:update', 'HRMS'),
        ('hrms_roster:view', 'HRMS'),
        ('hrms_roster:create', 'HRMS'),
        ('hrms_overtime:view', 'HRMS'),
        ('hrms_overtime:create', 'HRMS'),
        ('hrms_overtime:approve', 'HRMS'),
        ('hrms_leave_balance:view', 'HRMS'),
        ('hrms_leave_balance:update', 'HRMS'),
        ('hrms_document:view', 'HRMS'),
        ('hrms_document:create', 'HRMS'),
        ('hrms_document:delete', 'HRMS'),
        ('hrms_onboarding:view', 'HRMS'),
        ('hrms_onboarding:create', 'HRMS'),
        ('hrms_onboarding:update', 'HRMS'),
        ('hrms_analytics:view', 'HRMS')
    ) AS p(permission_name, module_name)
    LOOP
        SELECT permission_id INTO pid
        FROM permissions
        WHERE permission_name = permission_record.permission_name AND company_id = cid;
        IF pid IS NULL THEN
            INSERT INTO permissions (permission_name, module_name, status, company_id)
            VALUES (permission_record.permission_name, permission_record.module_name, TRUE, cid)
            RETURNING permission_id INTO pid;
        END IF;
        FOR role_record IN
            SELECT role_id FROM roles
            WHERE role_name = 'Super Admin' AND company_id = cid AND is_deleted = FALSE
        LOOP
            INSERT INTO role_permissions (role_id, permission_id, is_allowed, company_id)
            SELECT role_record.role_id, pid, TRUE, cid
            WHERE NOT EXISTS (
                SELECT 1 FROM role_permissions
                WHERE role_id = role_record.role_id AND permission_id = pid AND company_id = cid
            );
        END LOOP;
    END LOOP;
END $$;

COMMIT;
