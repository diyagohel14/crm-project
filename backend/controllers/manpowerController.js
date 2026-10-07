// controllers/manpowerController.js
//
// labour_trade_mst   the trade register (Electrician, Welder, ...)
// tbl_project_manpower_log   one row per project/trade/subcontractor/day;
//   writing a log recalculates tbl_project_costs('labour') and
//   tbl_project.actual_cost (see services/costingService.js)
//
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { computeManpowerCost, recalcProjectCost } from "../services/costingService.js";
import { cleanText, httpError, isValidDateOnly, parsePaging, sendError } from "../services/crmService.js";

/////////////////////////// Labour trade master /////////////////////////////

export async function getLabourTrades(req, res) {
    try {
        const companyPool = await getCompanyPool(req.user.companyId);
        const result = await companyPool.query(
            `SELECT trade_id, trade_name, status FROM labour_trade_mst WHERE status = 'active' ORDER BY trade_name`
        );
        return res.status(200).json({ success: true, message: "Labour Trades Fetch Successfully", LabourTrades: result.rows });
    } catch (err) {
        return sendError(res, "getLabourTrades", err, "Failed to fetch Labour Trades");
    }
}

export async function createLabourTrade(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const name = cleanText(req.body?.trade_name);
        if (!name) throw httpError(400, "trade_name is required");

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const dup = await client.query(`SELECT trade_id FROM labour_trade_mst WHERE LOWER(trade_name) = LOWER($1)`, [name]);
        if (dup.rows.length) throw httpError(409, `Labour trade '${name}' already exists`);

        const result = await client.query(`INSERT INTO labour_trade_mst (trade_name) VALUES ($1) RETURNING *`, [name]);

        await logAudit(client, {
            module_name: "Manpower", page_name: "Create Labour Trade", table_name: "labour_trade_mst",
            table_id: result.rows[0].trade_id, action_type: "CREATE", action_description: `Labour trade '${name}' created`,
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Labour Trade created", LabourTrades: result.rows[0] });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "createLabourTrade", err, "Failed to create Labour Trade");
    } finally {
        client?.release();
    }
}

/////////////////////////// Manpower log /////////////////////////////

const LOG_SELECT = `
    m.*, t.trade_name, ps.site_name, p2.party_name AS subcontractor_name,
    NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS logged_by_name`;
const LOG_JOINS = `
    FROM tbl_project_manpower_log m
    LEFT JOIN labour_trade_mst t ON t.trade_id = m.trade_id
    LEFT JOIN tbl_project_sites ps ON ps.site_id = m.site_id
    LEFT JOIN tbl_party p2 ON p2.party_id = m.subcontractor_id
    LEFT JOIN users u ON u.user_id = m.user_id`;

async function assertProjectExists(client, projectId, companyId) {
    const p = await client.query(
        `SELECT project_id, status FROM tbl_project WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [projectId, companyId]
    );
    if (p.rows.length === 0) throw httpError(404, "Project not found");
    return p.rows[0];
}

export async function getManpowerLogs(req, res) {
    const { companyId } = req.user;
    const { projectId } = req.params;
    try {
        const companyPool = await getCompanyPool(companyId);
        await assertProjectExists(companyPool, projectId, companyId);

        const { from, to, tradeId } = req.query;
        const conditions = ["m.project_id = $1", "m.company_id = $2", "m.is_deleted = FALSE"];
        const params = [projectId, companyId];
        if (from) { params.push(from); conditions.push(`m.log_date >= $${params.length}`); }
        if (to) { params.push(to); conditions.push(`m.log_date <= $${params.length}`); }
        if (tradeId) { params.push(tradeId); conditions.push(`m.trade_id = $${params.length}`); }

        const filterParams = params.slice(); // snapshot before limit/offset are appended below
        const { limit, offset } = parsePaging(req.query);
        params.push(limit, offset);

        const result = await companyPool.query(
            `SELECT ${LOG_SELECT}, COUNT(*) OVER()::int AS total_count ${LOG_JOINS}
              WHERE ${conditions.join(" AND ")}
              ORDER BY m.log_date DESC, m.manpower_log_id DESC
              LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        const totals = await companyPool.query(
            `SELECT COALESCE(SUM(headcount), 0)::int AS total_headcount, COALESCE(SUM(total_cost), 0) AS total_cost
               FROM tbl_project_manpower_log m WHERE ${conditions.join(" AND ")}`,
            filterParams
        );
        const total = result.rows[0]?.total_count ?? 0;
        const rows = result.rows.map(({ total_count, ...row }) => row);

        return res.status(200).json({
            success: true, message: "Manpower Logs Fetch Successfully", ManpowerLogs: rows,
            total, limit, offset, summary: totals.rows[0],
        });
    } catch (err) {
        return sendError(res, "getManpowerLogs", err, "Failed to fetch Manpower Logs");
    }
}

function validateManpowerPayload(p) {
    if (!p.log_date || !isValidDateOnly(p.log_date)) throw httpError(400, "log_date is required as YYYY-MM-DD");
    if (!p.trade_id) throw httpError(400, "trade_id is required");
    if (!Number.isInteger(Number(p.headcount)) || Number(p.headcount) <= 0) throw httpError(400, "headcount must be a positive whole number");
    if (p.regular_hours != null && Number(p.regular_hours) < 0) throw httpError(400, "regular_hours cannot be negative");
    if (p.overtime_hours != null && Number(p.overtime_hours) < 0) throw httpError(400, "overtime_hours cannot be negative");
    if (p.rate_per_hour == null || Number(p.rate_per_hour) < 0) throw httpError(400, "rate_per_hour is required and cannot be negative");
    const totalHours = Number(p.regular_hours ?? 8) + Number(p.overtime_hours ?? 0);
    if (totalHours > 24) throw httpError(400, "regular_hours + overtime_hours cannot exceed 24 for one day");
}

export async function addManpowerLog(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        validateManpowerPayload(payload);

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        await assertProjectExists(client, projectId, companyId);

        const trade = await client.query(`SELECT trade_id FROM labour_trade_mst WHERE trade_id = $1 AND status = 'active'`, [payload.trade_id]);
        if (trade.rows.length === 0) throw httpError(400, "trade_id does not match an active labour trade");

        if (payload.subcontractor_id) {
            const sc = await client.query(
                `SELECT party_id FROM tbl_party WHERE party_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
                [payload.subcontractor_id, companyId]
            );
            if (sc.rows.length === 0) throw httpError(400, "subcontractor_id does not match an existing party");
        }
        if (payload.site_id) {
            const s = await client.query(
                `SELECT site_id FROM tbl_project_sites WHERE site_id = $1 AND project_id = $2 AND company_id = $3 AND is_deleted = FALSE`,
                [payload.site_id, projectId, companyId]
            );
            if (s.rows.length === 0) throw httpError(400, "site_id does not belong to this project");
        }

        const regularHours = payload.regular_hours ?? 8;
        const overtimeHours = payload.overtime_hours ?? 0;
        const { otRate, totalCost } = computeManpowerCost({
            headcount: payload.headcount, regular_hours: regularHours, overtime_hours: overtimeHours,
            rate_per_hour: payload.rate_per_hour, ot_rate_per_hour: payload.ot_rate_per_hour,
        });

        const result = await client.query(
            `INSERT INTO tbl_project_manpower_log
               (project_id, site_id, log_date, trade_id, headcount, regular_hours, overtime_hours,
                rate_per_hour, ot_rate_per_hour, total_cost, subcontractor_id, remarks, user_id, company_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [
                projectId, payload.site_id || null, payload.log_date, payload.trade_id, payload.headcount,
                regularHours, overtimeHours, payload.rate_per_hour, otRate, totalCost,
                payload.subcontractor_id || null, cleanText(payload.remarks), userId, companyId,
            ]
        );
        const log = result.rows[0];
        const costs = await recalcProjectCost(client, { projectId, companyId, category: "labour" });

        await logAudit(client, {
            module_name: "Manpower", page_name: "Add Manpower Log", table_name: "tbl_project_manpower_log",
            table_id: log.manpower_log_id, action_type: "CREATE",
            action_description: `${log.headcount} head(s) logged on project ${projectId} for ${log.log_date} (cost ${totalCost})`,
            new_value: JSON.stringify(log), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Manpower logged", ManpowerLogs: log, project_costs: costs });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "addManpowerLog", err, "Failed to log Manpower");
    } finally {
        client?.release();
    }
}

export async function updateManpowerLog(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, manpowerLogId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT * FROM tbl_project_manpower_log
              WHERE manpower_log_id = $1 AND project_id = $2 AND company_id = $3 AND is_deleted = FALSE FOR UPDATE`,
            [manpowerLogId, projectId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Manpower log not found");
        const before = existing.rows[0];

        const merged = {
            headcount: payload.headcount ?? before.headcount,
            regular_hours: payload.regular_hours ?? before.regular_hours,
            overtime_hours: payload.overtime_hours ?? before.overtime_hours,
            rate_per_hour: payload.rate_per_hour ?? before.rate_per_hour,
            ot_rate_per_hour: payload.ot_rate_per_hour ?? before.ot_rate_per_hour,
        };
        validateManpowerPayload({ ...merged, log_date: before.log_date.toISOString?.().slice(0, 10) ?? before.log_date, trade_id: before.trade_id });
        const { otRate, totalCost } = computeManpowerCost(merged);

        const result = await client.query(
            `UPDATE tbl_project_manpower_log
                SET headcount = $3, regular_hours = $4, overtime_hours = $5, rate_per_hour = $6,
                    ot_rate_per_hour = $7, total_cost = $8, remarks = COALESCE($9, remarks), updated_at = CURRENT_TIMESTAMP
              WHERE manpower_log_id = $1 AND project_id = $2 RETURNING *`,
            [manpowerLogId, projectId, merged.headcount, merged.regular_hours, merged.overtime_hours,
                merged.rate_per_hour, otRate, totalCost, cleanText(payload.remarks)]
        );
        const costs = await recalcProjectCost(client, { projectId, companyId, category: "labour" });

        await logAudit(client, {
            module_name: "Manpower", page_name: "Update Manpower Log", table_name: "tbl_project_manpower_log",
            table_id: manpowerLogId, action_type: "UPDATE", action_description: "Manpower log updated",
            old_value: JSON.stringify(before), new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Manpower log updated", ManpowerLogs: result.rows[0], project_costs: costs });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "updateManpowerLog", err, "Failed to update Manpower log");
    } finally {
        client?.release();
    }
}

export async function deleteManpowerLog(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { projectId, manpowerLogId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const result = await client.query(
            `UPDATE tbl_project_manpower_log SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
              WHERE manpower_log_id = $1 AND project_id = $2 AND company_id = $3 AND is_deleted = FALSE RETURNING *`,
            [manpowerLogId, projectId, companyId]
        );
        if (result.rows.length === 0) throw httpError(404, "Manpower log not found");
        const costs = await recalcProjectCost(client, { projectId, companyId, category: "labour" });

        await logAudit(client, {
            module_name: "Manpower", page_name: "Delete Manpower Log", table_name: "tbl_project_manpower_log",
            table_id: manpowerLogId, action_type: "DELETE", action_description: "Manpower log deleted",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Manpower log deleted", ManpowerLogs: result.rows[0], project_costs: costs });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "deleteManpowerLog", err, "Failed to delete Manpower log");
    } finally {
        client?.release();
    }
}
