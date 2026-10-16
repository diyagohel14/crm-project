-- MIGRATION 005: HRMS approvals, payroll controls, project labour and lifecycle workflows.
-- Apply after 003 and 004 to each existing tenant database. Safe to re-run.

BEGIN;

ALTER TABLE hrms_payroll_runs
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;

ALTER TABLE hrms_overtime_requests
    ADD COLUMN IF NOT EXISTS payroll_id INTEGER REFERENCES hrms_payroll_runs(payroll_id);

CREATE TABLE IF NOT EXISTS hrms_attendance_corrections (
    correction_id SERIAL PRIMARY KEY,
    attendance_id INTEGER NOT NULL REFERENCES hrms_attendance(attendance_id),
    original_check_in TIME,
    original_check_out TIME,
    original_status VARCHAR(20),
    original_notes TEXT,
    proposed_check_in TIME,
    proposed_check_out TIME,
    proposed_status VARCHAR(20) NOT NULL
        CHECK (proposed_status IN ('present', 'absent', 'late', 'half_day', 'holiday', 'on_leave')),
    proposed_notes TEXT,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by INTEGER NOT NULL REFERENCES users(user_id),
    reviewed_by INTEGER REFERENCES users(user_id),
    reviewed_at TIMESTAMP,
    review_remarks TEXT,
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE hrms_attendance_corrections
    ADD COLUMN IF NOT EXISTS original_check_in TIME,
    ADD COLUMN IF NOT EXISTS original_check_out TIME,
    ADD COLUMN IF NOT EXISTS original_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS original_notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hrms_attendance_one_pending_correction
    ON hrms_attendance_corrections(attendance_id, company_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_hrms_attendance_corrections_company_status
    ON hrms_attendance_corrections(company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS hrms_payroll_payments (
    payment_id SERIAL PRIMARY KEY,
    payroll_id INTEGER NOT NULL REFERENCES hrms_payroll_runs(payroll_id),
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    paid_on DATE NOT NULL,
    payment_method VARCHAR(40) NOT NULL,
    payment_reference VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'recorded'
        CHECK (status IN ('recorded', 'reversed')),
    recorded_by INTEGER NOT NULL REFERENCES users(user_id),
    reversed_by INTEGER REFERENCES users(user_id),
    reversed_at TIMESTAMP,
    reversal_reason TEXT,
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (status = 'recorded' AND reversed_by IS NULL AND reversed_at IS NULL)
        OR (status = 'reversed' AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL
            AND reversal_reason IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hrms_payroll_payment_reference
    ON hrms_payroll_payments(company_id, payment_reference)
    WHERE payment_reference IS NOT NULL AND status = 'recorded';
CREATE INDEX IF NOT EXISTS idx_hrms_payroll_payments_payroll
    ON hrms_payroll_payments(company_id, payroll_id, employee_id, status);

CREATE TABLE IF NOT EXISTS hrms_project_assignments (
    assignment_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    project_id INTEGER NOT NULL REFERENCES tbl_project(project_id),
    site_id INTEGER NOT NULL REFERENCES tbl_project_sites(site_id),
    start_date DATE NOT NULL,
    end_date DATE,
    hourly_rate NUMERIC(18,2) NOT NULL CHECK (hourly_rate >= 0),
    overtime_rate NUMERIC(18,2) NOT NULL CHECK (overtime_rate >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed', 'cancelled')),
    assigned_by INTEGER NOT NULL REFERENCES users(user_id),
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_hrms_project_assignments_employee_dates
    ON hrms_project_assignments(company_id, employee_id, start_date, end_date)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS hrms_project_timesheets (
    timesheet_id SERIAL PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES hrms_project_assignments(assignment_id),
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    project_id INTEGER NOT NULL REFERENCES tbl_project(project_id),
    site_id INTEGER NOT NULL REFERENCES tbl_project_sites(site_id),
    work_date DATE NOT NULL,
    regular_hours NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0 AND regular_hours <= 24),
    overtime_hours NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 24),
    hourly_rate NUMERIC(18,2) NOT NULL CHECK (hourly_rate >= 0),
    overtime_rate NUMERIC(18,2) NOT NULL CHECK (overtime_rate >= 0),
    total_cost NUMERIC(18,2) NOT NULL CHECK (total_cost >= 0),
    activity TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    submitted_by INTEGER NOT NULL REFERENCES users(user_id),
    approved_by INTEGER REFERENCES users(user_id),
    approved_at TIMESTAMP,
    review_remarks TEXT,
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (regular_hours + overtime_hours > 0)
);

DROP INDEX IF EXISTS idx_hrms_timesheet_assignment_date;
CREATE UNIQUE INDEX idx_hrms_timesheet_assignment_date
    ON hrms_project_timesheets(company_id, assignment_id, work_date)
    WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_hrms_timesheets_project_status_date
    ON hrms_project_timesheets(company_id, project_id, status, work_date);

CREATE TABLE IF NOT EXISTS hrms_employee_exits (
    exit_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    last_working_date DATE NOT NULL,
    exit_type VARCHAR(30) NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    requested_by INTEGER NOT NULL REFERENCES users(user_id),
    reviewed_by INTEGER REFERENCES users(user_id),
    reviewed_at TIMESTAMP,
    review_remarks TEXT,
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hrms_employee_one_pending_exit
    ON hrms_employee_exits(company_id, employee_id)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS hrms_training_courses (
    training_id SERIAL PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    provider VARCHAR(180),
    description TEXT,
    starts_on DATE,
    ends_on DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(user_id),
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS hrms_training_participants (
    participant_id SERIAL PRIMARY KEY,
    training_id INTEGER NOT NULL REFERENCES hrms_training_courses(training_id),
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    status VARCHAR(20) NOT NULL DEFAULT 'nominated'
        CHECK (status IN ('nominated', 'in_progress', 'completed', 'failed', 'cancelled')),
    completed_on DATE,
    result_notes TEXT,
    updated_by INTEGER NOT NULL REFERENCES users(user_id),
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (training_id, employee_id, company_id)
);

CREATE TABLE IF NOT EXISTS hrms_appraisals (
    appraisal_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES hrms_employees(employee_id),
    reviewer_user_id INTEGER NOT NULL REFERENCES users(user_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    rating NUMERIC(3,2) CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    achievements TEXT,
    goals TEXT,
    feedback TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    reviewed_by INTEGER REFERENCES users(user_id),
    reviewed_at TIMESTAMP,
    company_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hrms_appraisal_employee_period
    ON hrms_appraisals(company_id, employee_id, period_start, period_end);

CREATE OR REPLACE FUNCTION protect_locked_hrms_payroll_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_payroll_id INTEGER;
    target_company_id INTEGER;
    payroll_status VARCHAR(20);
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_payroll_id := OLD.payroll_id;
        target_company_id := OLD.company_id;
    ELSE
        target_payroll_id := NEW.payroll_id;
        target_company_id := NEW.company_id;
    END IF;

    SELECT status INTO payroll_status
    FROM hrms_payroll_runs
    WHERE payroll_id = target_payroll_id AND company_id = target_company_id
    FOR UPDATE;

    IF payroll_status IN ('approved', 'paid') THEN
        RAISE EXCEPTION 'Payroll items are locked after approval'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE'
       AND (OLD.payroll_id <> NEW.payroll_id OR OLD.company_id <> NEW.company_id) THEN
        SELECT status INTO payroll_status
        FROM hrms_payroll_runs
        WHERE payroll_id = OLD.payroll_id AND company_id = OLD.company_id
        FOR UPDATE;

        IF payroll_status IN ('approved', 'paid') THEN
            RAISE EXCEPTION 'Payroll items cannot be moved from an approved run'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_locked_hrms_payroll_item ON hrms_payroll_items;
CREATE TRIGGER trg_protect_locked_hrms_payroll_item
BEFORE INSERT OR UPDATE OR DELETE ON hrms_payroll_items
FOR EACH ROW EXECUTE FUNCTION protect_locked_hrms_payroll_item();

CREATE OR REPLACE FUNCTION protect_locked_hrms_payroll_deduction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_item_id INTEGER;
    target_company_id INTEGER;
    payroll_status VARCHAR(20);
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_item_id := OLD.payroll_item_id;
        target_company_id := OLD.company_id;
    ELSE
        target_item_id := NEW.payroll_item_id;
        target_company_id := NEW.company_id;
    END IF;

    SELECT r.status INTO payroll_status
    FROM hrms_payroll_items i
    JOIN hrms_payroll_runs r
      ON r.payroll_id = i.payroll_id AND r.company_id = i.company_id
    WHERE i.payroll_item_id = target_item_id AND i.company_id = target_company_id
    FOR UPDATE OF r;

    IF payroll_status IN ('approved', 'paid') THEN
        RAISE EXCEPTION 'Payroll deductions are locked after approval'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE'
       AND (OLD.payroll_item_id <> NEW.payroll_item_id OR OLD.company_id <> NEW.company_id) THEN
        SELECT r.status INTO payroll_status
        FROM hrms_payroll_items i
        JOIN hrms_payroll_runs r
          ON r.payroll_id = i.payroll_id AND r.company_id = i.company_id
        WHERE i.payroll_item_id = OLD.payroll_item_id AND i.company_id = OLD.company_id
        FOR UPDATE OF r;

        IF payroll_status IN ('approved', 'paid') THEN
            RAISE EXCEPTION 'Payroll deductions cannot be moved from an approved run'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_locked_hrms_payroll_deduction ON hrms_payroll_item_deductions;
CREATE TRIGGER trg_protect_locked_hrms_payroll_deduction
BEFORE INSERT OR UPDATE OR DELETE ON hrms_payroll_item_deductions
FOR EACH ROW EXECUTE FUNCTION protect_locked_hrms_payroll_deduction();

CREATE OR REPLACE FUNCTION protect_locked_hrms_payroll_run()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('approved', 'paid') THEN
            RAISE EXCEPTION 'Approved payroll runs cannot be deleted'
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status IN ('approved', 'paid') THEN
        IF OLD.pay_period_start IS DISTINCT FROM NEW.pay_period_start
           OR OLD.pay_period_end IS DISTINCT FROM NEW.pay_period_end
           OR OLD.total_gross IS DISTINCT FROM NEW.total_gross
           OR OLD.total_deductions IS DISTINCT FROM NEW.total_deductions
           OR OLD.total_net IS DISTINCT FROM NEW.total_net
           OR OLD.generated_by IS DISTINCT FROM NEW.generated_by
           OR OLD.approved_by IS DISTINCT FROM NEW.approved_by
           OR OLD.approved_at IS DISTINCT FROM NEW.approved_at
           OR OLD.locked_at IS DISTINCT FROM NEW.locked_at
           OR OLD.company_id IS DISTINCT FROM NEW.company_id THEN
            RAISE EXCEPTION 'Approved payroll runs are locked'
                USING ERRCODE = '55000';
        END IF;
        IF (OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'paid'))
           OR (OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'approved')) THEN
            RAISE EXCEPTION 'Invalid status transition for a locked payroll run'
                USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_locked_hrms_payroll_run ON hrms_payroll_runs;
CREATE TRIGGER trg_protect_locked_hrms_payroll_run
BEFORE UPDATE OR DELETE ON hrms_payroll_runs
FOR EACH ROW EXECUTE FUNCTION protect_locked_hrms_payroll_run();

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
        ('hrms_employee:private:view', 'HRMS'),
        ('hrms_employee:private:update', 'HRMS'),
        ('hrms_attendance:correction:create', 'HRMS'),
        ('hrms_attendance:correction:approve', 'HRMS'),
        ('hrms_leave:approve', 'HRMS'),
        ('hrms_payroll:payment:create', 'HRMS'),
        ('hrms_payroll:payment:reverse', 'HRMS'),
        ('hrms_project_assignment:view', 'HRMS'),
        ('hrms_project_assignment:create', 'HRMS'),
        ('hrms_project_assignment:update', 'HRMS'),
        ('hrms_project_timesheet:view', 'HRMS'),
        ('hrms_project_timesheet:create', 'HRMS'),
        ('hrms_project_timesheet:approve', 'HRMS'),
        ('hrms_employee_exit:view', 'HRMS'),
        ('hrms_employee_exit:create', 'HRMS'),
        ('hrms_employee_exit:approve', 'HRMS'),
        ('hrms_training:view', 'HRMS'),
        ('hrms_training:create', 'HRMS'),
        ('hrms_training:update', 'HRMS'),
        ('hrms_appraisal:view', 'HRMS'),
        ('hrms_appraisal:create', 'HRMS'),
        ('hrms_appraisal:update', 'HRMS'),
        ('hrms_appraisal:approve', 'HRMS')
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
