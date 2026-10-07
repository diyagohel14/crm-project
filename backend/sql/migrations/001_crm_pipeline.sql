-- =====================================================================
-- MIGRATION 001: LEADS, ENQUIRIES & CRM ACTIVITY
--
-- Run ONCE against each EXISTING company database (new companies get this
-- from 02_company_db_schema.sql automatically):
--
--     psql -h <host> -U <user> -d <company_db> -f 001_crm_pipeline.sql
--
-- Safe to re-run. One transaction: it applies completely or not at all.
-- Grants any new permissions to the company's "Super Admin" role only;
-- assign them to other roles from the permissions screen.
-- =====================================================================

BEGIN;

-- =====================================================================
-- SECTION: CRM PRE-AWARD  (Lead -> Enquiry -> Quotation)
--
--   tbl_lead     a prospective client, not yet in tbl_party
--   tbl_enquiry  one specific piece of work being asked for (a bid /
--                RFQ / tender). Belongs to a lead OR to an existing
--                customer, so repeat customers skip the lead step.
--   tbl_crm_activity    calls / meetings / site visits / notes on either
--   tbl_enquiry_documents  RFQ, drawings, specs, tender documents
--
-- Converting a lead creates a tbl_party (CUSTOMER) and back-fills
-- party_id on the lead's enquiries, which is what allows a quotation.
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_lead (
    lead_id              SERIAL PRIMARY KEY,
    lead_no              VARCHAR(30) UNIQUE,                  -- generated from document_series, e.g. LEAD/00001
    company_name         VARCHAR(200) NOT NULL,
    contact_name         VARCHAR(150),
    designation          VARCHAR(100),
    phone                VARCHAR(20),
    email                VARCHAR(150),
    website              VARCHAR(100),
    gst_no               VARCHAR(100),
    industry_id          INTEGER REFERENCES industries(industry_id),
    lead_source_id       INTEGER REFERENCES lead_sources(lead_source_id),
    referred_by          VARCHAR(150),
    address_line1        VARCHAR(255),
    address_line2        VARCHAR(255),
    city_id              INTEGER REFERENCES city_mst(city_id),
    state_id             INTEGER REFERENCES state_mst(state_id),
    country_id           INTEGER REFERENCES country_mst(country_id),
    pincode              VARCHAR(10),
    assigned_to          INTEGER REFERENCES users(user_id),
    rating               VARCHAR(10) DEFAULT 'warm' CHECK (rating IN ('cold', 'warm', 'hot')),
    estimated_value      DECIMAL(20,2) DEFAULT 0,
    next_follow_up_date  DATE,                                -- rolled up from the latest activity
    last_contacted_at    TIMESTAMP,
    status               VARCHAR(15) DEFAULT 'new'
                         CHECK (status IN ('new', 'contacted', 'qualified', 'lost', 'converted')),
    lost_reason          VARCHAR(255),
    party_id             INTEGER REFERENCES tbl_party(party_id),   -- set when converted to a customer
    converted_at         TIMESTAMP,
    notes                TEXT,
    is_deleted           BOOLEAN DEFAULT FALSE,
    user_id              INTEGER,
    company_id           INTEGER,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_enquiry (
    enquiry_id             SERIAL PRIMARY KEY,
    enquiry_no             VARCHAR(30) UNIQUE,                -- generated from document_series, e.g. ENQ/00001
    enquiry_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    lead_id                INTEGER REFERENCES tbl_lead(lead_id),
    party_id               INTEGER REFERENCES tbl_party(party_id),    -- customer; required before a quotation
    contact_name           VARCHAR(150),
    contact_phone          VARCHAR(20),
    contact_email          VARCHAR(150),
    enquiry_title          VARCHAR(200) NOT NULL,
    project_type           VARCHAR(30) DEFAULT 'other'
                           CHECK (project_type IN (
                               'electrical','mechanical','mep','plumbing','piping','hvac',
                               'fabrication','installation','erection','commissioning',
                               'maintenance','turnkey','other'
                           )),                                -- same list as tbl_project
    industry_id            INTEGER REFERENCES industries(industry_id),
    lead_source_id         INTEGER REFERENCES lead_sources(lead_source_id),
    customer_ref_no        VARCHAR(100),                      -- the client's own RFQ / enquiry number
    plant_name             VARCHAR(150),
    project_location       VARCHAR(255),
    site_address           TEXT,
    scope_of_work          TEXT,
    is_tender              BOOLEAN DEFAULT FALSE,
    tender_no              VARCHAR(100),
    submission_due_date    DATE,                              -- last date to submit the quotation / bid
    prebid_meeting_date    DATE,
    emd_amount             DECIMAL(20,2) DEFAULT 0,           -- earnest money deposit, if a tender
    site_visit_required    BOOLEAN DEFAULT FALSE,
    site_visit_date        DATE,
    expected_start_date    DATE,
    expected_end_date      DATE,
    currency_id            INTEGER REFERENCES currency_mst(currency_id),
    estimated_value        DECIMAL(20,2) DEFAULT 0,
    priority               VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    assigned_to            INTEGER REFERENCES users(user_id),         -- sales owner
    estimator_id           INTEGER REFERENCES users(user_id),         -- prepares BOQ / costing
    next_follow_up_date    DATE,                              -- rolled up from the latest activity
    status                 VARCHAR(15) DEFAULT 'new'
                           CHECK (status IN (
                               'new','under_review','site_visit','estimating','quoted',
                               'negotiation','won','lost','no_bid','on_hold','cancelled'
                           )),
    lost_reason            VARCHAR(255),
    competitor_name        VARCHAR(150),                      -- who won it, when status = lost
    notes                  TEXT,
    is_deleted             BOOLEAN DEFAULT FALSE,
    user_id                INTEGER,
    company_id             INTEGER,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (lead_id IS NOT NULL OR party_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tbl_crm_activity (
    activity_id            SERIAL PRIMARY KEY,
    lead_id                INTEGER REFERENCES tbl_lead(lead_id),
    enquiry_id             INTEGER REFERENCES tbl_enquiry(enquiry_id),
    activity_type          VARCHAR(15) DEFAULT 'note'
                           CHECK (activity_type IN ('call', 'meeting', 'email', 'whatsapp', 'site_visit', 'note')),
    activity_date          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    subject                VARCHAR(200),
    outcome                TEXT,
    next_follow_up_date    DATE,
    done_by                INTEGER REFERENCES users(user_id),
    is_deleted             BOOLEAN DEFAULT FALSE,
    user_id                INTEGER,
    company_id             INTEGER,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (lead_id IS NOT NULL OR enquiry_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tbl_enquiry_documents (
    document_id            SERIAL PRIMARY KEY,
    enquiry_id             INTEGER REFERENCES tbl_enquiry(enquiry_id),
    document_type          VARCHAR(30) DEFAULT 'other'
                           CHECK (document_type IN (
                               'rfq','tender_document','drawing','specification','boq',
                               'site_photo','correspondence','other'
                           )),
    document_name          VARCHAR(255) NOT NULL,
    file_url               VARCHAR(500) NOT NULL,
    remarks                VARCHAR(255),
    uploaded_by            INTEGER REFERENCES users(user_id),
    is_deleted             BOOLEAN DEFAULT FALSE,
    user_id                INTEGER,
    company_id             INTEGER,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- A quotation can point back at the enquiry it answers.
ALTER TABLE tbl_quotation ADD COLUMN IF NOT EXISTS enquiry_id INTEGER REFERENCES tbl_enquiry(enquiry_id);

CREATE INDEX IF NOT EXISTS idx_lead_company_status ON tbl_lead(company_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_assigned ON tbl_lead(assigned_to);
CREATE INDEX IF NOT EXISTS idx_lead_follow_up ON tbl_lead(next_follow_up_date);
CREATE INDEX IF NOT EXISTS idx_lead_party ON tbl_lead(party_id);

CREATE INDEX IF NOT EXISTS idx_enquiry_company_status ON tbl_enquiry(company_id, status);
CREATE INDEX IF NOT EXISTS idx_enquiry_party ON tbl_enquiry(party_id);
CREATE INDEX IF NOT EXISTS idx_enquiry_lead ON tbl_enquiry(lead_id);
CREATE INDEX IF NOT EXISTS idx_enquiry_assigned ON tbl_enquiry(assigned_to);
CREATE INDEX IF NOT EXISTS idx_enquiry_due ON tbl_enquiry(submission_due_date);
CREATE INDEX IF NOT EXISTS idx_enquiry_follow_up ON tbl_enquiry(next_follow_up_date);
CREATE INDEX IF NOT EXISTS idx_quotation_enquiry ON tbl_quotation(enquiry_id);

CREATE INDEX IF NOT EXISTS idx_crm_activity_lead ON tbl_crm_activity(lead_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_crm_activity_enquiry ON tbl_crm_activity(enquiry_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_enquiry_documents_enquiry ON tbl_enquiry_documents(enquiry_id);

-- Starter values for the (previously empty) CRM masters. Safe to re-run.
INSERT INTO lead_sources (source_name)
SELECT v FROM (VALUES ('Website'), ('Referral'), ('Existing customer'), ('Tender portal'),
                      ('Cold call'), ('Walk-in'), ('Exhibition'), ('Email / WhatsApp')) AS s(v)
WHERE NOT EXISTS (SELECT 1 FROM lead_sources ls WHERE ls.source_name = s.v);

INSERT INTO industries (industry_name)
SELECT v FROM (VALUES ('Chemical'), ('Pharmaceutical'), ('Textile'), ('Engineering / Manufacturing'),
                      ('Food processing'), ('Real estate / Commercial'), ('Power / Utilities'),
                      ('Oil, gas & petrochemical')) AS s(v)
WHERE NOT EXISTS (SELECT 1 FROM industries i WHERE i.industry_name = s.v);

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
            (21, 'Lead', 'LEAD/'),
            (22, 'Enquiry', 'ENQ/')
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
            ('lead:view', 'Lead'),
            ('lead:create', 'Lead'),
            ('lead:update', 'Lead'),
            ('lead:delete', 'Lead'),
            ('lead:convert', 'Lead'),
            ('enquiry:view', 'Enquiry'),
            ('enquiry:create', 'Enquiry'),
            ('enquiry:update', 'Enquiry'),
            ('enquiry:delete', 'Enquiry'),
            ('enquiry_document:view', 'Enquiry'),
            ('enquiry_document:create', 'Enquiry'),
            ('enquiry_document:delete', 'Enquiry'),
            ('lead_source:view', 'CRM Master'),
            ('lead_source:create', 'CRM Master'),
            ('industry:view', 'CRM Master'),
            ('industry:create', 'CRM Master')
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
