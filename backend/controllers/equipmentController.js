// controllers/equipmentController.js
//
// equipment_mst   the equipment register (cranes, generators, ...)
// tbl_project_equipment_log   one row per project/equipment/day; writing a
//   log recalculates tbl_project_costs('equipment') and tbl_project.actual_cost
//
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule } from "../services/commonService.js";
import { computeEquipmentCost, recalcProjectCost } from "../services/costingService.js";
import { buildSetClause, cleanText, httpError, isValidDateOnly, parsePaging, pickFields, sendError } from "../services/crmService.js";

const EQUIPMENT_TYPES = [
    "crane", "welding_machine", "generator", "compressor", "lifting_equipment",
    "excavator", "forklift", "testing_equipment", "vehicle", "other",
];
const OWNERSHIP = ["owned", "rented"];
const EQUIPMENT_FIELDS = ["equipment_name", "equipment_type", "ownership", "vendor_id", "rate_per_hour", "rate_per_day", "status", "notes"];
const EQUIPMENT_OPTS = { textColumns: ["equipment_name", "notes"] };

function validateEquipmentPayload(p, { requireName }) {
    if (requireName && !cleanText(p.equipment_name)) throw httpError(400, "equipment_name is required");
    if (p.equipment_type !== undefined && !EQUIPMENT_TYPES.includes(p.equipment_type)) {
        throw httpError(400, `equipment_type must be one of: ${EQUIPMENT_TYPES.join(", ")}`);
    }
    if (p.ownership !== undefined && !OWNERSHIP.includes(p.ownership)) throw httpError(400, `ownership must be one of: ${OWNERSHIP.join(", ")}`);
    if (p.ownership === "rented" && !p.vendor_id) throw httpError(400, "vendor_id is required when ownership is 'rented'");
    for (const f of ["rate_per_hour", "rate_per_day"]) {
        if (p[f] !== undefined && p[f] !== null && Number(p[f]) < 0) throw httpError(400, `${f} cannot be negative`);
    }
}

/////////////////////////// Equipment master /////////////////////////////

export async function getEquipment(req, res) {
    const { companyId } = req.user;
    const { equipmentId } = req.params;
    try {
        const companyPool = await getCompanyPool(companyId);
        if (equipmentId) {
            const result = await companyPool.query(
                `SELECT e.*, p.party_name AS vendor_name FROM equipment_mst e
                   LEFT JOIN tbl_party p ON p.party_id = e.vendor_id
                  WHERE e.equipment_id = $1 AND e.company_id = $2 AND e.is_deleted = FALSE`,
                [equipmentId, companyId]
            );
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Equipment not found" });
            return res.status(200).json({ success: true, message: "Equipment Fetch Successfully", Equipment: result.rows[0] });
        }

        const { status, type, search } = req.query;
        const conditions = ["e.company_id = $1", "e.is_deleted = FALSE"];
        const params = [companyId];
        if (status) { params.push(status); conditions.push(`e.status = $${params.length}`); }
        if (type) { params.push(type); conditions.push(`e.equipment_type = $${params.length}`); }
        if (search) { params.push(`%${search}%`); conditions.push(`(e.equipment_name ILIKE $${params.length} OR e.equipment_code ILIKE $${params.length})`); }

        const result = await companyPool.query(
            `SELECT e.*, p.party_name AS vendor_name FROM equipment_mst e
               LEFT JOIN tbl_party p ON p.party_id = e.vendor_id
              WHERE ${conditions.join(" AND ")} ORDER BY e.equipment_id DESC`,
            params
        );
        return res.status(200).json({ success: true, message: "Equipment Fetch Successfully", Equipment: result.rows });
    } catch (err) {
        return sendError(res, "getEquipment", err, "Failed to fetch Equipment");
    }
}

export async function createEquipment(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.user;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        validateEquipmentPayload(payload, { requireName: true });

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        if (payload.vendor_id) {
            const v = await client.query(`SELECT party_id FROM tbl_party WHERE party_id = $1 AND company_id = $2 AND is_deleted = FALSE`, [payload.vendor_id, companyId]);
            if (v.rows.length === 0) throw httpError(400, "vendor_id does not match an existing party");
        }

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.EQUIPMENT, companyId, userId, financialYearId, client,
        });

        const fields = pickFields(payload, EQUIPMENT_FIELDS, EQUIPMENT_OPTS);
        if (!fields.some(([c]) => c === "ownership")) fields.push(["ownership", "owned"]);
        fields.push(["equipment_code", seriesResult.series], ["user_id", userId], ["company_id", companyId]);

        const result = await client.query(
            `INSERT INTO equipment_mst (${fields.map(([c]) => c).join(", ")})
             VALUES (${fields.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
            fields.map(([, v]) => v)
        );

        await logAudit(client, {
            module_name: "Equipment", page_name: "Create Equipment", table_name: "equipment_mst",
            table_id: result.rows[0].equipment_id, action_type: "CREATE",
            action_description: `Equipment ${result.rows[0].equipment_code} created`,
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Equipment created", Equipment: result.rows[0] });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "createEquipment", err, "Failed to create Equipment");
    } finally {
        client?.release();
    }
}

export async function updateEquipment(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { equipmentId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        validateEquipmentPayload(payload, { requireName: false });

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT * FROM equipment_mst WHERE equipment_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [equipmentId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Equipment not found");

        const pairs = pickFields(payload, EQUIPMENT_FIELDS, EQUIPMENT_OPTS);
        if (pairs.length === 0) throw httpError(400, "No updatable fields were sent");
        const { setSql, values } = buildSetClause(pairs);

        const result = await client.query(
            `UPDATE equipment_mst SET ${setSql}, updated_at = CURRENT_TIMESTAMP
              WHERE equipment_id = $${values.length + 1} AND company_id = $${values.length + 2} RETURNING *`,
            [...values, equipmentId, companyId]
        );

        await logAudit(client, {
            module_name: "Equipment", page_name: "Update Equipment", table_name: "equipment_mst", table_id: equipmentId,
            action_type: "UPDATE", action_description: "Equipment updated",
            old_value: JSON.stringify(existing.rows[0]), new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Equipment updated", Equipment: result.rows[0] });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "updateEquipment", err, "Failed to update Equipment");
    } finally {
        client?.release();
    }
}

export async function deleteEquipment(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { equipmentId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const inUse = await client.query(
            `SELECT COUNT(*)::int AS n FROM tbl_project_equipment_log WHERE equipment_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [equipmentId, companyId]
        );
        if (inUse.rows[0].n > 0) throw httpError(409, `This equipment has ${inUse.rows[0].n} usage log(s). Remove those first.`);

        const result = await deleteModule(client, "equipment_mst", "equipment_id", equipmentId, { company_id: companyId });
        if (result.result.length === 0) throw httpError(404, "Equipment not found");

        await logAudit(client, {
            module_name: "Equipment", page_name: "Delete Equipment", table_name: "equipment_mst", table_id: equipmentId,
            action_type: "DELETE", action_description: "Equipment deleted",
            new_value: JSON.stringify(result.result), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Equipment deleted", Equipment: result.result });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "deleteEquipment", err, "Failed to delete Equipment");
    } finally {
        client?.release();
    }
}

/////////////////////////// Equipment usage log /////////////////////////////

const LOG_SELECT = `
    l.*, e.equipment_code, e.equipment_name, e.equipment_type, ps.site_name`;
const LOG_JOINS = `
    FROM tbl_project_equipment_log l
    LEFT JOIN equipment_mst e ON e.equipment_id = l.equipment_id
    LEFT JOIN tbl_project_sites ps ON ps.site_id = l.site_id`;

async function assertProjectExists(client, projectId, companyId) {
    const p = await client.query(
        `SELECT project_id FROM tbl_project WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [projectId, companyId]
    );
    if (p.rows.length === 0) throw httpError(404, "Project not found");
}

export async function getEquipmentLogs(req, res) {
    const { companyId } = req.user;
    const { projectId } = req.params;
    try {
        const companyPool = await getCompanyPool(companyId);
        await assertProjectExists(companyPool, projectId, companyId);

        const { from, to, equipmentId } = req.query;
        const conditions = ["l.project_id = $1", "l.company_id = $2", "l.is_deleted = FALSE"];
        const params = [projectId, companyId];
        if (from) { params.push(from); conditions.push(`l.log_date >= $${params.length}`); }
        if (to) { params.push(to); conditions.push(`l.log_date <= $${params.length}`); }
        if (equipmentId) { params.push(equipmentId); conditions.push(`l.equipment_id = $${params.length}`); }

        const { limit, offset } = parsePaging(req.query);
        params.push(limit, offset);

        const result = await companyPool.query(
            `SELECT ${LOG_SELECT}, COUNT(*) OVER()::int AS total_count ${LOG_JOINS}
              WHERE ${conditions.join(" AND ")}
              ORDER BY l.log_date DESC, l.equipment_log_id DESC
              LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        const total = result.rows[0]?.total_count ?? 0;
        const rows = result.rows.map(({ total_count, ...row }) => row);

        return res.status(200).json({ success: true, message: "Equipment Logs Fetch Successfully", EquipmentLogs: rows, total, limit, offset });
    } catch (err) {
        return sendError(res, "getEquipmentLogs", err, "Failed to fetch Equipment Logs");
    }
}

function validateEquipmentLogPayload(p) {
    if (!p.equipment_id) throw httpError(400, "equipment_id is required");
    if (!p.log_date || !isValidDateOnly(p.log_date)) throw httpError(400, "log_date is required as YYYY-MM-DD");
    if (!(Number(p.hours_used) > 0) || Number(p.hours_used) > 24) throw httpError(400, "hours_used must be greater than 0 and at most 24");
    if (p.fuel_cost != null && Number(p.fuel_cost) < 0) throw httpError(400, "fuel_cost cannot be negative");
}

export async function addEquipmentLog(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        validateEquipmentLogPayload(payload);

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        await assertProjectExists(client, projectId, companyId);

        const eq = await client.query(
            `SELECT * FROM equipment_mst WHERE equipment_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [payload.equipment_id, companyId]
        );
        if (eq.rows.length === 0) throw httpError(400, "equipment_id does not match an existing equipment record");
        if (eq.rows[0].status !== "active") throw httpError(400, `This equipment is '${eq.rows[0].status}' and cannot be logged as used`);

        if (payload.site_id) {
            const s = await client.query(
                `SELECT site_id FROM tbl_project_sites WHERE site_id = $1 AND project_id = $2 AND company_id = $3 AND is_deleted = FALSE`,
                [payload.site_id, projectId, companyId]
            );
            if (s.rows.length === 0) throw httpError(400, "site_id does not belong to this project");
        }

        // Same equipment logged on the same day for a different project - almost always a
        // double-booking mistake, since one machine can't really be on two sites at once.
        const elsewhere = await client.query(
            `SELECT project_id FROM tbl_project_equipment_log
              WHERE equipment_id = $1 AND log_date = $2 AND company_id = $3 AND is_deleted = FALSE AND project_id <> $4`,
            [payload.equipment_id, payload.log_date, companyId, projectId]
        );
        if (elsewhere.rows.length > 0) {
            throw httpError(409, `This equipment is already logged against project ${elsewhere.rows[0].project_id} on ${payload.log_date}`);
        }

        const ratePerHour = payload.rate_per_hour ?? eq.rows[0].rate_per_hour;
        const totalCost = computeEquipmentCost({ hours_used: payload.hours_used, rate_per_hour: ratePerHour, fuel_cost: payload.fuel_cost });

        const result = await client.query(
            `INSERT INTO tbl_project_equipment_log
               (project_id, site_id, equipment_id, log_date, hours_used, rate_per_hour, fuel_cost, operator_name, total_cost, remarks, user_id, company_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [
                projectId, payload.site_id || null, payload.equipment_id, payload.log_date, payload.hours_used,
                ratePerHour, payload.fuel_cost || 0, cleanText(payload.operator_name), totalCost,
                cleanText(payload.remarks), userId, companyId,
            ]
        );
        const log = result.rows[0];
        const costs = await recalcProjectCost(client, { projectId, companyId, category: "equipment" });

        await logAudit(client, {
            module_name: "Equipment", page_name: "Add Equipment Log", table_name: "tbl_project_equipment_log",
            table_id: log.equipment_log_id, action_type: "CREATE",
            action_description: `${eq.rows[0].equipment_code} logged ${payload.hours_used}h on project ${projectId} for ${log.log_date} (cost ${totalCost})`,
            new_value: JSON.stringify(log), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Equipment usage logged", EquipmentLogs: log, project_costs: costs });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "addEquipmentLog", err, "Failed to log Equipment usage");
    } finally {
        client?.release();
    }
}

export async function updateEquipmentLog(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, equipmentLogId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT * FROM tbl_project_equipment_log
              WHERE equipment_log_id = $1 AND project_id = $2 AND company_id = $3 AND is_deleted = FALSE FOR UPDATE`,
            [equipmentLogId, projectId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Equipment log not found");
        const before = existing.rows[0];

        const merged = {
            equipment_id: payload.equipment_id ?? before.equipment_id,
            site_id: payload.site_id ?? before.site_id,
            log_date: payload.log_date ?? before.log_date?.toISOString?.().slice(0, 10) ?? before.log_date,
            hours_used: payload.hours_used ?? before.hours_used,
            rate_per_hour: payload.rate_per_hour ?? before.rate_per_hour,
            fuel_cost: payload.fuel_cost ?? before.fuel_cost,
            operator_name: payload.operator_name ?? before.operator_name,
            remarks: payload.remarks ?? before.remarks,
        };
        validateEquipmentLogPayload(merged);

        const eq = await client.query(
            `SELECT * FROM equipment_mst WHERE equipment_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [merged.equipment_id, companyId]
        );
        if (eq.rows.length === 0) throw httpError(400, "equipment_id does not match an existing equipment record");
        if (eq.rows[0].status !== "active") throw httpError(400, `This equipment is '${eq.rows[0].status}' and cannot be logged as used`);

        if (merged.site_id) {
            const s = await client.query(
                `SELECT site_id FROM tbl_project_sites WHERE site_id = $1 AND project_id = $2 AND company_id = $3 AND is_deleted = FALSE`,
                [merged.site_id, projectId, companyId]
            );
            if (s.rows.length === 0) throw httpError(400, "site_id does not belong to this project");
        }

        const elsewhere = await client.query(
            `SELECT project_id FROM tbl_project_equipment_log
              WHERE equipment_id = $1 AND log_date = $2 AND company_id = $3 AND is_deleted = FALSE AND project_id <> $4 AND equipment_log_id <> $5`,
            [merged.equipment_id, merged.log_date, companyId, projectId, equipmentLogId]
        );
        if (elsewhere.rows.length > 0) {
            throw httpError(409, `This equipment is already logged against project ${elsewhere.rows[0].project_id} on ${merged.log_date}`);
        }

        const ratePerHour = merged.rate_per_hour ?? eq.rows[0].rate_per_hour;
        const totalCost = computeEquipmentCost({
            hours_used: merged.hours_used,
            rate_per_hour: ratePerHour,
            fuel_cost: merged.fuel_cost,
        });

        const result = await client.query(
            `UPDATE tbl_project_equipment_log
                SET equipment_id = $3, site_id = $4, log_date = $5, hours_used = $6, rate_per_hour = $7,
                    fuel_cost = $8, operator_name = $9, total_cost = $10, remarks = $11, updated_at = CURRENT_TIMESTAMP
              WHERE equipment_log_id = $1 AND project_id = $2 AND company_id = $12 RETURNING *`,
            [equipmentLogId, projectId, merged.equipment_id, merged.site_id || null, merged.log_date, merged.hours_used,
                ratePerHour, merged.fuel_cost || 0, cleanText(merged.operator_name), totalCost, cleanText(merged.remarks), companyId]
        );
        const costs = await recalcProjectCost(client, { projectId, companyId, category: "equipment" });

        await logAudit(client, {
            module_name: "Equipment", page_name: "Update Equipment Log", table_name: "tbl_project_equipment_log",
            table_id: equipmentLogId, action_type: "UPDATE", action_description: "Equipment log updated",
            old_value: JSON.stringify(before), new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Equipment log updated", EquipmentLogs: result.rows[0], project_costs: costs });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "updateEquipmentLog", err, "Failed to update Equipment log");
    } finally {
        client?.release();
    }
}

export async function deleteEquipmentLog(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, equipmentLogId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const result = await client.query(
            `UPDATE tbl_project_equipment_log SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
              WHERE equipment_log_id = $1 AND project_id = $2 AND company_id = $3 AND is_deleted = FALSE RETURNING *`,
            [equipmentLogId, projectId, companyId]
        );
        if (result.rows.length === 0) throw httpError(404, "Equipment log not found");
        const costs = await recalcProjectCost(client, { projectId, companyId, category: "equipment" });

        await logAudit(client, {
            module_name: "Equipment", page_name: "Delete Equipment Log", table_name: "tbl_project_equipment_log",
            table_id: equipmentLogId, action_type: "DELETE", action_description: "Equipment log deleted",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Equipment log deleted", EquipmentLogs: result.rows[0], project_costs: costs });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "deleteEquipmentLog", err, "Failed to delete Equipment log");
    } finally {
        client?.release();
    }
}
