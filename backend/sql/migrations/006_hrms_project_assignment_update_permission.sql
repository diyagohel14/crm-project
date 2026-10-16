-- MIGRATION 006: allow authorized HRMS users to close project assignments.
-- Safe to re-run for existing tenant databases.

DO $$
DECLARE
    cid INTEGER;
    rid INTEGER;
    pid INTEGER;
BEGIN
    SELECT company_id INTO cid
    FROM tbl_company_profile
    ORDER BY company_profile_id
    LIMIT 1;
    IF cid IS NULL THEN
        RAISE EXCEPTION 'tbl_company_profile is empty - cannot determine company_id';
    END IF;

    SELECT permission_id INTO pid
    FROM permissions
    WHERE permission_name = 'hrms_project_assignment:update' AND company_id = cid;
    IF pid IS NULL THEN
        INSERT INTO permissions (permission_name, module_name, status, company_id)
        VALUES ('hrms_project_assignment:update', 'HRMS', TRUE, cid)
        RETURNING permission_id INTO pid;
    END IF;

    FOR rid IN
        SELECT role_id FROM roles
        WHERE role_name = 'Super Admin' AND company_id = cid AND is_deleted = FALSE
    LOOP
        INSERT INTO role_permissions (role_id, permission_id, is_allowed, company_id)
        SELECT rid, pid, TRUE, cid
        WHERE NOT EXISTS (
            SELECT 1 FROM role_permissions
            WHERE role_id = rid AND permission_id = pid AND company_id = cid
        );
    END LOOP;
END $$;
