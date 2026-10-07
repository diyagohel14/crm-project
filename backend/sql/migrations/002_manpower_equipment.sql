-- =====================================================================
-- MIGRATION 002: MANPOWER & EQUIPMENT COSTING
--
-- Run ONCE against each EXISTING company database (new companies get this
-- from 02_company_db_schema.sql automatically):
--
--     psql -h <host> -U <user> -d <company_db> -f 002_manpower_equipment.sql
--
-- Safe to re-run. One transaction: it applies completely or not at all.
-- Grants any new permissions to the company's "Super Admin" role only;
-- assign them to other roles from the permissions screen.
-- =====================================================================

BEGIN;

-- =====================================================================
-- SECTION: MANPOWER & EQUIPMENT COSTING
--
--   labour_trade_mst / equipment_mst    the two registers
--   tbl_project_manpower_log            one row per project/trade/day
--   tbl_project_equipment_log           one row per project/equipment/day
--
-- Every log write recalculates two things (see costingService.js):
--   tbl_project_costs.actual_amount     for category 'labour' or 'equipment'
--   tbl_project.actual_cost             sum of ALL tbl_project_costs rows
-- so project cost control finally reflects real postings instead of a
-- number nobody ever updates.
-- =====================================================================

CREATE TABLE IF NOT EXISTS labour_trade_mst (
    trade_id      SERIAL PRIMARY KEY,
    trade_name    VARCHAR(100) UNIQUE NOT NULL,
    status        VARCHAR(10) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted    BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS equipment_mst (
    equipment_id     SERIAL PRIMARY KEY,
    equipment_code    VARCHAR(30) UNIQUE,                     -- generated from document_series, e.g. EQP/00001
    equipment_name    VARCHAR(150) NOT NULL,
    equipment_type    VARCHAR(20) DEFAULT 'other'
                      CHECK (equipment_type IN (
                          'crane', 'welding_machine', 'generator', 'compressor', 'lifting_equipment',
                          'excavator', 'forklift', 'testing_equipment', 'vehicle', 'other'
                      )),
    ownership         VARCHAR(10) DEFAULT 'owned' CHECK (ownership IN ('owned', 'rented')),
    vendor_id         INTEGER REFERENCES tbl_party(party_id),  -- rental vendor, if ownership = 'rented'
    rate_per_hour     DECIMAL(20,2) DEFAULT 0,
    rate_per_day      DECIMAL(20,2) DEFAULT 0,
    status            VARCHAR(20) DEFAULT 'active'
                      CHECK (status IN ('active', 'under_maintenance', 'retired')),
    notes             VARCHAR(255),
    is_deleted        BOOLEAN DEFAULT FALSE,
    user_id           INTEGER,
    company_id        INTEGER,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_project_manpower_log (
    manpower_log_id    SERIAL PRIMARY KEY,
    project_id         INTEGER REFERENCES tbl_project(project_id),
    site_id            INTEGER REFERENCES tbl_project_sites(site_id),
    log_date           DATE NOT NULL,
    trade_id           INTEGER REFERENCES labour_trade_mst(trade_id),
    headcount          INTEGER NOT NULL CHECK (headcount > 0),
    regular_hours      DECIMAL(6,2) NOT NULL DEFAULT 8 CHECK (regular_hours >= 0),
    overtime_hours     DECIMAL(6,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
    rate_per_hour      DECIMAL(20,2) NOT NULL CHECK (rate_per_hour >= 0),
    ot_rate_per_hour   DECIMAL(20,2),                          -- defaults to 1.5x rate_per_hour if not given
    -- headcount * (regular_hours*rate_per_hour + overtime_hours*ot_rate_per_hour), kept in
    -- sync by the application rather than a GENERATED column so a future rate correction
    -- on an existing row recalculates it the same way a new row would.
    total_cost         DECIMAL(20,2) NOT NULL DEFAULT 0,
    subcontractor_id   INTEGER REFERENCES tbl_party(party_id),  -- set when this is subcontracted labour, not direct
    remarks            VARCHAR(255),
    is_deleted         BOOLEAN DEFAULT FALSE,
    user_id            INTEGER,
    company_id         INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_project_equipment_log (
    equipment_log_id   SERIAL PRIMARY KEY,
    project_id         INTEGER REFERENCES tbl_project(project_id),
    site_id            INTEGER REFERENCES tbl_project_sites(site_id),
    equipment_id       INTEGER REFERENCES equipment_mst(equipment_id),
    log_date           DATE NOT NULL,
    hours_used         DECIMAL(6,2) NOT NULL CHECK (hours_used > 0 AND hours_used <= 24),
    rate_per_hour      DECIMAL(20,2) NOT NULL CHECK (rate_per_hour >= 0),  -- snapshot from equipment_mst, overridable
    fuel_cost          DECIMAL(20,2) DEFAULT 0 CHECK (fuel_cost >= 0),
    operator_name      VARCHAR(150),
    -- hours_used*rate_per_hour + fuel_cost, kept in sync by the application (see total_cost note above)
    total_cost         DECIMAL(20,2) NOT NULL DEFAULT 0,
    remarks            VARCHAR(255),
    is_deleted         BOOLEAN DEFAULT FALSE,
    user_id            INTEGER,
    company_id         INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Partial + expression indexes: COALESCE lets NULL subcontractor_id still collide (a
-- plain UNIQUE column treats every NULL as distinct, so it would never catch a duplicate
-- direct-labour entry); the is_deleted filter lets a deleted line's slot be reused.
CREATE UNIQUE INDEX IF NOT EXISTS idx_manpower_log_unique
    ON tbl_project_manpower_log (project_id, log_date, trade_id, COALESCE(subcontractor_id, 0))
    WHERE is_deleted = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_log_unique
    ON tbl_project_equipment_log (project_id, equipment_id, log_date)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_manpower_log_project_date ON tbl_project_manpower_log(project_id, log_date);
CREATE INDEX IF NOT EXISTS idx_equipment_log_project_date ON tbl_project_equipment_log(project_id, log_date);
CREATE INDEX IF NOT EXISTS idx_equipment_log_equipment ON tbl_project_equipment_log(equipment_id, log_date);
CREATE INDEX IF NOT EXISTS idx_equipment_company ON equipment_mst(company_id);

INSERT INTO labour_trade_mst (trade_name)
SELECT v FROM (VALUES ('Electrician'), ('Fitter'), ('Welder'), ('Supervisor'), ('Engineer'),
                      ('Helper'), ('Mason'), ('Rigger'), ('Painter'), ('Plumber')) AS s(v)
WHERE NOT EXISTS (SELECT 1 FROM labour_trade_mst t WHERE t.trade_name = s.v);

DO $$
DECLARE
    cid INTEGER;
    fy  INTEGER;
    rec RECORD;
    pid INTEGER;
BEGIN
    SELECT company_id INTO cid FROM tbl_company_profile ORDER BY company_profile_id LIMIT 1;
    IF cid IS NULL THEN
        RAISE EXCEPTION 'tbl_company_profile is empty - cannot work out company_id, nothing was changed';
    END IF;
    SELECT financial_year_id INTO fy FROM financial_years WHERE is_current = TRUE AND is_deleted = FALSE LIMIT 1;

    FOR rec IN SELECT * FROM (VALUES
            (23, 'Equipment', 'EQP/')
        ) AS d(id, name, prefix)
    LOOP
        INSERT INTO document_type (doc_type_id, document_type_name, company_id)
        SELECT rec.id, rec.name, cid
         WHERE NOT EXISTS (SELECT 1 FROM document_type d WHERE d.doc_type_id = rec.id AND d.company_id = cid);
        INSERT INTO document_series (document_type_id, prefix, postfix, financial_year_id, padding_length, company_id)
        SELECT rec.id, rec.prefix, '', fy, 5, cid
         WHERE NOT EXISTS (SELECT 1 FROM document_series s WHERE s.document_type_id = rec.id AND s.company_id = cid);
    END LOOP;

    FOR rec IN SELECT * FROM (VALUES
            ('equipment:view', 'Equipment'),
            ('equipment:create', 'Equipment'),
            ('equipment:update', 'Equipment'),
            ('equipment:delete', 'Equipment'),
            ('labour_trade:view', 'Manpower'),
            ('labour_trade:create', 'Manpower'),
            ('manpower_log:view', 'Manpower'),
            ('manpower_log:create', 'Manpower'),
            ('manpower_log:update', 'Manpower'),
            ('manpower_log:delete', 'Manpower'),
            ('equipment_log:view', 'Equipment'),
            ('equipment_log:create', 'Equipment'),
            ('equipment_log:update', 'Equipment'),
            ('equipment_log:delete', 'Equipment')
        ) AS p(permission_name, module_name)
    LOOP
        SELECT permission_id INTO pid FROM permissions WHERE permission_name = rec.permission_name AND company_id = cid;
        IF pid IS NULL THEN
            INSERT INTO permissions (permission_name, module_name, status, company_id)
            VALUES (rec.permission_name, rec.module_name, TRUE, cid) RETURNING permission_id INTO pid;
        END IF;
        INSERT INTO role_permissions (role_id, permission_id, is_allowed, company_id)
        SELECT r.role_id, pid, TRUE, cid FROM roles r
         WHERE r.role_name = 'Super Admin' AND r.company_id = cid AND r.is_deleted = FALSE
           AND NOT EXISTS (SELECT 1 FROM role_permissions rp
                            WHERE rp.role_id = r.role_id AND rp.permission_id = pid AND rp.company_id = cid);
    END LOOP;
END $$;

COMMIT;
