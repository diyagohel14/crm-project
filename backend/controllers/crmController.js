// controllers/crmController.js
//
// Things shared by leads and enquiries:
//   * the two CRM masters that had no API yet (lead sources, industries)
//   * activities (call / meeting / email / site visit / note)
//   * the follow-up list: "what do I need to chase today?"
//
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import {
    ACTIVITY_TYPES, ENQUIRY_OPEN_STATUSES, LEAD_OPEN_STATUSES,
    assertCommonFields, cleanText, httpError, sendError,
} from "../services/crmService.js";

/////////////////////////// Masters /////////////////////////////
// These tables live inside each company's own database, so they have no
// company_id column.

function masterHandlers({ table, idCol, nameCol, label, listKey }) {
    return {
        async list(req, res) {
            try {
                const companyPool = await getCompanyPool(req.user.companyId);
                const result = await companyPool.query(
                    `SELECT ${idCol}, ${nameCol}, status FROM ${table} WHERE status = 'active' ORDER BY ${nameCol}`
                );
                return res.status(200).json({ success: true, message: `${label} Fetch Successfully`, [listKey]: result.rows });
            } catch (err) {
                return sendError(res, `get${label}`, err, `Failed to fetch ${label}`);
            }
        },

        async create(req, res) {
            const { companyId, userId, roleId } = req.user;
            const { ipAddress, deviceInfo } = getRequestInfo(req);
            let client;
            try {
                const name = cleanText(req.body?.[nameCol]);
                if (!name) throw httpError(400, `${nameCol} is required`);

                const companyPool = await getCompanyPool(companyId);
                client = await companyPool.connect();
                await client.query("BEGIN");

                const dup = await client.query(
                    `SELECT ${idCol} FROM ${table} WHERE LOWER(${nameCol}) = LOWER($1)`, [name]
                );
                if (dup.rows.length) throw httpError(409, `${label} '${name}' already exists`);

                const result = await client.query(
                    `INSERT INTO ${table} (${nameCol}) VALUES ($1) RETURNING *`, [name]
                );

                await logAudit(client, {
                    module_name: "CRM Master", page_name: `Create ${label}`, table_name: table,
                    table_id: result.rows[0][idCol], action_type: "CREATE",
                    action_description: `${label} '${name}' created`, new_value: JSON.stringify(result.rows[0]),
                    user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
                });

                await client.query("COMMIT");
                return res.status(201).json({ success: true, message: `${label} created`, [listKey]: result.rows[0] });
            } catch (err) {
                if (client) await client.query("ROLLBACK").catch(() => { });
                return sendError(res, `create${label}`, err, `Failed to create ${label}`);
            } finally {
                client?.release();
            }
        },
    };
}

const leadSources = masterHandlers({
    table: "lead_sources", idCol: "lead_source_id", nameCol: "source_name", label: "Lead Source", listKey: "LeadSources",
});
const industries = masterHandlers({
    table: "industries", idCol: "industry_id", nameCol: "industry_name", label: "Industry", listKey: "Industries",
});

export const getLeadSources = leadSources.list;
export const createLeadSource = leadSources.create;
export const getIndustries = industries.list;
export const createIndustry = industries.create;

/////////////////////////// Activities /////////////////////////////

const KIND = {
    lead: { table: "tbl_lead", idCol: "lead_id", param: "leadId", label: "Lead" },
    enquiry: { table: "tbl_enquiry", idCol: "enquiry_id", param: "enquiryId", label: "Enquiry" },
};
const TERMINAL = {
    lead: ["lost", "converted"],
    enquiry: ["won", "lost", "no_bid", "cancelled"],
};

async function listActivities(req, res, kind) {
    const { companyId } = req.user;
    const k = KIND[kind];
    try {
        const companyPool = await getCompanyPool(companyId);
        const parentId = req.params[k.param];
        const parent = await companyPool.query(
            `SELECT ${k.idCol} FROM ${k.table} WHERE ${k.idCol} = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [parentId, companyId]
        );
        if (parent.rows.length === 0) {
            return res.status(404).json({ success: false, error: `${k.label} not found` });
        }
        const result = await companyPool.query(
            `SELECT a.*, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS done_by_name
               FROM tbl_crm_activity a LEFT JOIN users u ON u.user_id = a.done_by
              WHERE a.${k.idCol} = $1 AND a.company_id = $2 AND a.is_deleted = FALSE
              ORDER BY a.activity_date DESC, a.activity_id DESC`,
            [parentId, companyId]
        );
        return res.status(200).json({ success: true, message: "Activities Fetch Successfully", Activities: result.rows });
    } catch (err) {
        return sendError(res, `get${k.label}Activities`, err, "Failed to fetch Activities");
    }
}

/**
 * Logs an activity and rolls two things up onto the parent:
 *   next_follow_up_date  what the user planned next (empty = nothing planned)
 *   for leads: last_contacted_at, and new -> contacted on the first real contact
 */
async function addActivity(req, res, kind) {
    const { companyId, userId, roleId } = req.user;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    const k = KIND[kind];
    let client;
    try {
        const p = req.body || {};
        const type = p.activity_type ?? "note";
        if (!ACTIVITY_TYPES.includes(type)) {
            throw httpError(400, `activity_type must be one of: ${ACTIVITY_TYPES.join(", ")}`);
        }
        if (!cleanText(p.subject) && !cleanText(p.outcome)) {
            throw httpError(400, "Give the activity a subject or an outcome");
        }
        assertCommonFields(p, { dateFields: ["next_follow_up_date"] });
        let activityDate = null;
        if (p.activity_date) {
            activityDate = new Date(p.activity_date);
            if (Number.isNaN(activityDate.getTime())) throw httpError(400, "activity_date is not a valid date/time");
        }

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const parentId = req.params[k.param];
        const parentRes = await client.query(
            `SELECT * FROM ${k.table} WHERE ${k.idCol} = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [parentId, companyId]
        );
        if (parentRes.rows.length === 0) throw httpError(404, `${k.label} not found`);
        const parent = parentRes.rows[0];
        const isTerminal = TERMINAL[kind].includes(parent.status);

        const ins = await client.query(
            `INSERT INTO tbl_crm_activity
               (${k.idCol}, activity_type, activity_date, subject, outcome, next_follow_up_date, done_by, user_id, company_id)
             VALUES ($1,$2,COALESCE($3, CURRENT_TIMESTAMP),$4,$5,$6,$7,$8,$9) RETURNING *`,
            [parentId, type, activityDate, cleanText(p.subject), cleanText(p.outcome),
                cleanText(p.next_follow_up_date), p.done_by || userId, userId, companyId]
        );
        const activity = ins.rows[0];

        // A closed lead/enquiry must not keep showing up in follow-ups.
        const nextFollowUp = isTerminal ? null : cleanText(p.next_follow_up_date);
        let parentSql = `next_follow_up_date = $2, updated_at = CURRENT_TIMESTAMP`;
        if (kind === "lead" && type !== "note") {
            parentSql += `, last_contacted_at = $3`;
            if (parent.status === "new") parentSql += `, status = 'contacted'`;
        }
        const parentParams = [parentId, nextFollowUp];
        if (kind === "lead" && type !== "note") parentParams.push(activity.activity_date);
        await client.query(`UPDATE ${k.table} SET ${parentSql} WHERE ${k.idCol} = $1`, parentParams);

        await logAudit(client, {
            module_name: k.label, page_name: "Add Activity", table_name: "tbl_crm_activity", table_id: activity.activity_id,
            action_type: "CREATE", action_description: `${type} logged on ${k.label.toLowerCase()} ${parentId}`,
            new_value: JSON.stringify(activity), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Activity logged", Activity: activity });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, `add${k.label}Activity`, err, "Failed to log Activity");
    } finally {
        client?.release();
    }
}

export const getLeadActivities = (req, res) => listActivities(req, res, "lead");
export const addLeadActivity = (req, res) => addActivity(req, res, "lead");
export const getEnquiryActivities = (req, res) => listActivities(req, res, "enquiry");
export const addEnquiryActivity = (req, res) => addActivity(req, res, "enquiry");

/////////////////////////// Follow-ups /////////////////////////////

/**
 * GET /api/crm/follow-ups
 *   scope      due (default: overdue + today) | overdue | today | upcoming
 *   days       for scope=upcoming, how far ahead (default 7)
 *   mine=true  only items assigned to me   |  assignedTo=<user_id>
 */
export async function getFollowUps(req, res) {
    const { companyId, userId } = req.user;
    try {
        const scope = req.query.scope ?? "due";
        if (!["due", "overdue", "today", "upcoming"].includes(scope)) {
            throw httpError(400, "scope must be one of: due, overdue, today, upcoming");
        }
        const assignee = req.query.mine === "true" ? userId : (req.query.assignedTo ? Number(req.query.assignedTo) : null);
        if (req.query.assignedTo && !Number.isInteger(assignee)) throw httpError(400, "assignedTo must be a user id");

        // Postgres rejects bind parameters the SQL never references, so only
        // add the ones this particular request needs.
        const params = [companyId, LEAD_OPEN_STATUSES, ENQUIRY_OPEN_STATUSES];
        const dateConds = [];
        if (scope === "due") dateConds.push("f.next_follow_up_date <= CURRENT_DATE");
        if (scope === "overdue") dateConds.push("f.next_follow_up_date < CURRENT_DATE");
        if (scope === "today") dateConds.push("f.next_follow_up_date = CURRENT_DATE");
        if (scope === "upcoming") {
            const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
            params.push(days);
            dateConds.push(`f.next_follow_up_date > CURRENT_DATE AND f.next_follow_up_date <= CURRENT_DATE + $${params.length}::int`);
        }
        if (assignee) {
            params.push(assignee);
            dateConds.push(`f.assigned_to = $${params.length}`);
        }

        const companyPool = await getCompanyPool(companyId);
        const result = await companyPool.query(
            `SELECT f.kind, f.id, f.doc_no, f.title, f.status, f.priority, f.assigned_to,
                    NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS assigned_to_name,
                    to_char(f.next_follow_up_date, 'YYYY-MM-DD') AS next_follow_up_date,
                    (CURRENT_DATE - f.next_follow_up_date) AS days_overdue
               FROM (
                    SELECT 'lead'::text AS kind, l.lead_id AS id, l.lead_no AS doc_no, l.company_name AS title,
                           l.status, l.rating AS priority, l.assigned_to, l.next_follow_up_date
                      FROM tbl_lead l
                     WHERE l.company_id = $1 AND l.is_deleted = FALSE AND l.next_follow_up_date IS NOT NULL
                       AND l.status = ANY($2::text[])
                    UNION ALL
                    SELECT 'enquiry'::text, e.enquiry_id, e.enquiry_no, e.enquiry_title,
                           e.status, e.priority, e.assigned_to, e.next_follow_up_date
                      FROM tbl_enquiry e
                     WHERE e.company_id = $1 AND e.is_deleted = FALSE AND e.next_follow_up_date IS NOT NULL
                       AND e.status = ANY($3::text[])
               ) f
               LEFT JOIN users u ON u.user_id = f.assigned_to
              WHERE ${dateConds.join(" AND ")}
              ORDER BY f.next_follow_up_date ASC, f.kind, f.id`,
            params
        );

        return res.status(200).json({ success: true, message: "Follow-ups Fetch Successfully", scope, FollowUps: result.rows });
    } catch (err) {
        return sendError(res, "getFollowUps", err, "Failed to fetch Follow-ups");
    }
}
