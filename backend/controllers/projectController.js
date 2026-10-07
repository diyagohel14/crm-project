// controllers/projectController.js
//
// Central "Project" module tying together the flow:
//   Customer -> Quotation -> Sales Order -> PROJECT -> BOQ -> Procurement
//   -> Site Execution (Tasks/DPR) -> Billing (Invoice) -> Payment -> Closure
//
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule, num, round2 } from "../services/commonService.js";

/// status update flow (mirrors the doc's project lifecycle)
const ALLOWED_STATUS_TRANSITIONS = {
    planning: ["approved", "cancelled"],
    approved: ["in_progress", "cancelled"],
    in_progress: ["on_hold", "delayed", "completed", "cancelled"],
    on_hold: ["in_progress", "cancelled"],
    delayed: ["in_progress", "completed", "cancelled"],
    completed: ["closed"],
    closed: [],
    cancelled: [],
};

function isValidStatusTransition(currentStatus, newStatus) {
    return ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

export function validatePositiveId(value, fieldName = "id") {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw Object.assign(new Error(`${fieldName} must be a positive integer`), { status: 400 });
    }
    return parsed;
}

export function validatePercentage(value, fieldName = "progress_percent") {
    const numeric = num(value, NaN);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
        throw Object.assign(new Error(`${fieldName} must be between 0 and 100`), { status: 400 });
    }
    return round2(numeric);
}

export function validateProjectStatusTransition(currentStatus, newStatus) {
    return isValidStatusTransition(String(currentStatus || "").trim().toLowerCase(), String(newStatus || "").trim().toLowerCase());
}

export async function ensureProjectExists(client, projectId, companyId) {
    const validatedProjectId = validatePositiveId(projectId, "projectId");
    const result = await client.query(
        `SELECT project_id, project_name, status FROM tbl_project
         WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [validatedProjectId, companyId]
    );

    if (result.rows.length === 0) {
        throw Object.assign(new Error("Project not found"), { status: 404 });
    }

    return result.rows[0];
}

export function validateProjectPayload(payload = {}, { requireProjectName = true, requirePartyId = true } = {}) {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
    const validated = { ...source };

    if (requireProjectName) {
        const projectName = String(validated.project_name ?? "").trim();
        if (!projectName) {
            throw Object.assign(new Error("project_name is required"), { status: 400 });
        }
        validated.project_name = projectName;
    } else if (validated.project_name !== undefined && validated.project_name !== null && String(validated.project_name).trim() !== "") {
        validated.project_name = String(validated.project_name).trim();
    }

    if (requirePartyId) {
        if (validated.party_id === undefined || validated.party_id === null || String(validated.party_id).trim() === "") {
            throw Object.assign(new Error("party_id is required"), { status: 400 });
        }
        validated.party_id = validatePositiveId(validated.party_id, "party_id");
    }

    const allowedProjectTypes = ["electrical", "mechanical", "mep", "plumbing", "piping", "hvac", "fabrication", "installation", "erection", "commissioning", "maintenance", "turnkey", "other"];
    if (validated.project_type !== undefined && validated.project_type !== null && String(validated.project_type).trim() !== "") {
        const normalizedType = String(validated.project_type).trim().toLowerCase();
        if (!allowedProjectTypes.includes(normalizedType)) {
            throw Object.assign(new Error(`Invalid project_type: ${validated.project_type}`), { status: 400 });
        }
        validated.project_type = normalizedType;
    }

    const allowedStatuses = ["planning", "approved", "in_progress", "on_hold", "delayed", "completed", "closed", "cancelled"];
    if (validated.status !== undefined && validated.status !== null && String(validated.status).trim() !== "") {
        const normalizedStatus = String(validated.status).trim().toLowerCase();
        if (!allowedStatuses.includes(normalizedStatus)) {
            throw Object.assign(new Error(`Invalid project status: ${validated.status}`), { status: 400 });
        }
        validated.status = normalizedStatus;
    }

    const numericFields = {
        contract_value: "contract_value",
        estimated_cost: "estimated_cost",
        actual_cost: "actual_cost",
        progress_percent: "progress_percent",
    };

    for (const [key, label] of Object.entries(numericFields)) {
        if (validated[key] === undefined || validated[key] === null || String(validated[key]).trim() === "") continue;
        const numericValue = Number(validated[key]);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            throw Object.assign(new Error(`${label} must be a non-negative number`), { status: 400 });
        }
        if (key === "progress_percent") {
            validated[key] = validatePercentage(numericValue, label);
        } else {
            validated[key] = round2(numericValue);
        }
    }

    if (validated.quotation_id !== undefined && validated.quotation_id !== null && String(validated.quotation_id).trim() !== "") {
        validated.quotation_id = validatePositiveId(validated.quotation_id, "quotation_id");
    }
    if (validated.sales_order_id !== undefined && validated.sales_order_id !== null && String(validated.sales_order_id).trim() !== "") {
        validated.sales_order_id = validatePositiveId(validated.sales_order_id, "sales_order_id");
    }
    if (validated.project_manager_id !== undefined && validated.project_manager_id !== null && String(validated.project_manager_id).trim() !== "") {
        validated.project_manager_id = validatePositiveId(validated.project_manager_id, "project_manager_id");
    }
    if (validated.project_engineer_id !== undefined && validated.project_engineer_id !== null && String(validated.project_engineer_id).trim() !== "") {
        validated.project_engineer_id = validatePositiveId(validated.project_engineer_id, "project_engineer_id");
    }
    if (validated.currency_id !== undefined && validated.currency_id !== null && String(validated.currency_id).trim() !== "") {
        validated.currency_id = validatePositiveId(validated.currency_id, "currency_id");
    }

    return validated;
}

const PROJECT_DETAIL_SUBQUERIES = `
    COALESCE(
        (SELECT json_agg(sites) FROM tbl_project_sites AS sites
         WHERE sites.project_id = p.project_id AND sites.is_deleted = FALSE),
        '[]'::json
    ) AS "sites",
    COALESCE(
        (SELECT json_agg(boq) FROM tbl_project_boq_items AS boq
         WHERE boq.project_id = p.project_id AND boq.is_deleted = FALSE),
        '[]'::json
    ) AS "boqItems",
    COALESCE(
        (SELECT json_agg(costs) FROM tbl_project_costs AS costs
         WHERE costs.project_id = p.project_id AND costs.is_deleted = FALSE),
        '[]'::json
    ) AS "costBudget",
    COALESCE(
        (SELECT json_agg(m ORDER BY m.sort_order ASC) FROM tbl_project_milestones AS m
         WHERE m.project_id = p.project_id AND m.is_deleted = FALSE),
        '[]'::json
    ) AS "milestones",
    COALESCE(
        (SELECT json_agg(t) FROM tbl_project_tasks AS t
         WHERE t.project_id = p.project_id AND t.is_deleted = FALSE),
        '[]'::json
    ) AS "tasks",
    COALESCE(
        (SELECT json_agg(doc) FROM tbl_project_documents AS doc
         WHERE doc.project_id = p.project_id AND doc.is_deleted = FALSE),
        '[]'::json
    ) AS "projDoc"
`;

/////////////////////////// Project Module Start /////////////////////////////

export async function getProjects(req, res) {
    const { companyId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    let result;

    try {
        if (projectId) {
            const normalizedProjectId = validatePositiveId(projectId, "projectId");
            const query = `SELECT p.*, ${PROJECT_DETAIL_SUBQUERIES}
            FROM tbl_project AS p
            WHERE p.project_id = $1 AND p.company_id = $2 AND p.is_deleted = FALSE`;
            result = await companyPool.query(query, [normalizedProjectId, companyId]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Project not found" });
            }
        } else {
            const { status, partyId } = req.query;
            const conditions = ["p.company_id = $1", "p.is_deleted = FALSE"];
            const params = [companyId];

            if (status) {
                const normalizedStatus = String(status).trim().toLowerCase();
                if (!["planning", "approved", "in_progress", "on_hold", "delayed", "completed", "closed", "cancelled"].includes(normalizedStatus)) {
                    return res.status(400).json({ success: false, error: `Invalid project status: ${status}` });
                }
                params.push(normalizedStatus);
                conditions.push(`p.status = $${params.length}`);
            }
            if (partyId) {
                params.push(validatePositiveId(partyId, "partyId"));
                conditions.push(`p.party_id = $${params.length}`);
            }

            const query = `SELECT p.*, ${PROJECT_DETAIL_SUBQUERIES}
            FROM tbl_project AS p
            WHERE ${conditions.join(" AND ")}
            ORDER BY p.project_id DESC`;
            result = await companyPool.query(query, params);
        }

        return res.status(200).json({ message: "Project Fetch Successfully", Projects: result.rows });

    } catch (err) {
        console.error("[getProjects]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to fetch Project List", details: err.message });
    }
}

/** Shared insert logic for BOQ items / milestones / tasks / cost budget rows on create. */
async function insertProjectChildren(client, projectId, userId, companyId, payload) {
    const insertedBoq = [];
    if (Array.isArray(payload.boqItems)) {
        const sql = `INSERT INTO tbl_project_boq_items (
            project_id, boq_type, item_id, description, quantity, unit_id, unit_rate, total_amount, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
        for (const it of payload.boqItems) {
            const quantity = num(it.quantity);
            const unitRate = num(it.unit_rate);
            const totalAmount = round2(quantity * unitRate);
            const r = await client.query(sql, [
                projectId, it.boq_type || "material", it.item_id || null, it.description || null,
                quantity, it.unit_id || null, unitRate, totalAmount, userId, companyId,
            ]);
            insertedBoq.push(r.rows[0]);
        }
    }

    const insertedCosts = [];
    if (Array.isArray(payload.costBudget)) {
        const sql = `INSERT INTO tbl_project_costs (
            project_id, category, budget_amount, actual_amount, remarks, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;
        for (const c of payload.costBudget) {
            const r = await client.query(sql, [
                projectId, c.category, num(c.budget_amount), num(c.actual_amount), c.remarks || null, userId, companyId,
            ]);
            insertedCosts.push(r.rows[0]);
        }
    }

    const insertedMilestones = [];
    if (Array.isArray(payload.milestones)) {
        const sql = `INSERT INTO tbl_project_milestones (
            project_id, milestone_name, due_date, payment_percent, payment_amount, sort_order, status, remarks, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
        let sortOrder = 0;
        for (const m of payload.milestones) {
            const r = await client.query(sql, [
                projectId, m.milestone_name, m.due_date || null, num(m.payment_percent), num(m.payment_amount),
                m.sort_order ?? sortOrder++, m.status || "pending", m.remarks || null, userId, companyId,
            ]);
            insertedMilestones.push(r.rows[0]);
        }
    }

    return { insertedBoq, insertedCosts, insertedMilestones };
}

export async function createProject(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = validateProjectPayload(req.body || {});

        await client.query("BEGIN");

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.PROJECT,
            companyId,
            userId,
            financialYearId,
            client,
        });
        const projectCode = seriesResult.series;

        const soRes = await client.query(
            `SELECT * FROM tbl_sales_order WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [payload.sales_order_id, companyId]
        );
        if (soRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Sales Order not found" });
        }
        const salesOrder = soRes.rows[0];

        if (salesOrder.project_id) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: "A project already exists for this Sales Order", project_id: salesOrder.project_id });
        }
        if (!["approved", "confirmed"].includes(String(salesOrder.status || "").toLowerCase())) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Sales Order must be approved/confirmed before creating a project (current status: '${salesOrder.status}')` });
        }

        if (payload.quotation_id !== undefined && payload.quotation_id !== null && String(payload.quotation_id).trim() !== "") {
            if(payload.quotation_id !== soRes.rows[0].quotation_id){
                await client.query("ROLLBACK");
                return res.status(400).json({ success: false, message: `Selected Quotation are not match with SalesOrder's Quotation` })
            }
        }

        const insertProjectSql = `INSERT INTO tbl_project (
            project_code, project_name, party_id, quotation_id, sales_order_id,
            contract_no, customer_po_no, customer_po_date, project_type, project_location,
            site_address, project_manager_id, project_engineer_id, start_date, planned_end_date,
            currency_id, contract_value, estimated_cost, description, terms_conditions, notes,
            status, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        RETURNING *`;

        const params = [
            projectCode,
            payload.project_name,
            payload.party_id,
            payload.quotation_id ?? null,
            payload.sales_order_id ?? null,
            payload.contract_no || null,
            payload.customer_po_no || null,
            payload.customer_po_date || null,
            payload.project_type || "other",
            payload.project_location || null,
            payload.site_address || null,
            payload.project_manager_id ?? null,
            payload.project_engineer_id ?? null,
            payload.start_date || null,
            payload.planned_end_date || null,
            payload.currency_id ?? null,
            payload.contract_value ?? 0,
            payload.estimated_cost ?? 0,
            payload.description || null,
            payload.terms_conditions || null,
            payload.notes || null,
            payload.status || "planning",
            userId,
            companyId,
        ];

        const projectRes = await client.query(insertProjectSql, params);
        const project = projectRes.rows[0];

        const { insertedBoq, insertedCosts, insertedMilestones } =
            await insertProjectChildren(client, project.project_id, userId, companyId, payload);

        // Keep the originating sales order pointed back at this project.
        if (payload.sales_order_id) {
            await client.query(
                `UPDATE tbl_sales_order SET project_id = $1 WHERE sales_order_id = $2 AND company_id = $3 AND is_deleted = FALSE`,
                [project.project_id, payload.sales_order_id, companyId]
            );
        }

        await logAudit(client, {
            module_name: "Project",
            page_name: "Create Project",
            table_name: "tbl_project",
            table_id: project.project_id,
            action_type: "CREATE",
            action_description: `Project Created Successfully :${projectCode}`,
            new_value: JSON.stringify(project),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Project created",
            Projects: project,
            boqItems: insertedBoq,
            costBudget: insertedCosts,
            milestones: insertedMilestones,
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createProject]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Project", details: err.message });

    } finally {
        client.release();
    }
}

/**
 * Converts an approved/confirmed Sales Order directly into a Project,
 * copying party + PO reference + sales order line items into the BOQ.
 * This is the concrete "Sales Order -> Project" step from the flow.
 */
export async function createProjectFromSalesOrder(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.user;
    const { salesOrderId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = validateProjectPayload(req.body || {}, { requireProjectName: false, requirePartyId: false });
        const validatedSalesOrderId = validatePositiveId(salesOrderId, "salesOrderId");

        await client.query("BEGIN");

        const soRes = await client.query(
            `SELECT * FROM tbl_sales_order WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [validatedSalesOrderId, companyId]
        );
        if (soRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Sales Order not found" });
        }
        const salesOrder = soRes.rows[0];

        if (salesOrder.project_id) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: "A project already exists for this Sales Order", project_id: salesOrder.project_id });
        }
        if (!["approved", "confirmed"].includes(String(salesOrder.status || "").toLowerCase())) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Sales Order must be approved/confirmed before creating a project (current status: '${salesOrder.status}')` });
        }

        const itemsRes = await client.query(
            `SELECT * FROM tbl_sales_order_items WHERE sales_order_id = $1 AND is_deleted = FALSE`,
            [salesOrderId]
        );

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.PROJECT,
            companyId,
            userId,
            financialYearId,
            client,
        });
        const projectCode = seriesResult.series;

        const insertProjectSql = `INSERT INTO tbl_project (
            project_code, project_name, party_id, quotation_id, sales_order_id,
            contract_no, customer_po_no, customer_po_date, project_type, project_location,
            site_address, project_manager_id, project_engineer_id, start_date, planned_end_date,
            currency_id, contract_value, estimated_cost, description, notes, status, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        RETURNING *`;

        const projectParams = [
            projectCode,
            payload.project_name || `Project for ${salesOrder.sales_order_no}`,
            salesOrder.party_id,
            salesOrder.quotation_id || null,
            salesOrder.sales_order_id,
            payload.contract_no || null,
            salesOrder.customer_po_no || null,
            salesOrder.customer_po_date || null,
            payload.project_type || "other",
            payload.project_location || null,
            payload.site_address || null,
            payload.project_manager_id ?? null,
            payload.project_engineer_id ?? null,
            payload.start_date || null,
            payload.planned_end_date || null,
            salesOrder.currency_id || null,
            num(salesOrder.total_amount),
            payload.estimated_cost ?? 0,
            payload.description || null,
            payload.notes || null,
            "planning",
            userId,
            companyId,
        ];

        const projectRes = await client.query(insertProjectSql, projectParams);
        const project = projectRes.rows[0];

        const boqInsertSql = `INSERT INTO tbl_project_boq_items (
            project_id, boq_type, item_id, description, quantity, unit_id, unit_rate, total_amount, user_id, company_id
        ) VALUES ($1,'material',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
        const boqItems = [];
        for (const it of itemsRes.rows) {
            const r = await client.query(boqInsertSql, [
                project.project_id, it.item_id, it.description, it.quantity, it.unit_id,
                it.unit_rate, it.total_amount, userId, companyId,
            ]);
            boqItems.push(r.rows[0]);
        }

        await client.query(
            `UPDATE tbl_sales_order SET project_id = $1, updated_at = CURRENT_TIMESTAMP WHERE sales_order_id = $2 AND company_id = $3`,
            [project.project_id, salesOrderId, companyId]
        );

        await logAudit(client, {
            module_name: "Project",
            page_name: "Create Project From Sales Order",
            table_name: "tbl_project",
            table_id: project.project_id,
            action_type: "CREATE",
            action_description: `Project ${projectCode} created from Sales Order ${salesOrder.sales_order_no}`,
            new_value: JSON.stringify(project),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Project created from Sales Order",
            Projects: project,
            boqItems,
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createProjectFromSalesOrder]", err);
        return res.status(500).json({ success: false, error: "Failed to create Project from Sales Order", details: err.message });

    } finally {
        client.release();
    }
}

export async function updateProject(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const payload = validateProjectPayload(req.body || {});

        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT project_id, status FROM tbl_project WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [validatedProjectId, companyId]
        );
        if (existing.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Project not found" });
        }
        if (["closed", "cancelled"].includes(existing.rows[0].status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Project cannot be updated because its status is '${existing.rows[0].status}'` });
        }

        const updateSql = `UPDATE tbl_project SET
            project_name = $1, party_id = $2, quotation_id = $3, sales_order_id = $4,
            contract_no = $5, customer_po_no = $6, customer_po_date = $7, project_type = $8,
            project_location = $9, site_address = $10, project_manager_id = $11, project_engineer_id = $12,
            start_date = $13, planned_end_date = $14, actual_end_date = $15, currency_id = $16,
            contract_value = $17, estimated_cost = $18, actual_cost = $19, progress_percent = $20,
            description = $21, terms_conditions = $22, notes = $23, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = $24 AND company_id = $25 AND is_deleted = FALSE
            RETURNING *`;

        const params = [
            payload.project_name,
            payload.party_id,
            payload.quotation_id ?? null,
            payload.sales_order_id ?? null,
            payload.contract_no || null,
            payload.customer_po_no || null,
            payload.customer_po_date || null,
            payload.project_type || "other",
            payload.project_location || null,
            payload.site_address || null,
            payload.project_manager_id ?? null,
            payload.project_engineer_id ?? null,
            payload.start_date || null,
            payload.planned_end_date || null,
            payload.actual_end_date || null,
            payload.currency_id ?? null,
            payload.contract_value ?? 0,
            payload.estimated_cost ?? 0,
            payload.actual_cost ?? 0,
            payload.progress_percent ?? 0,
            payload.description || null,
            payload.terms_conditions || null,
            payload.notes || null,
            validatedProjectId,
            companyId,
        ];

        const result = await client.query(updateSql, params);

        await logAudit(client, {
            module_name: "Project",
            page_name: "Update Project",
            table_name: "tbl_project",
            table_id: projectId,
            action_type: "UPDATE",
            action_description: "Project Updated Successfully",
            new_value: JSON.stringify(result.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });

        await client.query("COMMIT");

        return res.status(200).json({ success: true, message: "Project Updated", Projects: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updateProject]", err);
        return res.status(500).json({ success: false, error: "Failed to Update Project", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteProject(req, res) {
    const { userId, roleId, companyId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        await client.query("BEGIN");

        const result = await deleteModule(client, "tbl_project", "project_id", validatedProjectId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, error: "Project not found" });
        }

        await deleteModule(client, "tbl_project_boq_items", "project_id", validatedProjectId, { company_id: companyId });
        await deleteModule(client, "tbl_project_costs", "project_id", validatedProjectId, { company_id: companyId });
        await deleteModule(client, "tbl_project_milestones", "project_id", validatedProjectId, { company_id: companyId });
        await deleteModule(client, "tbl_project_tasks", "project_id", validatedProjectId, { company_id: companyId });
        await deleteModule(client, "tbl_project_sites", "project_id", validatedProjectId, { company_id: companyId });
        await deleteModule(client, "tbl_project_documents", "project_id", validatedProjectId, { company_id: companyId });

        await logAudit(client, {
            module_name: "Project",
            page_name: "Delete Project",
            table_name: "tbl_project",
            table_id: validatedProjectId,
            action_type: "DELETE",
            action_description: "Project Deleted Successfully",
            new_value: JSON.stringify(result.result),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });

        await client.query("COMMIT");

        return res.status(200).json({ success: true, message: "Project Deleted", Projects: result.result });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteProject]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Project", details: err.message });

    } finally {
        client.release();
    }
}

export async function changeStatus(req, res) {
    const { userId, companyId, roleId } = req.user;
    const { projectId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const normalizedStatus = String(status || "").trim().toLowerCase();
        const allowedStatuses = ["planning", "approved", "in_progress", "on_hold", "delayed", "completed", "closed", "cancelled"];
        if (!allowedStatuses.includes(normalizedStatus)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid project status: ${status}` });
        }

        await client.query("BEGIN");

        const projectResult = await client.query(
            `SELECT * FROM tbl_project WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [validatedProjectId, companyId]
        );
        if (projectResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Project not found" });
        }

        const project = projectResult.rows[0];
        const currentStatus = project.status;

        if (currentStatus === normalizedStatus) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Project is already ${normalizedStatus}` });
        }
        if (!validateProjectStatusTransition(currentStatus, normalizedStatus)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Project status cannot be changed from '${currentStatus}' to '${normalizedStatus}'` });
        }

        const userQuery = await client.query(
            `SELECT first_name, last_name, email FROM users WHERE user_id = $1 AND company_id = $2`,
            [userId, companyId]
        );
        const user = userQuery.rows[0];
        const userName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || user?.email || "Unknown User";

        const updateQuery = `UPDATE tbl_project SET status = $3, actual_end_date = ${normalizedStatus === "completed" ? "CURRENT_DATE" : "actual_end_date"}, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`;
        const result = await client.query(updateQuery, [validatedProjectId, companyId, normalizedStatus]);
        const updatedProject = result.rows[0];

        await logAudit(client, {
            module_name: "Project",
            page_name: "Project Status",
            table_name: "tbl_project",
            table_id: validatedProjectId,
            action_type: "STATUS_CHANGE",
            action_description: `Project status changed from ${currentStatus} to ${normalizedStatus} by ${userName}`,
            old_value: JSON.stringify(project),
            new_value: JSON.stringify(updatedProject),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Project status changed from '${currentStatus}' to '${normalizedStatus}'`,
            Projects: updatedProject,
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStatus]", err);
        return res.status(500).json({ success: false, error: "Failed to change status of Project", details: err.message });
    } finally {
        client.release();
    }
}

/**
 * Project Financial Control dashboard (doc section 27):
 * Contract Value, Estimated Cost, Actual Cost, Billing, Received, Outstanding, Profit.
 */
export async function getProjectFinancials(req, res) {
    const { companyId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const projectRes = await companyPool.query(
            `SELECT * FROM tbl_project WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [validatedProjectId, companyId]
        );
        if (projectRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Project not found" });
        }
        const project = projectRes.rows[0];

        const billingRes = await companyPool.query(
            `SELECT COALESCE(SUM(total_amount),0) AS billed, COALESCE(SUM(paid_amount),0) AS received
             FROM tbl_invoice WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [validatedProjectId, companyId]
        );
        const costRes = await companyPool.query(
            `SELECT COALESCE(SUM(budget_amount),0) AS budget, COALESCE(SUM(actual_amount),0) AS actual
             FROM tbl_project_costs WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [validatedProjectId, companyId]
        );

        const billed = num(billingRes.rows[0].billed);
        const received = num(billingRes.rows[0].received);
        const budgetCost = num(costRes.rows[0].budget) || num(project.estimated_cost);
        const actualCost = num(costRes.rows[0].actual) || num(project.actual_cost);
        const contractValue = num(project.contract_value);

        return res.status(200).json({
            success: true,
            message: "Project Financials",
            financials: {
                project_id: project.project_id,
                project_code: project.project_code,
                contract_value: contractValue,
                estimated_cost: round2(budgetCost),
                actual_cost: round2(actualCost),
                cost_variance: round2(actualCost - budgetCost),
                billed_amount: round2(billed),
                received_amount: round2(received),
                outstanding_amount: round2(billed - received),
                expected_profit: round2(contractValue - budgetCost),
                current_profit: round2(contractValue - actualCost),
                progress_percent: num(project.progress_percent),
            },
        });

    } catch (err) {
        console.error("[getProjectFinancials]", err);
        return res.status(500).json({ success: false, error: "Failed to fetch Project Financials", details: err.message });
    }
}

///////////////////////////Project Module End /////////////////////////////

/////////////////////////// Project Sites /////////////////////////////
export async function addProjectSite(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const payload = req.body || {};
        if (!payload.site_name || !String(payload.site_name).trim()) {
            return res.status(400).json({ success: false, error: "site_name is required" });
        }

        await client.query("BEGIN");
        await ensureProjectExists(client, validatedProjectId, companyId);
        const sql = `INSERT INTO tbl_project_sites (
            project_id, site_name, address_line1, address_line2, city_id, state_id, country_id,
            pincode, contact_person, contact_phone, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`;
        const params = [
            validatedProjectId, String(payload.site_name).trim(), payload.address_line1 || null, payload.address_line2 || null,
            payload.city_id || null, payload.state_id || null, payload.country_id || null,
            payload.pincode || null, payload.contact_person || null, payload.contact_phone || null,
            userId, companyId,
        ];
        const result = await client.query(sql, params);

        await logAudit(client, {
            module_name: "Project", page_name: "Add Project Site", table_name: "tbl_project_sites",
            table_id: result.rows[0].site_id, action_type: "CREATE",
            action_description: "Project Site Added", new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Project Site Added", ProjectSites: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[addProjectSite]", err);
        return res.status(500).json({ success: false, error: "Failed to add Project Site", details: err.message });
    } finally {
        client.release();
    }
}

export async function deleteProjectSite(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, siteId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const validatedSiteId = validatePositiveId(siteId, "siteId");
        await client.query("BEGIN");
        const result = await deleteModule(client, "tbl_project_sites", "site_id", validatedSiteId, { project_id: validatedProjectId, company_id: companyId });
        if (result.result.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, error: "Project Site not found" });
        }
        await logAudit(client, {
            module_name: "Project", page_name: "Delete Project Site", table_name: "tbl_project_sites",
            table_id: siteId, action_type: "DELETE",
            action_description: "Project Site Deleted", new_value: JSON.stringify(result.result),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });
        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Project Site Deleted", ProjectSites: result.result });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteProjectSite]", err);
        return res.status(500).json({ success: false, error: "Failed to delete Project Site", details: err.message });
    } finally {
        client.release();
    }
}

/////////////////////////// Project BOQ /////////////////////////////
export async function addBoqItem(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const payload = req.body || {};
        if (!payload.description || !String(payload.description).trim()) {
            return res.status(400).json({ success: false, error: "description is required" });
        }
        const quantity = Number(payload.quantity);
        const unitRate = Number(payload.unit_rate);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return res.status(400).json({ success: false, error: "quantity must be a positive number" });
        }
        if (!Number.isFinite(unitRate) || unitRate < 0) {
            return res.status(400).json({ success: false, error: "unit_rate must be a non-negative number" });
        }
        const totalAmount = round2(quantity * unitRate);

        await client.query("BEGIN");
        await ensureProjectExists(client, validatedProjectId, companyId);
        const sql = `INSERT INTO tbl_project_boq_items (
            project_id, boq_type, item_id, description, quantity, unit_id, unit_rate, total_amount, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
        const result = await client.query(sql, [
            validatedProjectId, payload.boq_type || "material", payload.item_id || null, String(payload.description).trim(),
            quantity, payload.unit_id || null, unitRate, totalAmount, userId, companyId,
        ]);

        await logAudit(client, {
            module_name: "Project", page_name: "Add BOQ Item", table_name: "tbl_project_boq_items",
            table_id: result.rows[0].boq_item_id, action_type: "CREATE",
            action_description: "Project BOQ Item Added", new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "BOQ Item Added", BoqItems: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[addBoqItem]", err);
        return res.status(500).json({ success: false, error: "Failed to add BOQ Item", details: err.message });
    } finally {
        client.release();
    }
}

export async function updateBoqItem(req, res) {
    const { companyId, userId } = req.user;
    const { projectId, boqItemId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const validatedBoqItemId = validatePositiveId(boqItemId, "boqItemId");
        const payload = req.body || {};
        if (payload.description !== undefined && payload.description !== null && !String(payload.description).trim()) {
            return res.status(400).json({ success: false, error: "description cannot be empty" });
        }
        const quantity = Number(payload.quantity ?? 0);
        const unitRate = Number(payload.unit_rate ?? 0);
        if (!Number.isFinite(quantity) || quantity < 0) {
            return res.status(400).json({ success: false, error: "quantity must be a non-negative number" });
        }
        if (!Number.isFinite(unitRate) || unitRate < 0) {
            return res.status(400).json({ success: false, error: "unit_rate must be a non-negative number" });
        }
        const totalAmount = round2(quantity * unitRate);

        const sql = `UPDATE tbl_project_boq_items SET
            boq_type = $1, item_id = $2, description = $3, quantity = $4, unit_id = $5,
            unit_rate = $6, total_amount = $7, consumed_quantity = $8, updated_at = CURRENT_TIMESTAMP
            WHERE boq_item_id = $9 AND project_id = $10 AND company_id = $11 AND is_deleted = FALSE
            RETURNING *`;
        const result = await companyPool.query(sql, [
            payload.boq_type || "material", payload.item_id || null, payload.description || null, quantity,
            payload.unit_id || null, unitRate, totalAmount, num(payload.consumed_quantity), validatedBoqItemId, validatedProjectId, companyId,
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: "BOQ Item not found" });
        }
        return res.status(200).json({ success: true, message: "BOQ Item Updated", BoqItems: result.rows[0] });

    } catch (err) {
        console.error("[updateBoqItem]", err);
        return res.status(500).json({ success: false, error: "Failed to update BOQ Item", details: err.message });
    }
}

export async function deleteBoqItem(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, boqItemId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const validatedBoqItemId = validatePositiveId(boqItemId, "boqItemId");
        await client.query("BEGIN");
        const result = await deleteModule(client, "tbl_project_boq_items", "boq_item_id", validatedBoqItemId, { project_id: validatedProjectId, company_id: companyId });
        if (result.result.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, error: "BOQ Item not found" });
        }
        await logAudit(client, {
            module_name: "Project", page_name: "Delete Project BOQ", table_name: "tbl_project_boq_items",
            table_id: boqItemId, action_type: "DELETE",
            action_description: "Project BOQ Deleted", new_value: JSON.stringify(result.result),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });
        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "BOQ Item Deleted", BoqItems: result.result });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteBoqItem]", err);
        return res.status(500).json({ success: false, error: "Failed to delete BOQ Item", details: err.message });
    } finally {
        client.release();
    }
}

/////////////////////////// Project Milestones /////////////////////////////
export async function addMilestone(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const payload = req.body || {};
        if (!payload.milestone_name || !String(payload.milestone_name).trim()) {
            return res.status(400).json({ success: false, error: "milestone_name is required" });
        }
        const paymentPercent = Number(payload.payment_percent ?? 0);
        const paymentAmount = Number(payload.payment_amount ?? 0);
        if (!Number.isFinite(paymentPercent) || paymentPercent < 0 || paymentPercent > 100) {
            return res.status(400).json({ success: false, error: "payment_percent must be between 0 and 100" });
        }
        if (!Number.isFinite(paymentAmount) || paymentAmount < 0) {
            return res.status(400).json({ success: false, error: "payment_amount must be a non-negative number" });
        }

        await client.query("BEGIN");
        await ensureProjectExists(client, validatedProjectId, companyId);
        const sql = `INSERT INTO tbl_project_milestones (
            project_id, milestone_name, due_date, payment_percent, payment_amount, sort_order, status, remarks, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
        const result = await client.query(sql, [
            validatedProjectId, String(payload.milestone_name).trim(), payload.due_date || null, paymentPercent,
            paymentAmount, payload.sort_order || 0, payload.status || "pending",
            payload.remarks || null, userId, companyId,
        ]);

        await logAudit(client, {
            module_name: "Project", page_name: "Add Milestone", table_name: "tbl_project_milestones",
            table_id: result.rows[0].milestone_id, action_type: "CREATE",
            action_description: "Project Milestone Added", new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Milestone Added", Milestones: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[addMilestone]", err);
        return res.status(500).json({ success: false, error: "Failed to add Milestone", details: err.message });
    } finally {
        client.release();
    }
}

export async function updateMilestone(req, res) {
    const { companyId } = req.user;
    const { projectId, milestoneId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const validatedMilestoneId = validatePositiveId(milestoneId, "milestoneId");
        const payload = req.body || {};
        const paymentPercent = Number(payload.payment_percent ?? 0);
        const paymentAmount = Number(payload.payment_amount ?? 0);
        if (!Number.isFinite(paymentPercent) || paymentPercent < 0 || paymentPercent > 100) {
            return res.status(400).json({ success: false, error: "payment_percent must be between 0 and 100" });
        }
        if (!Number.isFinite(paymentAmount) || paymentAmount < 0) {
            return res.status(400).json({ success: false, error: "payment_amount must be a non-negative number" });
        }
        const sql = `UPDATE tbl_project_milestones SET
            milestone_name = $1, due_date = $2, completion_date = $3, payment_percent = $4,
            payment_amount = $5, sort_order = $6, status = $7, remarks = $8, updated_at = CURRENT_TIMESTAMP
            WHERE milestone_id = $9 AND project_id = $10 AND company_id = $11 AND is_deleted = FALSE
            RETURNING *`;
        const result = await companyPool.query(sql, [
            payload.milestone_name, payload.due_date || null, payload.completion_date || null,
            paymentPercent, paymentAmount, payload.sort_order || 0,
            payload.status || "pending", payload.remarks || null, validatedMilestoneId, validatedProjectId, companyId,
        ]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Milestone not found" });
        }
        return res.status(200).json({ success: true, message: "Milestone Updated", Milestones: result.rows[0] });
    } catch (err) {
        console.error("[updateMilestone]", err);
        return res.status(500).json({ success: false, error: "Failed to update Milestone", details: err.message });
    }
}

export async function deleteMilestone(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, milestoneId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const validatedMilestoneId = validatePositiveId(milestoneId, "milestoneId");
        await client.query("BEGIN");
        const result = await deleteModule(client, "tbl_project_milestones", "milestone_id", validatedMilestoneId, { project_id: validatedProjectId, company_id: companyId });
        if (result.result.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, error: "Milestone not found" });
        }
        await logAudit(client, {
            module_name: "Project", page_name: "Delete Project Milestone", table_name: "tbl_project_milestones",
            table_id: milestoneId, action_type: "DELETE",
            action_description: "Project Milestone Deleted", new_value: JSON.stringify(result.result),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });
        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Milestone Deleted", Milestones: result.result });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteMilestone]", err);
        return res.status(500).json({ success: false, error: "Failed to delete Milestone", details: err.message });
    } finally {
        client.release();
    }
}

/////////////////////////// Project Tasks /////////////////////////////
export async function addTask(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const payload = req.body || {};
        if (!payload.task_name || !String(payload.task_name).trim()) {
            return res.status(400).json({ success: false, error: "task_name is required" });
        }
        const progressPercent = Number(payload.progress_percent ?? 0);
        if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
            return res.status(400).json({ success: false, error: "progress_percent must be between 0 and 100" });
        }

        await client.query("BEGIN");
        await ensureProjectExists(client, validatedProjectId, companyId);
        const sql = `INSERT INTO tbl_project_tasks (
            project_id, site_id, task_name, assigned_to, start_date, due_date, priority,
            progress_percent, status, remarks, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`;
        const result = await client.query(sql, [
            validatedProjectId, payload.site_id || null, String(payload.task_name).trim(), payload.assigned_to || null,
            payload.start_date || null, payload.due_date || null, payload.priority || "medium",
            progressPercent, payload.status || "pending", payload.remarks || null, userId, companyId,
        ]);

        await logAudit(client, {
            module_name: "Project", page_name: "Add Task", table_name: "tbl_project_tasks",
            table_id: result.rows[0].task_id, action_type: "CREATE",
            action_description: "Project Task Added", new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Task Added", Tasks: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[addTask]", err);
        return res.status(500).json({ success: false, error: "Failed to add Task", details: err.message });
    } finally {
        client.release();
    }
}

export async function updateTask(req, res) {
    const { companyId } = req.user;
    const { projectId, taskId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const validatedTaskId = validatePositiveId(taskId, "taskId");
        const payload = req.body || {};
        const progressPercent = Number(payload.progress_percent ?? 0);
        if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
            return res.status(400).json({ success: false, error: "progress_percent must be between 0 and 100" });
        }
        const sql = `UPDATE tbl_project_tasks SET
            site_id = $1, task_name = $2, assigned_to = $3, start_date = $4, due_date = $5,
            priority = $6, progress_percent = $7, status = $8, remarks = $9, updated_at = CURRENT_TIMESTAMP
            WHERE task_id = $10 AND project_id = $11 AND company_id = $12 AND is_deleted = FALSE
            RETURNING *`;
        const result = await companyPool.query(sql, [
            payload.site_id || null, payload.task_name, payload.assigned_to || null, payload.start_date || null,
            payload.due_date || null, payload.priority || "medium", progressPercent,
            payload.status || "pending", payload.remarks || null, validatedTaskId, validatedProjectId, companyId,
        ]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Task not found" });
        }
        return res.status(200).json({ success: true, message: "Task Updated", Tasks: result.rows[0] });
    } catch (err) {
        console.error("[updateTask]", err);
        return res.status(500).json({ success: false, error: "Failed to update Task", details: err.message });
    }
}

export async function deleteTask(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, taskId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const validatedTaskId = validatePositiveId(taskId, "taskId");
        await client.query("BEGIN");
        const result = await deleteModule(client, "tbl_project_tasks", "task_id", validatedTaskId, { project_id: validatedProjectId, company_id: companyId });
        if (result.result.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, error: "Task not found" });
        }
        await logAudit(client, {
            module_name: "Project", page_name: "Delete Project Task", table_name: "tbl_project_tasks",
            table_id: taskId, action_type: "DELETE",
            action_description: "Project Task Deleted", new_value: JSON.stringify(result.result),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });
        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Task Deleted", Tasks: result.result });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteTask]", err);
        return res.status(500).json({ success: false, error: "Failed to delete Task", details: err.message });
    } finally {
        client.release();
    }
}

/////////////////////////// Daily Progress Report (DPR) /////////////////////////////
export async function getDprList(req, res) {
    const { companyId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const result = await companyPool.query(
            `SELECT * FROM tbl_project_dpr WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE ORDER BY report_date DESC`,
            [validatedProjectId, companyId]
        );
        return res.status(200).json({ success: true, message: "DPR Fetch Successfully", Dpr: result.rows });
    } catch (err) {
        console.error("[getDprList]", err);
        return res.status(500).json({ success: false, error: "Failed to fetch DPR", details: err.message });
    }
}

export async function addDpr(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const payload = req.body || {};
        if (!payload.report_date) {
            return res.status(400).json({ success: false, error: "report_date is required" });
        }
        const progressPercent = Number(payload.progress_percent ?? 0);
        if (payload.progress_percent !== undefined && (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100)) {
            return res.status(400).json({ success: false, error: "progress_percent must be between 0 and 100" });
        }

        await client.query("BEGIN");
        await ensureProjectExists(client, validatedProjectId, companyId);
        const sql = `INSERT INTO tbl_project_dpr (
            project_id, site_id, report_date, weather, manpower_count, equipment_used, work_completed,
            material_used, material_shortage, work_planned_next, progress_percent, issues, safety_issues,
            client_instructions, remarks, submitted_by, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`;
        const result = await client.query(sql, [
            validatedProjectId, payload.site_id || null, payload.report_date, payload.weather || null,
            payload.manpower_count || 0, payload.equipment_used || null, payload.work_completed || null,
            payload.material_used || null, payload.material_shortage || null, payload.work_planned_next || null,
            progressPercent, payload.issues || null, payload.safety_issues || null,
            payload.client_instructions || null, payload.remarks || null, userId, userId, companyId,
        ]);

        // Roll the DPR's reported progress up onto the project header.
        if (payload.progress_percent !== undefined) {
            await client.query(
                `UPDATE tbl_project SET progress_percent = $1, updated_at = CURRENT_TIMESTAMP WHERE project_id = $2 AND company_id = $3`,
                [progressPercent, validatedProjectId, companyId]
            );
        }

        await logAudit(client, {
            module_name: "Project", page_name: "Add DPR", table_name: "tbl_project_dpr",
            table_id: result.rows[0].dpr_id, action_type: "CREATE",
            action_description: `DPR submitted for ${payload.report_date}`, new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "DPR Added", Dpr: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[addDpr]", err);
        return res.status(500).json({ success: false, error: "Failed to add DPR", details: err.message });
    } finally {
        client.release();
    }
}

/////////////////////////// Project Documents /////////////////////////////
export async function getDocuments(req, res) {
    const { companyId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const result = await companyPool.query(
            `SELECT * FROM tbl_project_documents WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE ORDER BY created_at DESC`,
            [validatedProjectId, companyId]
        );
        return res.status(200).json({ success: true, message: "Documents Fetch Successfully", Documents: result.rows });
    } catch (err) {
        console.error("[getDocuments]", err);
        return res.status(500).json({ success: false, error: "Failed to fetch Documents", details: err.message });
    }
}

export async function addDocument(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const payload = req.body || {};
        if (!payload.document_name || !String(payload.document_name).trim() || !payload.file_url || !String(payload.file_url).trim()) {
            return res.status(400).json({ success: false, error: "document_name and file_url are required" });
        }

        await client.query("BEGIN");
        await ensureProjectExists(client, validatedProjectId, companyId);
        const sql = `INSERT INTO tbl_project_documents (
            project_id, document_type, document_name, file_url, remarks, uploaded_by, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
        const result = await client.query(sql, [
            validatedProjectId, payload.document_type || "other", String(payload.document_name).trim(), String(payload.file_url).trim(),
            payload.remarks || null, userId, userId, companyId,
        ]);

        await logAudit(client, {
            module_name: "Project", page_name: "Add Document", table_name: "tbl_project_documents",
            table_id: result.rows[0].document_id, action_type: "CREATE",
            action_description: `Document '${payload.document_name}' added`, new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Document Added", Documents: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[addDocument]", err);
        return res.status(500).json({ success: false, error: "Failed to add Document", details: err.message });
    } finally {
        client.release();
    }
}

export async function deleteDocument(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, documentId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const validatedProjectId = validatePositiveId(projectId, "projectId");
        const validatedDocumentId = validatePositiveId(documentId, "documentId");
        await client.query("BEGIN");
        const result = await deleteModule(client, "tbl_project_documents", "document_id", validatedDocumentId, { project_id: validatedProjectId, company_id: companyId });
        if (result.result.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, error: "Document not found" });
        }
        await logAudit(client, {
            module_name: "Project", page_name: "Delete Project Document", table_name: "tbl_project_documents",
            table_id: documentId, action_type: "DELETE",
            action_description: "Project Document Deleted", new_value: JSON.stringify(result.result),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });
        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Document Deleted", Documents: result.result });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteDocument]", err);
        return res.status(500).json({ success: false, error: "Failed to delete Document", details: err.message });
    } finally {
        client.release();
    }
}
