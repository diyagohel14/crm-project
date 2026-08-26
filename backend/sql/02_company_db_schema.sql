-- =====================================================================
-- CRM-ERP : COMPANY DATABASE (one per tenant, same schema replicated)
-- Source: Notion "CRM-ERP Project Documentation"
--
-- Create ONE database per company, e.g.:  createdb crm_company_001
-- then run this whole file against it. The Admin DB's "companies" table
-- (see 01_admin_master_db.sql) stores the db_name/db_host used to
-- connect to each of these.
--
-- Note on "company_id" / "user_id" audit columns: the doc marks nearly
-- every table with `company_id` ("from session") and `user_id` ("who
-- did the action"). Since company_id points at a row in the SEPARATE
-- admin database, it cannot be a real foreign key here, so it's kept
-- as a plain INTEGER. user_id audit columns are also kept as plain
-- INTEGER (soft reference to users.user_id) purely to avoid an
-- unmanageable circular dependency chain across ~40 tables during
-- creation; add the FK yourself later with ALTER TABLE if you want it
-- enforced once all tables exist.
-- =====================================================================


-- =====================================================================
-- SECTION 1: LOCATION MASTERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS country_mst (
    country_id     SERIAL PRIMARY KEY,
    country_name   VARCHAR(100) NOT NULL UNIQUE,
    country_code   VARCHAR(5) UNIQUE,                     -- ISO code, e.g. IN, US
    phone_code     VARCHAR(10),                     -- e.g. +91
    status         VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id        INTEGER                          -- who did the action (soft ref -> users.user_id)
);

INSERT INTO country_mst
(country_name, country_code, phone_code)
VALUES
('India','IN','+91'),
('United States','US','+1'),
('United Kingdom','GB','+44'),
('Canada','CA','+1'),
('Australia','AU','+61'),
('Germany','DE','+49'),
('France','FR','+33'),
('Japan','JP','+81'),
('China','CN','+86'),
('Singapore','SG','+65');

CREATE TABLE IF NOT EXISTS state_mst (
    state_id       SERIAL PRIMARY KEY,
    country_id     INTEGER REFERENCES country_mst(country_id),
    state_name     VARCHAR(100) NOT NULL UNIQUE,
    state_code     VARCHAR(10) UNIQUE,                     -- e.g. GJ, MH
    status         VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id        INTEGER
);

INSERT INTO state_mst (country_id, state_name, state_code) VALUES
(1,'Andhra Pradesh','AP'),
(1,'Arunachal Pradesh','AR'),
(1,'Assam','AS'),
(1,'Bihar','BR'),
(1,'Chhattisgarh','CG'),
(1,'Goa','GA'),
(1,'Gujarat','GJ'),
(1,'Haryana','HR'),
(1,'Himachal Pradesh','HP'),
(1,'Jharkhand','JH'),
(1,'Karnataka','KA'),
(1,'Kerala','KL'),
(1,'Madhya Pradesh','MP'),
(1,'Maharashtra','MH'),
(1,'Manipur','MN'),
(1,'Meghalaya','ML'),
(1,'Mizoram','MZ'),
(1,'Nagaland','NL'),
(1,'Odisha','OD'),
(1,'Punjab','PB'),
(1,'Rajasthan','RJ'),
(1,'Sikkim','SK'),
(1,'Tamil Nadu','TN'),
(1,'Telangana','TS'),
(1,'Tripura','TR'),
(1,'Uttar Pradesh','UP'),
(1,'Uttarakhand','UK'),
(1,'West Bengal','WB'),
(1,'Andaman and Nicobar Islands','AN'),
(1,'Chandigarh','CH'),
(1,'Dadra and Nagar Haveli and Daman and Diu','DN'),
(1,'Delhi','DL'),
(1,'Jammu and Kashmir','JK'),
(1,'Ladakh','LA'),
(1,'Lakshadweep','LD'),
(1,'Puducherry','PY');

CREATE TABLE IF NOT EXISTS city_mst (
    city_id        SERIAL PRIMARY KEY,
    state_id       INTEGER REFERENCES state_mst(state_id),
    city_name      VARCHAR(100) NOT NULL UNIQUE,
    pincode        VARCHAR(10),                     -- optional flat field; pincode_mst below is the granular option
    status         VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id        INTEGER
);

INSERT INTO city_mst (state_id, city_name, pincode) VALUES
-- =====================================================
-- Gujarat (state_id = 7)
-- =====================================================
(7, 'Ahmedabad', '380001'),
(7, 'Surat', '395003'),
(7, 'Vadodara', '390001'),
(7, 'Rajkot', '360001'),
(7, 'Bhavnagar', '364001'),
(7, 'Jamnagar', '361001'),
(7, 'Junagadh', '362001'),
(7, 'Gandhinagar', '382010'),
(7, 'Anand', '388001'),
(7, 'Mehsana', '384001'),
(7, 'Nadiad', '387001'),
(7, 'Morbi', '363641'),
(7, 'Porbandar', '360575'),
(7, 'Patan', '384265'),
(7, 'Navsari', '396445'),
(7, 'Valsad', '396001'),
(7, 'Bharuch', '392001'),
(7, 'Godhra', '389001'),
(7, 'Palanpur', '385001'),
(7, 'Veraval', '362265'),
(7, 'Amreli', '365601'),
(7, 'Bhuj', '370001'),
(7, 'Botad', '364710'),
(7, 'Dahod', '389151'),
(7, 'Gondal', '360311'),
(7, 'Kalol', '382721'),
(7, 'Deesa', '385535'),
(7, 'Vapi', '396191'),
(7, 'Mundra', '370421'),
(7, 'Keshod', '362220'),
-- =====================================================
-- Goa (state_id = 6)
-- =====================================================
(6, 'Panaji', '403001'),
(6, 'Margao', '403601'),
(6, 'Vasco da Gama', '403802'),
(6, 'Mapusa', '403507'),
(6, 'Ponda', '403401'),
(6, 'Bicholim', '403504'),
(6, 'Curchorem', '403706'),
(6, 'Canacona', '403702'),
(6, 'Sanquelim', '403505'),
(6, 'Valpoi', '403506'),
-- =====================================================
-- Assam (state_id = 3)
-- =====================================================
(3, 'Guwahati', '781001'),
(3, 'Silchar', '788001'),
(3, 'Dibrugarh', '786001'),
(3, 'Jorhat', '785001'),
(3, 'Tezpur', '784001'),
(3, 'Nagaon', '782001'),
(3, 'Tinsukia', '786125'),
(3, 'Sivasagar', '785640'),
(3, 'Karimganj', '788710'),
(3, 'Goalpara', '783101'),
-- =====================================================
-- Rajasthan (state_id = 21)
-- =====================================================
(21, 'Jaipur', '302001'),
(21, 'Jodhpur', '342001'),
(21, 'Udaipur', '313001'),
(21, 'Kota', '324001'),
(21, 'Ajmer', '305001'),
(21, 'Bikaner', '334001'),
(21, 'Alwar', '301001'),
(21, 'Bharatpur', '321001'),
(21, 'Sikar', '332001'),
(21, 'Pali', '306401'),
(21, 'Bhilwara', '311001'),
(21, 'Sri Ganganagar', '335001'),
(21, 'Churu', '331001'),
(21, 'Jhunjhunu', '333001'),
(21, 'Hanumangarh', '335512'),
(21, 'Barmer', '344001'),
(21, 'Tonk', '304001'),
(21, 'Sawai Madhopur', '322001'),
(21, 'Nagaur', '341001'),
(21, 'Jaisalmer', '345001'),
(21, 'Dungarpur', '314001'),
(21, 'Banswara', '327001'),
(21, 'Chittorgarh', '312001'),
(21, 'Beawar', '305901'),
(21, 'Kishangarh', '305801'),
(21, 'Mount Abu', '307501'),
(21, 'Neem Ka Thana', '332713'),
(21, 'Pratapgarh', '312605'),
(21, 'Baran', '325205'),
(21, 'Jhalawar', '326001');

CREATE TABLE IF NOT EXISTS pincode_mst (
    pincode_id     SERIAL PRIMARY KEY,
    city_id        INTEGER REFERENCES city_mst(city_id),
    pincode        VARCHAR(10) NOT NULL UNIQUE,
    status         VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER
);


-- =====================================================================
-- SECTION 2: FINANCE & TRANSACTION MASTERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS currency_mst (
    currency_id       SERIAL PRIMARY KEY,
    currency_name     VARCHAR(50) NOT NULL UNIQUE,          -- e.g. Indian Rupee
    currency_code     VARCHAR(10),                    -- ISO code, e.g. INR, USD
    symbol            VARCHAR(5),                     -- e.g. Rs, $
    exchange_rate     DECIMAL(10,4),                  -- relative to base currency
    is_base_currency  BOOLEAN DEFAULT FALSE,
    status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted        BOOLEAN DEFAULT FALSE,
    user_id           INTEGER
);
INSERT INTO currency_mst
(currency_name, currency_code, symbol, exchange_rate, is_base_currency)
VALUES
('Indian Rupee', 'INR', '₹', 1.0000, TRUE),
('US Dollar', 'USD', '$', 87.2500, FALSE),
('Euro', 'EUR', '€', 101.3500, FALSE),
('British Pound', 'GBP', '£', 117.8000, FALSE),
('UAE Dirham', 'AED', 'د.إ', 23.7500, FALSE),
('Saudi Riyal', 'SAR', '﷼', 23.2600, FALSE),
('Singapore Dollar', 'SGD', 'S$', 68.4000, FALSE),
('Australian Dollar', 'AUD', 'A$', 57.3000, FALSE),
('Canadian Dollar', 'CAD', 'C$', 63.2000, FALSE),
('Japanese Yen', 'JPY', '¥', 0.5900, FALSE),
('Chinese Yuan', 'CNY', '¥', 12.1500, FALSE),
('Swiss Franc', 'CHF', 'CHF', 108.5000, FALSE),
('New Zealand Dollar', 'NZD', 'NZ$', 52.6000, FALSE),
('Hong Kong Dollar', 'HKD', 'HK$', 11.1200, FALSE),
('Qatari Riyal', 'QAR', '﷼', 23.9500, FALSE),
('Kuwaiti Dinar', 'KWD', 'KD', 284.5000, FALSE),
('Bahraini Dinar', 'BHD', 'BD', 231.4000, FALSE),
('Omani Rial', 'OMR', 'ر.ع.', 226.8000, FALSE),
('Malaysian Ringgit', 'MYR', 'RM', 20.6000, FALSE),
('Thai Baht', 'THB', '฿', 2.6900, FALSE),
('Bangladeshi Taka', 'BDT', '৳', 0.7200, FALSE),
('Sri Lankan Rupee', 'LKR', 'Rs', 0.2900, FALSE),
('Nepalese Rupee', 'NPR', 'Rs', 0.6250, FALSE),
('Pakistani Rupee', 'PKR', '₨', 0.3100, FALSE),
('South African Rand', 'ZAR', 'R', 4.8500, FALSE),
('Russian Ruble', 'RUB', '₽', 1.0900, FALSE),
('Brazilian Real', 'BRL', 'R$', 15.8000, FALSE),
('Mexican Peso', 'MXN', '$', 4.7000, FALSE);

-- Optional
CREATE TABLE IF NOT EXISTS languages (
    language_id     SERIAL PRIMARY KEY,
    language_name   VARCHAR(50) NOT NULL,
    language_code   VARCHAR(10),                      -- e.g. en, hi, gu
    status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted      BOOLEAN DEFAULT FALSE,
    user_id         INTEGER
);

CREATE TABLE IF NOT EXISTS tax_types (
    tax_id           SERIAL PRIMARY KEY,
    tax_name         VARCHAR(50) NOT NULL,            -- e.g. CGST, SGST, IGST, VAT
    tax_percentage   DECIMAL(5,2),
    tax_type         VARCHAR(20) CHECK (tax_type IN ('percentage', 'fixed')),
    applicable_on    VARCHAR(20) CHECK (applicable_on IN ('sales', 'purchase', 'both')),
    status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted       BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id          INTEGER
);

CREATE TABLE IF NOT EXISTS units_of_measure (
    unit_id     SERIAL PRIMARY KEY,
    unit_name   VARCHAR(50) NOT NULL,                 -- e.g. Kilogram, Piece, Liter
    unit_code   VARCHAR(10),                           -- e.g. KG, PCS, LTR
    unit_type   VARCHAR(20) CHECK (unit_type IN ('weight', 'volume', 'count', 'length')),  -- optional
    status      VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted  BOOLEAN DEFAULT FALSE,
    user_id     INTEGER
);

CREATE TABLE IF NOT EXISTS financial_years (
    financial_year_id   SERIAL PRIMARY KEY,
    fy_name              VARCHAR(20) NOT NULL,          -- e.g. 2026-27
    start_date           DATE,
    end_date             DATE,
    is_current            BOOLEAN DEFAULT FALSE,        --Only single financial year can be current at a time
    status                VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'closed')), 
    is_deleted            BOOLEAN DEFAULT FALSE,
    user_id               INTEGER
);

CREATE TABLE IF NOT EXISTS payment_terms (
    payment_term_id   SERIAL PRIMARY KEY,
    term_name         VARCHAR(100) NOT NULL,           -- e.g. Net 30, Due on Receipt
    days              INTEGER,                          -- number of credit days
    status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted        BOOLEAN DEFAULT FALSE,
    company_id        INTEGER,                          -- from session (admin DB ref, not a local FK)
    user_id           INTEGER
);

CREATE TABLE IF NOT EXISTS bank_mst (
    bank_id      SERIAL PRIMARY KEY,
    bank_name    VARCHAR(100) NOT NULL,
    status       VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted   BOOLEAN DEFAULT FALSE,
    user_id      INTEGER
);

INSERT INTO bank_mst (bank_name) VALUES
-- Public Sector Banks
('State Bank of India'),
('Punjab National Bank'),
('Bank of Baroda'),
('Canara Bank'),
('Union Bank of India'),
('Indian Bank'),
('Bank of India'),
('Central Bank of India'),
('UCO Bank'),
('Bank of Maharashtra'),
('Punjab & Sind Bank'),
('Indian Overseas Bank'),

-- Private Sector Banks
('HDFC Bank'),
('ICICI Bank'),
('Axis Bank'),
('Kotak Mahindra Bank'),
('IndusInd Bank'),
('Yes Bank'),
('IDFC FIRST Bank'),
('South Indian Bank'),
('Federal Bank'),
('Karur Vysya Bank'),
('City Union Bank'),
('Tamilnad Mercantile Bank'),
('Karnataka Bank'),
('DCB Bank'),
('RBL Bank'),
('CSB Bank'),
('Jammu & Kashmir Bank'),
('Nainital Bank'),
('Dhanlaxmi Bank'),

-- Small Finance Banks
('AU Small Finance Bank'),
('Ujjivan Small Finance Bank'),
('Equitas Small Finance Bank'),
('ESAF Small Finance Bank'),
('Suryoday Small Finance Bank'),
('Jana Small Finance Bank'),
('Utkarsh Small Finance Bank'),
('North East Small Finance Bank'),
('Capital Small Finance Bank'),
('Unity Small Finance Bank'),
('Shivalik Small Finance Bank'),

-- Payments Banks
('India Post Payments Bank'),
('Airtel Payments Bank'),
('Fino Payments Bank'),
('Paytm Payments Bank'),
('NSDL Payments Bank'),

-- Foreign Banks
('Citibank'),
('HSBC Bank'),
('Standard Chartered Bank'),
('Deutsche Bank'),
('DBS Bank India'),
('Barclays Bank'),
('BNP Paribas'),
('Bank of America'),
('JPMorgan Chase Bank'),
('MUFG Bank'),
('Mizuho Bank'),
('Credit Agricole'),
('Societe Generale'),
('Bank of Bahrain and Kuwait'),
('Doha Bank'),
('First Abu Dhabi Bank'),
('Industrial and Commercial Bank of China'),
('State Bank of Mauritius'),
('Woori Bank'),
('Shinhan Bank'),
('CTBC Bank'),
('ANZ Bank'),
('Rabobank'),
('American Express Banking Corp');

CREATE TABLE IF NOT EXISTS cr_dr_reason_mst (
    reason_id     SERIAL PRIMARY KEY,
    form_type     VARCHAR(10) CHECK (form_type IN ('credit', 'debit')),
    reason_name   VARCHAR(100) NOT NULL,
    status        VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted    BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id       INTEGER
);

-- Referenced in "Notes for update master tables" section
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    account_id          SERIAL PRIMARY KEY,
    account_code        VARCHAR(30),
    account_name        VARCHAR(150) NOT NULL,
    account_type        VARCHAR(50),
    parent_account_id   INTEGER REFERENCES chart_of_accounts(account_id),
    status               VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted            BOOLEAN DEFAULT FALSE,
    user_id               INTEGER
);


-- =====================================================================
-- SECTION 3: AUTH / ACCESS MASTERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS roles (
    role_id       SERIAL PRIMARY KEY,
    role_name     VARCHAR(50) NOT NULL,               -- admin, user, sales, etc.
    description   TEXT,
    is_deleted    BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    company_id    INTEGER                              -- from session
);

CREATE TABLE IF NOT EXISTS permissions (
    permission_id     SERIAL PRIMARY KEY,
    permission_name   VARCHAR(100) NOT NULL,           -- e.g. "Create Invoice", "Delete Party"
    module_name       VARCHAR(100),                     -- e.g. CRM, Sales, Finance - groups permissions in the UI
    status            BOOLEAN DEFAULT TRUE,             -- 1 = active, 0 = inactive
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id           INTEGER,                          -- who assigned this permission
    company_id        INTEGER
);

-- junction table - many-to-many between roles and permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    role_permission_id   SERIAL PRIMARY KEY,
    role_id               INTEGER REFERENCES roles(role_id),
    permission_id         INTEGER REFERENCES permissions(permission_id),
    is_allowed            BOOLEAN DEFAULT TRUE,          -- 1 = granted, 0 = explicitly denied (overrides a default)
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id               INTEGER,
    company_id            INTEGER
);

-- =====================================================================
-- SECTION 4: HR & ORGANIZATION MASTERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS departments (
    department_id     SERIAL PRIMARY KEY,
    department_name   VARCHAR(100) NOT NULL,
    is_deleted        BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id           INTEGER,
    company_id        INTEGER
);


-- =====================================================================
-- SECTION 6: USERS, SECURITY & AUDIT
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
    user_id             SERIAL PRIMARY KEY,
    employee_id         VARCHAR(20),                       -- optional, ERP-specific
    first_name          VARCHAR(100) NOT NULL,
    last_name           VARCHAR(100),
    email               VARCHAR(150) NOT NULL,       -- must match global_users.email in the admin DB
    username            VARCHAR(100),
    password            VARCHAR(255) NOT NULL,               -- bcrypt/argon2 hash
    phone               VARCHAR(20) NOT NULL,
    profile_image       VARCHAR(255),
    status              VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'locked')),
    is_deleted          BOOLEAN DEFAULT FALSE,
    is_email_verified   BOOLEAN DEFAULT FALSE,
    last_login          TIMESTAMP,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    company_id          INTEGER,                             -- from session (admin DB ref)
    role_id             INTEGER REFERENCES roles(role_id),
    department_id       INTEGER REFERENCES departments(department_id)
);


CREATE TABLE IF NOT EXISTS login_audit_logs (
    log_id            SERIAL PRIMARY KEY,
    user_id           INTEGER REFERENCES users(user_id),
    role_id           INTEGER REFERENCES roles(role_id),
    company_id        INTEGER,
    ip_address        VARCHAR(45),
    device_info       VARCHAR(255),
    login_status      VARCHAR(10) DEFAULT 'success' CHECK (login_status IN ('success', 'failed')),
    login_time        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    log_id               BIGSERIAL PRIMARY KEY,
    module_name          VARCHAR(100),                      -- e.g. CRM, Sales, Finance, HR, Login
    page_name            VARCHAR(100),                       -- e.g. Lead Management, Invoice, User Profile
    table_name           VARCHAR(100),                        -- actual DB table affected, e.g. leads, invoices
    table_id              VARCHAR(50),                         -- PK value of the affected row
    action_type           VARCHAR(100) CHECK (action_type IN ('CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'STATUS_CHANGE')),
    action_description     VARCHAR(255),                        -- e.g. "Lead status changed from New to Qualified"
    old_value               JSONB,                                -- snapshot of row before change (NULL for CREATE)
    new_value                JSONB,                                -- snapshot of row after change (NULL for DELETE)
    changed_fields            JSONB,                                -- list of field names that changed (UPDATE only)
    user_id                   INTEGER REFERENCES users(user_id),    -- who did the action
    role_id                   INTEGER REFERENCES roles(role_id),
    ip_address                 VARCHAR(45),
    device_info                 VARCHAR(255),                         -- browser/OS/device
    status                      VARCHAR(10) DEFAULT 'success' CHECK (status IN ('success', 'failed')),
    created_at                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    company_id                   INTEGER                               -- from session
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id     SERIAL PRIMARY KEY,
    user_id      INTEGER REFERENCES users(user_id),
    token        VARCHAR(255) NOT NULL,
    expires_at   TIMESTAMP,
    is_used      BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS otp_verification (
    otp_id        SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(user_id),
    otp_code      VARCHAR(10) NOT NULL,
    purpose       VARCHAR(20) CHECK (purpose IN ('registration', 'login', 'reset_password')),
    expires_at    TIMESTAMP,
    is_verified   BOOLEAN DEFAULT FALSE
);

-- optional, if not using stateless JWT
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id    VARCHAR(255) PRIMARY KEY,
    user_id       INTEGER REFERENCES users(user_id),
    token         TEXT,
    ip_address    VARCHAR(45),
    expires_at    TIMESTAMP,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS user_permissions (
    user_permission_id    SERIAL PRIMARY KEY,
    user_id               INTEGER REFERENCES users(user_id),
    permission_id         INTEGER REFERENCES permissions(permission_id),
    is_allowed            BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id_assigned      INTEGER,
    company_id            INTEGER
);


-- =====================================================================
-- SECTION 4: HR & ORGANIZATION MASTERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS branch_mst (
    branch_id     SERIAL PRIMARY KEY,
    branch_name   VARCHAR(100) NOT NULL,
    city_id       INTEGER REFERENCES city_mst(city_id),
    status        VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted    BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id       INTEGER
);

CREATE TABLE IF NOT EXISTS designations (
    designation_id     SERIAL PRIMARY KEY,
    designation_name   VARCHAR(100) NOT NULL,
    department_id      INTEGER REFERENCES departments(department_id),
    status              VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted           BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS shift_master (
    shift_id     SERIAL PRIMARY KEY,
    shift_name   VARCHAR(50) NOT NULL,
    start_time   TIME,
    end_time     TIME,
    status       VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted   BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS holiday_master (
    holiday_id     SERIAL PRIMARY KEY,
    holiday_name   VARCHAR(100) NOT NULL,
    holiday_date   DATE,
    branch_id      INTEGER REFERENCES branch_mst(branch_id),
    status         VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted     BOOLEAN DEFAULT FALSE
);

-- Referenced in "Notes for update master tables" section
CREATE TABLE IF NOT EXISTS cost_centers (
    cost_center_id     SERIAL PRIMARY KEY,
    cost_center_name   VARCHAR(150) NOT NULL,
    department_id      INTEGER REFERENCES departments(department_id),
    status              VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted            BOOLEAN DEFAULT FALSE
);


-- =====================================================================
-- SECTION 5: DOCUMENT NUMBERING
-- =====================================================================

-- optional companion table for document_series.document_type
CREATE TABLE IF NOT EXISTS document_type (
    doc_type_id           SERIAL PRIMARY KEY,
    document_type_name    VARCHAR(50) NOT NULL,          -- e.g. Invoice, PO, Lead
    is_deleted             BOOLEAN DEFAULT FALSE,
    company_id             INTEGER,
    user_id                INTEGER
);

CREATE TABLE IF NOT EXISTS document_series (
    sequence_id          SERIAL PRIMARY KEY,
    document_type_id     INTEGER REFERENCES document_type(doc_type_id),
    prefix               VARCHAR(20),                     -- e.g. INV/, PO/
    postfix              VARCHAR(200),                     -- e.g. /26-27, /27-28
    current_number        INTEGER DEFAULT 0,               -- last used number
    financial_year_id     INTEGER REFERENCES financial_years(financial_year_id),  -- optional, if numbering resets yearly
    padding_length         INTEGER DEFAULT 5,               -- e.g. 5 -> INV/00001/26-27
    status                 VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted              BOOLEAN DEFAULT FALSE,
    company_id              INTEGER,
    user_id                 INTEGER
);


-- =====================================================================
-- SECTION 7: COMPANY PROFILE
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_company_profile (
    company_profile_id     SERIAL PRIMARY KEY,               -- usually just 1 row per company DB
    company_name           VARCHAR(150) NOT NULL,              -- registered legal name
    trade_name             VARCHAR(150),                        -- optional, display/brand name if different
    logo                    VARCHAR(255),                        -- file path/URL
    registration_number      VARCHAR(50),                          -- CIN / company registration no.
    gst_no                    VARCHAR(100),                          -- GSTIN / VAT number
    pan_no                     VARCHAR(100),                          -- India-specific, optional
    phone                       VARCHAR(20),
    email                        VARCHAR(150),
    website                      VARCHAR(150),
    contact_name                  VARCHAR(150),
    address_line1                  VARCHAR(255),
    address_line2                   VARCHAR(255),
    city_id                          INTEGER REFERENCES city_mst(city_id),
    state_id                          INTEGER REFERENCES state_mst(state_id),
    country_id                         INTEGER REFERENCES country_mst(country_id),
    pincode                              VARCHAR(10),
    authorized_signature                  VARCHAR(255),                 -- file path/URL
    currency_id                            INTEGER REFERENCES currency_mst(currency_id),
    financial_year_id                       INTEGER REFERENCES financial_years(financial_year_id),
    is_deleted                                BOOLEAN DEFAULT FALSE,
    created_at                                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    company_id                                   INTEGER
);

CREATE TABLE IF NOT EXISTS tbl_company_bank_detail (
    comp_bank_id           SERIAL PRIMARY KEY,
    company_profile_id     INTEGER REFERENCES tbl_company_profile(company_profile_id),
    bank_id                 INTEGER REFERENCES bank_mst(bank_id),
    account_holder_name      VARCHAR(100),
    account_no                 VARCHAR(100),
    ifsc_code                    VARCHAR(100),
    swift_code                     VARCHAR(100),
    branch_name                     VARCHAR(100),
    upi_no                           VARCHAR(100),
    opening_balance                    DECIMAL(20,2),
    status                              VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted                            BOOLEAN DEFAULT FALSE,
    created_at                             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    company_id                              INTEGER
);


-- =====================================================================
-- SECTION 8: ITEM MASTERS + ITEMS
-- =====================================================================

CREATE TABLE IF NOT EXISTS item_type (
    item_type_id     SERIAL PRIMARY KEY,
    item_type_name   VARCHAR(100) NOT NULL,
    status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted       BOOLEAN DEFAULT FALSE,
    user_id          INTEGER,
    company_id       INTEGER,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_categories (
    category_id            SERIAL PRIMARY KEY,
    category_name          VARCHAR(100) NOT NULL,
    parent_category_id     INTEGER REFERENCES item_categories(category_id),  -- category -> sub-category tree
    status                  VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted                BOOLEAN DEFAULT FALSE,
    user_id                    INTEGER,
    company_id                  INTEGER,
    created_at                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Referenced in "Notes for update master tables" section
CREATE TABLE IF NOT EXISTS item_attributes (
    attribute_id   SERIAL PRIMARY KEY,
    attribute_name VARCHAR(100) NOT NULL,
    status         VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouse_mst (
    warehouse_id     SERIAL PRIMARY KEY,
    warehouse_name   VARCHAR(150) NOT NULL,
    address           TEXT,
    status             VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    is_deleted         BOOLEAN DEFAULT FALSE,
    user_id            INTEGER,
    company_id         INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_items (
    item_id                  SERIAL PRIMARY KEY,
    item_code                VARCHAR(200) UNIQUE,
    item_name                VARCHAR(200) NOT NULL,
    item_description         VARCHAR(255),
    item_specification       VARCHAR(255),                    -- optional
    item_type                INTEGER REFERENCES item_type(item_type_id),
    item_perent_category     INTEGER REFERENCES item_categories(category_id),
    item_category            INTEGER REFERENCES item_categories(category_id),
    hsn_code                 VARCHAR(100),
    unit_id                  INTEGER REFERENCES units_of_measure(unit_id),        -- base unit of measure
    conv_unit_id             INTEGER REFERENCES units_of_measure(unit_id),        -- optional, unit conversion (box -> pcs)
    sales_currency_id        INTEGER REFERENCES currency_mst(currency_id),
    sales_qty                DECIMAL(20,4),
    sales_convert_qty        DECIMAL(20,4),                                          -- optional, unit conversion
    sales_rate               DECIMAL(20,2),
    sales_conv_rate          DECIMAL(20,2),                                    -- optional, unit rate conversion
    purchase_currency_id     INTEGER REFERENCES currency_mst(currency_id),
    purchase_qty             DECIMAL(20,4),
    purchase_convert_qty     DECIMAL(20,4),                                        -- optional
    purchase_rate            DECIMAL(20,2),
    purchase_conv_rate       DECIMAL(20,2),                                  -- optional
    tax_id                   INTEGER REFERENCES tax_types(tax_id),
    status                   VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted               BOOLEAN DEFAULT FALSE,
    user_id                  INTEGER,
    company_id               INTEGER,
    created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- optional: only needed if you add an upload-image option
CREATE TABLE IF NOT EXISTS item_images (
    image_id      SERIAL PRIMARY KEY,
    item_id       INTEGER REFERENCES tbl_items(item_id),
    image_url     VARCHAR(255),
    is_primary    BOOLEAN DEFAULT FALSE,             -- shown as the thumbnail on lists
    sort_order    INTEGER DEFAULT 0,
    is_deleted    BOOLEAN DEFAULT FALSE
);


-- =====================================================================
-- SECTION 9: CRM MASTERS (referenced in "Notes for update master tables")
-- =====================================================================

CREATE TABLE IF NOT EXISTS lead_sources (
    lead_source_id   SERIAL PRIMARY KEY,
    source_name      VARCHAR(100) NOT NULL,
    status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS industries (
    industry_id     SERIAL PRIMARY KEY,
    industry_name   VARCHAR(100) NOT NULL,
    status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS lead_status_master (
    lead_status_id   SERIAL PRIMARY KEY,
    status_name      VARCHAR(50) NOT NULL,
    sort_order       INTEGER DEFAULT 0,
    status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS deal_stages (
    stage_id             SERIAL PRIMARY KEY,
    stage_name           VARCHAR(50) NOT NULL,
    probability_percent  DECIMAL(5,2),
    sort_order           INTEGER DEFAULT 0
);


-- =====================================================================
-- SECTION 10: PARTY (CUSTOMER / VENDOR) MASTER
-- Note: tbl_party covers both customers and vendors via party_type,
-- per the doc's own note that this differs from a split
-- tbl_customer/tbl_vendor design.
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_party (
    party_id                SERIAL PRIMARY KEY,
    party_type              VARCHAR(10) CHECK (party_type IN ('CUSTOMER', 'VENDOR', 'BOTH')),
    party_code              VARCHAR(100) UNIQUE,             -- auto-generated, e.g. CUST-0001, from document_series
    party_name              VARCHAR(200) NOT NULL,
    phone                    VARCHAR(20),
    email                     VARCHAR(150),
    gst_no                     VARCHAR(100),
    pan_no                       VARCHAR(100),
    website                        VARCHAR(100),
    -- address                          VARCHAR(255),
    -- city_id                           INTEGER REFERENCES city_mst(city_id),
    -- state_id                            INTEGER REFERENCES state_mst(state_id),
    -- country_id                            INTEGER REFERENCES country_mst(country_id),
    -- pincode                                 VARCHAR(10),
    notes                                     TEXT,
    opening_balance                             DECIMAL(20,2) DEFAULT 0,
    authorized_signature                          VARCHAR(255),          -- file path/URL
    currency_id                                     INTEGER REFERENCES currency_mst(currency_id),
    financial_year_id                               INTEGER REFERENCES financial_years(financial_year_id),
    status                                            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blacklisted')),
    is_deleted                                          BOOLEAN DEFAULT FALSE,
    user_id                                               INTEGER,
    company_id                                              INTEGER,
    created_at                                                TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_party_contact_person (
    person_id     SERIAL PRIMARY KEY,
    party_id      INTEGER REFERENCES tbl_party(party_id),
    name          VARCHAR(200) NOT NULL,
    phone         VARCHAR(20),
    email         VARCHAR(150),
    is_deleted    BOOLEAN DEFAULT FALSE,
    user_id       INTEGER,
    company_id    INTEGER,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- multiple billing/shipping addresses per party
CREATE TABLE IF NOT EXISTS tbl_party_addresses (
    address_id       SERIAL PRIMARY KEY,
    party_id         INTEGER REFERENCES tbl_party(party_id),
    address_type     VARCHAR(10) CHECK (address_type IN ('billing', 'shipping', 'both')),
    address_label    VARCHAR(50),                     -- e.g. "Main Warehouse", "Head Office"
    attention_to     VARCHAR(100),                      -- contact person at this address
    phone            VARCHAR(20),
    address_line1    VARCHAR(255),
    address_line2    VARCHAR(255),
    city_id          INTEGER REFERENCES city_mst(city_id),
    state_id         INTEGER REFERENCES state_mst(state_id),
    country_id       INTEGER REFERENCES country_mst(country_id),
    pincode          VARCHAR(10),
    is_default       BOOLEAN DEFAULT FALSE,             -- one default per address_type
    status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_deleted       BOOLEAN DEFAULT FALSE,
    user_id          INTEGER,
    company_id       INTEGER,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =====================================================================
-- SECTION 11: SALES INVOICE
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_invoice (
    invoice_id             SERIAL PRIMARY KEY,
    invoice_no              VARCHAR(30) UNIQUE,              -- generated from document_series
    party_id                 INTEGER REFERENCES tbl_party(party_id),   -- customer
    invoice_date               DATE,
    due_date                     DATE,                         -- derived from payment_term_id
    po_no                          VARCHAR(100),
    po_date                          DATE,
    billing_address_id                 INTEGER REFERENCES tbl_party_addresses(address_id),
    shipping_address_id                  INTEGER REFERENCES tbl_party_addresses(address_id),
    payment_term_id                        INTEGER REFERENCES payment_terms(payment_term_id),
    currency_id                              INTEGER REFERENCES currency_mst(currency_id),
    subtotal_amount                            DECIMAL(20,2),      -- before tax/discount
    discount_value                                 DECIMAL(20,2),
    total_tax_amount                                 DECIMAL(20,2),
    shipping_charges                                   DECIMAL(20,2),
    round_off                                            DECIMAL(20,2),
    total_amount                                           DECIMAL(20,2),   -- grand total
    paid_amount                                              DECIMAL(20,2),
    balance_due                                                DECIMAL(20,2),   -- computed
    terms_conditions                                             TEXT,
    notes                                                          TEXT,
    status                                                           VARCHAR(20) DEFAULT 'draft'
                                                                      CHECK (status IN ('draft', 'approved', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled')),
    is_deleted        BOOLEAN DEFAULT FALSE,
    user_id            INTEGER,
    company_id          INTEGER,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_invoice_items (
    invoice_item_id     SERIAL PRIMARY KEY,
    invoice_id           INTEGER REFERENCES tbl_invoice(invoice_id),
    item_id                INTEGER REFERENCES tbl_items(item_id),
    description               VARCHAR(255),               -- overrides item name if needed
    quantity                    DECIMAL(20,4),
    hsn_code                      VARCHAR(255),
    unit_id                         INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                         DECIMAL(20,2),
    total_rate                          DECIMAL(20,2),        -- without tax and discount
    discount_percent                      DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),          -- line-level discount, percentage (e.g. 10%)
    discount_flat                           DECIMAL(20,2),          -- line-level discount, flat value (e.g. 100rs)
    tax_percent                               DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                  DECIMAL(20,2),
    total_amount                                  DECIMAL(20,2),      -- with tax and discount
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- tax breakdown per invoice - needed for GST-style multi-tax invoices
CREATE TABLE IF NOT EXISTS tbl_invoice_tax_details (
    tax_detail_id     SERIAL PRIMARY KEY,
    invoice_id         INTEGER REFERENCES tbl_invoice(invoice_id),
    invoice_item_id      INTEGER REFERENCES tbl_invoice_items(invoice_item_id),
    tax_id                  INTEGER REFERENCES tax_types(tax_id),     -- e.g. CGST, SGST, IGST
    taxable_amount             DECIMAL(20,2),
    tax_percentage               DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                     DECIMAL(20,2),
    is_deleted                       BOOLEAN DEFAULT FALSE
);


-- =====================================================================
-- SECTION 12: PURCHASE INVOICE (vendor bills)
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_purchase_invoices (
    purchase_invoice_id     SERIAL PRIMARY KEY,
    pi_no                     VARCHAR(30) UNIQUE,                    -- generated from document_series
    pi_date                     DATE,
    due_date                      DATE,
    party_id                        INTEGER REFERENCES tbl_party(party_id),   -- vendor
    po_no                              VARCHAR(100),
    po_date                              DATE,
    invoice_date                          DATE,
    billing_address_id                      INTEGER REFERENCES tbl_party_addresses(address_id),
    shipping_address_id                       INTEGER REFERENCES tbl_party_addresses(address_id),
    currency_id                                 INTEGER REFERENCES currency_mst(currency_id),
    subtotal_amount                               DECIMAL(20,2),
    discount_value                                 DECIMAL(20,2),
    total_tax_amount                                DECIMAL(20,2),
    round_off                                        DECIMAL(20,2),
    total_amount                                      DECIMAL(20,2),
    paid_amount                                         DECIMAL(20,2),
    balance_due                                           DECIMAL(20,2),
    terms_conditions                                        TEXT,
    notes                                                     TEXT,
    status       VARCHAR(20) DEFAULT 'draft'
                 CHECK (status IN ('draft', 'approved', 'partially_paid', 'paid', 'overdue', 'disputed')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id         INTEGER,
    company_id       INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_purchase_invoice_items (
    purchase_invoice_item_id     SERIAL PRIMARY KEY,
    purchase_invoice_id           INTEGER REFERENCES tbl_purchase_invoices(purchase_invoice_id),
    item_id                         INTEGER REFERENCES tbl_items(item_id),
    description                       VARCHAR(255),
    quantity                            DECIMAL(20,4),
    hsn_code                              VARCHAR(255),
    unit_id                                 INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                                 DECIMAL(20,2),
    total_rate                                  DECIMAL(20,2),
    discount_percent                              DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_flat                                   DECIMAL(20,2),
    tax_percent                                       DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                          DECIMAL(20,2),
    total_amount                                          DECIMAL(20,2),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_purchase_invoice_tax_details (
    tax_detail_id                SERIAL PRIMARY KEY,
    purchase_invoice_id           INTEGER REFERENCES tbl_purchase_invoices(purchase_invoice_id),
    purchase_invoice_item_id        INTEGER REFERENCES tbl_purchase_invoice_items(purchase_invoice_item_id),
    tax_id                             INTEGER REFERENCES tax_types(tax_id),
    taxable_amount                        DECIMAL(20,2),
    tax_percentage                          DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                                DECIMAL(20,2),
    is_deleted                                  BOOLEAN DEFAULT FALSE
);

-- =====================================================================
-- SECTION 13: CREDIT NOTES (sales returns / reductions)
-- =====================================================================

CREATE TABLE IF NOT EXISTS credit_notes (
    credit_note_id     SERIAL PRIMARY KEY,
    credit_note_no       VARCHAR(30) UNIQUE,                  -- generated from document_series
    credit_date             DATE,
    invoice_id                 INTEGER REFERENCES tbl_invoice(invoice_id),   -- original invoice being adjusted
    party_id                     INTEGER REFERENCES tbl_party(party_id),
    reason_id                      INTEGER REFERENCES cr_dr_reason_mst(reason_id),
    subtotal_amount                 DECIMAL(20,2),
    discount_value                   DECIMAL(20,2),
    total_tax_amount                 DECIMAL(20,2),
    round_off                        DECIMAL(20,2),
    total_amount                     DECIMAL(20,2),
    notes                            TEXT,
    status         VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'applied')),
    is_deleted      BOOLEAN DEFAULT FALSE,
    user_id          INTEGER,
    company_id        INTEGER,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_note_items (
    credit_note_item_id     SERIAL PRIMARY KEY,
    credit_note_id            INTEGER REFERENCES credit_notes(credit_note_id),
    invoice_item_id             INTEGER REFERENCES tbl_invoice_items(invoice_item_id),
    item_id                       INTEGER REFERENCES tbl_items(item_id),
    description                     VARCHAR(255),
    quantity                          DECIMAL(20,4),
    hsn_code                            VARCHAR(255),
    unit_id                               INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                               DECIMAL(20,2),
    total_rate                                DECIMAL(20,2),
    discount_percent                            DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_flat                                 DECIMAL(20,2),
    tax_percent                                     DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                        DECIMAL(20,2),
    total_amount                                        DECIMAL(20,2),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_note_tax_details (
    tax_detail_id         SERIAL PRIMARY KEY,
    credit_note_id           INTEGER REFERENCES credit_notes(credit_note_id),
    credit_note_item_id         INTEGER REFERENCES credit_note_items(credit_note_item_id),
    tax_id                         INTEGER REFERENCES tax_types(tax_id),
    taxable_amount                    DECIMAL(20,2),
    tax_percentage                       DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                             DECIMAL(20,2),
    is_deleted                                BOOLEAN DEFAULT FALSE
);


-- =====================================================================
-- SECTION 14: DEBIT NOTES (purchase returns / vendor billing corrections)
-- =====================================================================

CREATE TABLE IF NOT EXISTS debit_notes (
    debit_note_id         SERIAL PRIMARY KEY,
    debit_note_no            VARCHAR(30) UNIQUE,               -- generated from document_series
    debit_date                  DATE,
    purchase_invoice_id            INTEGER REFERENCES tbl_purchase_invoices(purchase_invoice_id),  -- original invoice being adjusted
    party_id                          INTEGER REFERENCES tbl_party(party_id),
    reason_id                            INTEGER REFERENCES cr_dr_reason_mst(reason_id),
    subtotal_amount                               DECIMAL(20,2),
    discount_value                                 DECIMAL(20,2),
    total_tax_amount                                DECIMAL(20,2),
    round_off                                        DECIMAL(20,2),
    total_amount                                      DECIMAL(20,2),
    notes                                           TEXT,
    status         VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'applied')),
    is_deleted      BOOLEAN DEFAULT FALSE,
    user_id          INTEGER,
    company_id        INTEGER,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS debit_note_items (
    debit_note_item_id         SERIAL PRIMARY KEY,
    debit_note_id                 INTEGER REFERENCES debit_notes(debit_note_id),
    description                      VARCHAR(255),
    purchase_invoice_item_id           INTEGER REFERENCES tbl_purchase_invoice_items(purchase_invoice_item_id),
    item_id                               INTEGER REFERENCES tbl_items(item_id),
    quantity                                 DECIMAL(20,4),
    hsn_code                                   VARCHAR(255),
    unit_id                                      INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                                      DECIMAL(20,2),
    total_rate                                       DECIMAL(20,2),
    discount_percent                                   DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_flat                                        DECIMAL(20,2),
    tax_percent                                            DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                               DECIMAL(20,2),
    total_amount                                               DECIMAL(20,2),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS debit_note_tax_details (
    tax_detail_id         SERIAL PRIMARY KEY,
    debit_note_id             INTEGER REFERENCES debit_notes(debit_note_id),
    debit_note_item_id           INTEGER REFERENCES debit_note_items(debit_note_item_id),
    tax_id                          INTEGER REFERENCES tax_types(tax_id),
    taxable_amount                      DECIMAL(20,2),
    tax_percentage                         DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                                DECIMAL(20,2),
    is_deleted                                  BOOLEAN DEFAULT FALSE
);

-- =====================================================================
-- SECTION: SALES ORDERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_sales_order (
    sales_order_id     SERIAL PRIMARY KEY,
    sales_order_no          VARCHAR(30) UNIQUE,                -- generated from document_series
    sales_order_date        DATE,
    expected_delivery_date  DATE,
    party_id                INTEGER REFERENCES tbl_party(party_id),   -- customer
    billing_address_id      INTEGER REFERENCES tbl_party_addresses(address_id),
    shipping_address_id     INTEGER REFERENCES tbl_party_addresses(address_id),
    currency_id             INTEGER REFERENCES currency_mst(currency_id),
    quotation_id            INTEGER,
    quotation_no            VARCHAR(30),
    customer_po_no          VARCHAR(100),
    customer_po_date        DATE,
    subtotal_amount         DECIMAL(20,2),
    discount_value          DECIMAL(20,2),
    total_tax_amount        DECIMAL(20,2),
    shipping_charges        DECIMAL(20,2),
    round_off               DECIMAL(20,2),
    total_amount            DECIMAL(20,2),
    paid_amount            DECIMAL(20,2),
    balance_due            DECIMAL(20,2),
    payment_term_id        INTEGER REFERENCES payment_terms(payment_term_id),
    terms_conditions       TEXT,
    notes                  TEXT,
    status       VARCHAR(20) DEFAULT 'draft'
                 CHECK (status IN ('draft','approved','confirmed','processing','partially_delivered','delivered','closed','cancelled','rejected')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id         INTEGER,
    company_id       INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_sales_order_items (
    sales_order_item_id     SERIAL PRIMARY KEY,
    sales_order_id             INTEGER REFERENCES tbl_sales_order(sales_order_id),
    item_id                          INTEGER REFERENCES tbl_items(item_id),
    description                        VARCHAR(255),
    quantity                             DECIMAL(20,4),
    hsn_code                               VARCHAR(255),
    unit_id                                  INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                                  DECIMAL(20,2),
    total_rate                                   DECIMAL(20,2),
    discount_percent                               DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_flat                                    DECIMAL(20,2),
    tax_percent                                        DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                           DECIMAL(20,2),
    total_amount                                           DECIMAL(20,2),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_sales_order_tax_details (
    tax_detail_id             SERIAL PRIMARY KEY,
    sales_order_id            INTEGER REFERENCES tbl_sales_order(sales_order_id),
    sales_order_item_id           INTEGER REFERENCES tbl_sales_order_items(sales_order_item_id),
    tax_id                               INTEGER REFERENCES tax_types(tax_id),
    taxable_amount                          DECIMAL(20,2),
    tax_percentage                             DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                                    DECIMAL(20,2),
    is_deleted                                       BOOLEAN DEFAULT FALSE
);




-- =====================================================================
-- SECTION 15: PURCHASE ORDERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_purchase_orders (
    purchase_order_id     SERIAL PRIMARY KEY,
    purchase_order_no        VARCHAR(30) UNIQUE,                -- generated from document_series
    purchase_order_date         DATE,
    due_date                      DATE,
    party_id                         INTEGER REFERENCES tbl_party(party_id),   -- vendor
    billing_address_id                  INTEGER REFERENCES tbl_party_addresses(address_id),
    shipping_address_id                   INTEGER REFERENCES tbl_party_addresses(address_id),
    currency_id                             INTEGER REFERENCES currency_mst(currency_id),
    subtotal_amount                           DECIMAL(20,2),
    discount_value                              DECIMAL(20,2),
    total_tax_amount                            DECIMAL(20,2),
    shipping_charges                              DECIMAL(20,2),
    round_off                                     DECIMAL(20,2),
    total_amount                                  DECIMAL(20,2),
    paid_amount                                     DECIMAL(20,2),
    balance_due                                       DECIMAL(20,2),
    payment_term_id                                     INTEGER REFERENCES payment_terms(payment_term_id),
    terms_conditions                                       TEXT,
    notes                                                    TEXT,
    status       VARCHAR(20) DEFAULT 'draft'
                 CHECK (status IN ('draft', 'approved', 'sent', 'confirmed', 'processing', 'partially_received', 'received', 'closed', 'cancelled', 'rejected')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id         INTEGER,
    company_id       INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_purchase_order_items (
    purchase_order_item_id     SERIAL PRIMARY KEY,
    purchase_order_id             INTEGER REFERENCES tbl_purchase_orders(purchase_order_id),
    item_id                          INTEGER REFERENCES tbl_items(item_id),
    description                        VARCHAR(255),
    quantity                             DECIMAL(20,4),
    hsn_code                               VARCHAR(255),
    unit_id                                  INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                                  DECIMAL(20,2),
    total_rate                                   DECIMAL(20,2),
    discount_percent                               DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_flat                                    DECIMAL(20,2),
    tax_percent                                        DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                           DECIMAL(20,2),
    total_amount                                           DECIMAL(20,2),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_purchase_order_tax_details (
    tax_detail_id             SERIAL PRIMARY KEY,
    purchase_order_id            INTEGER REFERENCES tbl_purchase_orders(purchase_order_id),
    purchase_order_item_id           INTEGER REFERENCES tbl_purchase_order_items(purchase_order_item_id),
    tax_id                               INTEGER REFERENCES tax_types(tax_id),
    taxable_amount                          DECIMAL(20,2),
    tax_percentage                             DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                                    DECIMAL(20,2),
    is_deleted                                       BOOLEAN DEFAULT FALSE
);


-- =====================================================================
-- SECTION 16: QUOTATIONS
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_quotation (
    quotation_id     SERIAL PRIMARY KEY,
    quotation_no        VARCHAR(30) UNIQUE,                -- generated from document_series
    quotation_date         DATE,
    valid_until               DATE,
    party_id                    INTEGER REFERENCES tbl_party(party_id),
    billing_address_id             INTEGER REFERENCES tbl_party_addresses(address_id),
    shipping_address_id               INTEGER REFERENCES tbl_party_addresses(address_id),
    currency_id                          INTEGER REFERENCES currency_mst(currency_id),
    subtotal_amount                         DECIMAL(20,2),
    discount_value                                 DECIMAL(20,2),
    total_tax_amount                           DECIMAL(20,2),
    round_off                                            DECIMAL(20,2),
    total_amount                                  DECIMAL(20,2),
    terms_conditions                                 TEXT,
    notes                                              TEXT,
    status       VARCHAR(20) DEFAULT 'draft'
                 CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'revised')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id         INTEGER,
    company_id       INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_quotation_items (
    quotation_item_id     SERIAL PRIMARY KEY,
    quotation_id              INTEGER REFERENCES tbl_quotation(quotation_id),
    item_id                      INTEGER REFERENCES tbl_items(item_id),
    description                     VARCHAR(255),
    quantity                          DECIMAL(20,4),
    hsn_code                            VARCHAR(255),
    unit_id                                INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                                DECIMAL(20,2),
    total_rate                                 DECIMAL(20,2),
    discount_percent                             DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_flat                                  DECIMAL(20,2),
    tax_percent                                      DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                         DECIMAL(20,2),
    total_amount                                         DECIMAL(20,2),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_quotation_tax_details (
    tax_detail_id       SERIAL PRIMARY KEY,
    quotation_id            INTEGER REFERENCES tbl_quotation(quotation_id),
    quotation_item_id           INTEGER REFERENCES tbl_quotation_items(quotation_item_id),
    tax_id                          INTEGER REFERENCES tax_types(tax_id),
    taxable_amount                      DECIMAL(20,2),
    tax_percentage                         DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                                DECIMAL(20,2),
    is_deleted                                   BOOLEAN DEFAULT FALSE
);


-- =====================================================================
-- SECTION 17: PROFORMA INVOICES
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_proforma (
    proforma_id     SERIAL PRIMARY KEY,
    proforma_no        VARCHAR(30) UNIQUE,                 -- generated from document_series
    proforma_date          DATE,
    valid_until               DATE,
    party_id                    INTEGER REFERENCES tbl_party(party_id),
    billing_address_id             INTEGER REFERENCES tbl_party_addresses(address_id),
    shipping_address_id               INTEGER REFERENCES tbl_party_addresses(address_id),
    currency_id                          INTEGER REFERENCES currency_mst(currency_id),
    subtotal_amount                         DECIMAL(20,2),
    discount_value                                 DECIMAL(20,2),
    total_tax_amount                           DECIMAL(20,2),
    round_off                                            DECIMAL(20,2),
    total_amount                                  DECIMAL(20,2),
    terms_conditions                                 TEXT,
    notes                                              TEXT,
    status       VARCHAR(20) DEFAULT 'draft'
                 CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'revised')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id         INTEGER,
    company_id       INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_proforma_items (
    proforma_item_id     SERIAL PRIMARY KEY,
    proforma_id              INTEGER REFERENCES tbl_proforma(proforma_id),
    item_id                     INTEGER REFERENCES tbl_items(item_id),
    description                    VARCHAR(255),
    quantity                         DECIMAL(20,4),
    hsn_code                           VARCHAR(255),
    unit_id                               INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                               DECIMAL(20,2),
    total_rate                                DECIMAL(20,2),
    discount_percent                            DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_flat                                 DECIMAL(20,2),
    tax_percent                                     DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                        DECIMAL(20,2),
    total_amount                                        DECIMAL(20,2),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_proforma_tax_details (
    tax_detail_id       SERIAL PRIMARY KEY,
    proforma_id             INTEGER REFERENCES tbl_proforma(proforma_id),
    proforma_item_id           INTEGER REFERENCES tbl_proforma_items(proforma_item_id),
    tax_id                         INTEGER REFERENCES tax_types(tax_id),
    taxable_amount                     DECIMAL(20,2),
    tax_percentage                        DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                               DECIMAL(20,2),
    is_deleted                                  BOOLEAN DEFAULT FALSE
);


-- =====================================================================
-- SECTION 18: DELIVERY CHALLAN
-- =====================================================================

CREATE TABLE IF NOT EXISTS tbl_delivery_challan (
    delivery_challan_id     SERIAL PRIMARY KEY,
    delivery_challan_no        VARCHAR(30) UNIQUE,               -- generated from document_series
    delivery_date                DATE,
    expected_delivery_date           DATE,
    party_id                            INTEGER REFERENCES tbl_party(party_id),
    billing_address_id                     INTEGER REFERENCES tbl_party_addresses(address_id),
    shipping_address_id                       INTEGER REFERENCES tbl_party_addresses(address_id),
    currency_id                                  INTEGER REFERENCES currency_mst(currency_id),
    subtotal_amount                                 DECIMAL(20,2),
    discount_value                                 DECIMAL(20,2),
    total_tax_amount                                   DECIMAL(20,2),
    round_off                                            DECIMAL(20,2),
    total_amount                                          DECIMAL(20,2),
    terms_conditions                                         TEXT,
    notes                                                      TEXT,
    status       VARCHAR(20) DEFAULT 'draft'
                 CHECK (status IN ('draft', 'issued', 'partially_delivered', 'delivered', 'closed', 'cancelled')),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id         INTEGER,
    company_id       INTEGER,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_delivery_challan_items (
    delivery_challan_item_id     SERIAL PRIMARY KEY,
    delivery_challan_id             INTEGER REFERENCES tbl_delivery_challan(delivery_challan_id),
    item_id                            INTEGER REFERENCES tbl_items(item_id),
    description                          VARCHAR(255),
    quantity                               DECIMAL(20,4),
    hsn_code                                 VARCHAR(255),
    unit_id                                    INTEGER REFERENCES units_of_measure(unit_id),
    unit_rate                                    DECIMAL(20,2),
    total_rate                                     DECIMAL(20,2),
    discount_percent                                 DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_flat                                      DECIMAL(20,2),
    tax_percent                                          DECIMAL(20,2) CHECK (tax_percent >= 0 AND tax_percent <= 100),
    tax_amount                                             DECIMAL(20,2),
    total_amount                                             DECIMAL(20,2),
    is_deleted     BOOLEAN DEFAULT FALSE,
    user_id        INTEGER,
    company_id     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_delivery_challan_tax_details (
    tax_detail_id             SERIAL PRIMARY KEY,
    delivery_challan_id          INTEGER REFERENCES tbl_delivery_challan(delivery_challan_id),
    delivery_challan_item_id        INTEGER REFERENCES tbl_delivery_challan_items(delivery_challan_item_id),
    tax_id                              INTEGER REFERENCES tax_types(tax_id),
    taxable_amount                         DECIMAL(20,2),
    tax_percentage                            DECIMAL(5,2) CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    tax_amount                                   DECIMAL(20,2),
    is_deleted                                      BOOLEAN DEFAULT FALSE
);


-- =====================================================================
-- INDEXES - the columns you'll filter/join on constantly
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name, table_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_audit_user ON login_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_login_audit_company ON login_audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_login_audit_time ON login_audit_logs(login_time DESC);

CREATE INDEX IF NOT EXISTS idx_tbl_party_type ON tbl_party(party_type);
CREATE INDEX IF NOT EXISTS idx_tbl_party_addresses_party ON tbl_party_addresses(party_id);
CREATE INDEX IF NOT EXISTS idx_tbl_items_category ON tbl_items(item_category);

CREATE INDEX IF NOT EXISTS idx_invoice_party ON tbl_invoice(party_id);
CREATE INDEX IF NOT EXISTS idx_invoice_status ON tbl_invoice(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON tbl_invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_purchase_invoice_party ON tbl_purchase_invoices(party_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_pi ON tbl_purchase_invoice_items(purchase_invoice_id);

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_pi ON debit_notes(purchase_invoice_id);

CREATE INDEX IF NOT EXISTS idx_so_party ON tbl_sales_order(party_id);
CREATE INDEX IF NOT EXISTS idx_po_party ON tbl_purchase_orders(party_id);
CREATE INDEX IF NOT EXISTS idx_quotation_party ON tbl_quotation(party_id);
CREATE INDEX IF NOT EXISTS idx_proforma_party ON tbl_proforma(party_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_party ON tbl_delivery_challan(party_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_current_fy ON financial_years (is_current) WHERE is_current = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_name_company ON permissions (permission_name, company_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_permission ON user_permissions(permission_id);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_unique ON users (email) WHERE is_deleted = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_active_unique ON users (phone) WHERE is_deleted = FALSE;