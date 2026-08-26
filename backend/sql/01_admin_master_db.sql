-- =====================================================================
-- CRM-ERP : ADMIN / MASTER DATABASE
-- Source: Notion "CRM-ERP Project Documentation"
-- Purpose: one shared DB that routes a login email to the correct
--          per-company database (multi-tenant architecture).
-- Create this database first, e.g.:  createdb crm_erp_admin
-- Then run this whole file against it.
-- =====================================================================
CREATE TABLE
    admins (
        admin_id SERIAL PRIMARY KEY,
        full_name VARCHAR(150),
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

-- ---------------------------------------------------------------------
-- Table 2: subscription_plans
-- (created before "companies" since companies references it)
-- ---------------------------------------------------------------------
CREATE TABLE
    IF NOT EXISTS subscription_plans (
        plan_id SERIAL PRIMARY KEY,
        plan_name VARCHAR(50) NOT NULL,
        max_users INTEGER,
        rate DECIMAL(10, 2),
        duration_days INTEGER, -- add days or month wise (options)
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_deleted BOOLEAN DEFAULT FALSE -- 1 -> YES , 0 -> NO
    );

-- ---------------------------------------------------------------------
-- Table 1: companies
-- ---------------------------------------------------------------------
CREATE TABLE
    IF NOT EXISTS companies (
        company_id SERIAL PRIMARY KEY,
        company_name VARCHAR(150) NOT NULL,
        company_code VARCHAR(20) UNIQUE NOT NULL, -- short code, used in login (subdomain or company code)
        company_email VARCHAR(150),
        gst_no VARCHAR(200),
        phone VARCHAR(20),
        address TEXT,
        db_name VARCHAR(100) NOT NULL, -- actual company database name
        db_host VARCHAR(100) NOT NULL, -- server/IP where company DB lives
        db_port INTEGER DEFAULT 5432,
        db_username VARCHAR(100), -- encrypted at the application layer
        db_password VARCHAR(255), -- encrypted at the application layer
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
        is_deleted BOOLEAN DEFAULT FALSE, -- 1 -> YES , 0 -> NO
        subscription_plan_id INTEGER REFERENCES subscription_plans (plan_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

-- ---------------------------------------------------------------------
-- Table 3: global_users  (the login router - the key table)
-- Note: password is NOT stored here - actual authentication happens in
-- the company DB. This table only answers "which company does this
-- email belong to?"
-- ---------------------------------------------------------------------
CREATE TABLE
    IF NOT EXISTS global_users (
        global_user_id SERIAL PRIMARY KEY,
        email VARCHAR(150) UNIQUE NOT NULL, -- used to find which company to connect to
        username VARCHAR(100), -- optional, if login by username
        phone VARCHAR(20), -- if login by phone
        -- password VARCHAR(255), -- bcrypt/argon2 hash (kept here only if you choose a shared-login variant)
        company_id INTEGER NOT NULL REFERENCES companies (company_id), -- tells system which DB to connect to
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        is_deleted BOOLEAN DEFAULT FALSE, -- 1 -> YES , 0 -> NO
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

-- ---------------------------------------------------------------------
-- Table 4: login_audit_logs
-- ---------------------------------------------------------------------
CREATE TABLE
    IF NOT EXISTS login_audit_logs (
        log_id SERIAL PRIMARY KEY,
        global_user_id INTEGER REFERENCES global_users (global_user_id),
        company_id INTEGER REFERENCES companies (company_id),
        ip_address VARCHAR(45),
        device_info VARCHAR(255),
        login_status VARCHAR(10) CHECK (login_status IN ('success', 'failed')),
        login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies (status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_code_active ON companies (company_code) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_global_users_company ON global_users (company_id);

CREATE INDEX IF NOT EXISTS idx_login_audit_global_user ON login_audit_logs (global_user_id);

CREATE INDEX IF NOT EXISTS idx_login_audit_company ON login_audit_logs (company_id);

CREATE INDEX IF NOT EXISTS idx_login_audit_time ON login_audit_logs (login_time DESC);
