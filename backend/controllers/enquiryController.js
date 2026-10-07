// controllers/enquiryController.js
//
// An ENQUIRY is one specific piece of work a client is asking Teton to price
// (an RFQ, a tender, a site requirement). It belongs to a lead OR to an
// existing customer.
//
//   new -> under_review -> site_visit -> estimating -> quoted -> negotiation -> won
//                                                          \-> lost / no_bid / on_hold / cancelled
//
//   quoted  is set automatically when a quotation is linked (see enquiryService)
//   won     requires a linked quotation the customer has ACCEPTED
//   lost    requires a reason
//
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule } from "../services/commonService.js";
import { linkQuotationToEnquiry } from "../services/enquiryService.js";
import {
    ENQUIRY_DOCUMENT_TYPES, ENQUIRY_OPEN_STATUSES, ENQUIRY_STATUS_TRANSITIONS, PRIORITIES, PROJECT_TYPES,
    assertCommonFields, buildSetClause, cleanText, httpError, isValidEnquiryTransition,
    normalizeEmail, parsePaging, pickFields, sendError,
} from "../services/crmService.js";

const ENQUIRY_FIELDS = [
    "enquiry_date", "contact_name", "contact_phone", "contact_email", "enquiry_title", "project_type",
    "industry_id", "lead_source_id", "customer_ref_no", "plant_name", "project_location", "site_address",
    "scope_of_work", "is_tender", "tender_no", "submission_due_date", "prebid_meeting_date", "emd_amount",
    "site_visit_required", "site_visit_date", "expected_start_date", "expected_end_date",
    "currency_id", "estimated_value", "priority", "assigned_to", "estimator_id", "next_follow_up_date", "notes",
];
const ENQUIRY_OPTS = {
    textColumns: [
        "contact_name", "contact_phone", "enquiry_title", "customer_ref_no", "plant_name",
        "project_location", "site_address", "scope_of_work", "tender_no", "notes",
    ],
    boolColumns: ["is_tender", "site_visit_required"],
    transforms: { contact_email: normalizeEmail },
};
const DATE_FIELDS = [
    "enquiry_date", "submission_due_date", "prebid_meeting_date", "site_visit_date",
    "expected_start_date", "expected_end_date", "next_follow_up_date",
];

function validateEnquiryPayload(p, { requireTitle }) {
    if (requireTitle && !cleanText(p.enquiry_title)) throw httpError(400, "enquiry_title is required");
    if (!requireTitle && "enquiry_title" in p && !cleanText(p.enquiry_title)) {
        throw httpError(400, "enquiry_title cannot be empty");
    }
    if ("enquiry_date" in p && !p.enquiry_date) throw httpError(400, "enquiry_date cannot be empty");
    assertCommonFields(p, {
        dateFields: DATE_FIELDS,
        enumChecks: { project_type: PROJECT_TYPES, priority: PRIORITIES },
    });
}

/** Dates are YYYY-MM-DD strings, so string comparison is date comparison. */
function assertDateOrder(row) {
    const s = row.expected_start_date && String(row.expected_start_date).slice(0, 10);
    const e = row.expected_end_date && String(row.expected_end_date).slice(0, 10);
    if (s && e && e < s) throw httpError(400, "expected_end_date cannot be before expected_start_date");
}

const ENQUIRY_SELECT = `
    e.*,
    p.party_name, p.party_code,
    l.lead_no, l.company_name AS lead_company_name,
    NULLIF(TRIM(CONCAT_WS(' ', ua.first_name, ua.last_name)), '') AS assigned_to_name,
    NULLIF(TRIM(CONCAT_WS(' ', ue.first_name, ue.last_name)), '') AS estimator_name,
    ind.industry_name, ls.source_name AS lead_source_name,
    (e.submission_due_date - CURRENT_DATE) AS days_to_due,
    (SELECT COUNT(*) FROM tbl_quotation q
      WHERE q.enquiry_id = e.enquiry_id AND q.is_deleted = FALSE)::int AS quotation_count`;

const ENQUIRY_JOINS = `
    FROM tbl_enquiry e
    LEFT JOIN tbl_party p ON p.party_id = e.party_id
    LEFT JOIN tbl_lead l ON l.lead_id = e.lead_id
    LEFT JOIN users ua ON ua.user_id = e.assigned_to
    LEFT JOIN users ue ON ue.user_id = e.estimator_id
    LEFT JOIN industries ind ON ind.industry_id = e.industry_id
    LEFT JOIN lead_sources ls ON ls.lead_source_id = e.lead_source_id`;

const ENQUIRY_DETAIL_SUBQUERIES = `,
    COALESCE((SELECT json_agg(a ORDER BY a.activity_date DESC) FROM (
        SELECT activity_id, activity_type, activity_date, subject, outcome, next_follow_up_date, done_by
          FROM tbl_crm_activity
         WHERE enquiry_id = e.enquiry_id AND is_deleted = FALSE) a), '[]'::json) AS activities,
    COALESCE((SELECT json_agg(d ORDER BY d.document_id DESC) FROM (
        SELECT document_id, document_type, document_name, file_url, remarks, created_at
          FROM tbl_enquiry_documents
         WHERE enquiry_id = e.enquiry_id AND is_deleted = FALSE) d), '[]'::json) AS documents,
    COALESCE((SELECT json_agg(q ORDER BY q.quotation_id DESC) FROM (
        SELECT quotation_id, quotation_no, quotation_date, total_amount, status
          FROM tbl_quotation
         WHERE enquiry_id = e.enquiry_id AND is_deleted = FALSE) q), '[]'::json) AS quotations`;

/////////////////////////// Enquiry: read /////////////////////////////

export async function getEnquiries(req, res) {
    const { companyId } = req.user;
    const { enquiryId } = req.params;
    try {
        const companyPool = await getCompanyPool(companyId);

        if (enquiryId) {
            const result = await companyPool.query(
                `SELECT ${ENQUIRY_SELECT} ${ENQUIRY_DETAIL_SUBQUERIES} ${ENQUIRY_JOINS}
                  WHERE e.enquiry_id = $1 AND e.company_id = $2 AND e.is_deleted = FALSE`,
                [enquiryId, companyId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Enquiry not found" });
            }
            return res.status(200).json({ success: true, message: "Enquiry Fetch Successfully", Enquiries: result.rows });
        }

        const { status, partyId, leadId, assignedTo, priority, search, openOnly, dueWithinDays, tender, sort } = req.query;
        const conditions = ["e.company_id = $1", "e.is_deleted = FALSE"];
        const params = [companyId];
        const add = (sql, value) => { params.push(value); conditions.push(sql.replace("?", `$${params.length}`)); };

        if (status) add("e.status = ANY(?::text[])", String(status).split(",").map((s) => s.trim()));
        if (partyId) add("e.party_id = ?", partyId);
        if (leadId) add("e.lead_id = ?", leadId);
        if (assignedTo) add("e.assigned_to = ?", assignedTo);
        if (priority) add("e.priority = ?", priority);
        if (tender === "true") conditions.push("e.is_tender = TRUE");
        if (openOnly === "true") add("e.status = ANY(?::text[])", ENQUIRY_OPEN_STATUSES);
        if (dueWithinDays !== undefined) {
            const days = Math.max(parseInt(dueWithinDays, 10) || 0, 0);
            params.push(days);
            conditions.push(`e.submission_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $${params.length}::int`);
            conditions.push(`e.status IN ('new','under_review','site_visit','estimating')`); // not yet quoted
        }
        if (search) {
            params.push(`%${search}%`);
            const i = params.length;
            conditions.push(`(e.enquiry_title ILIKE $${i} OR e.enquiry_no ILIKE $${i} OR e.customer_ref_no ILIKE $${i}
                              OR e.tender_no ILIKE $${i} OR e.plant_name ILIKE $${i} OR p.party_name ILIKE $${i}
                              OR l.company_name ILIKE $${i})`);
        }

        const orderBy = sort === "due"
            ? "e.submission_due_date ASC NULLS LAST, e.enquiry_id DESC"
            : "e.enquiry_id DESC";
        const { limit, offset } = parsePaging(req.query);
        params.push(limit, offset);

        const result = await companyPool.query(
            `SELECT ${ENQUIRY_SELECT}, COUNT(*) OVER()::int AS total_count ${ENQUIRY_JOINS}
              WHERE ${conditions.join(" AND ")}
              ORDER BY ${orderBy}
              LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        const total = result.rows[0]?.total_count ?? 0;
        const rows = result.rows.map(({ total_count, ...row }) => row);

        return res.status(200).json({ success: true, message: "Enquiry Fetch Successfully", Enquiries: rows, total, limit, offset });
    } catch (err) {
        return sendError(res, "getEnquiries", err, "Failed to fetch Enquiries");
    }
}

/////////////////////////// Enquiry: create / update / delete /////////////////////////////

export async function createEnquiry(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.user;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        validateEnquiryPayload(payload, { requireTitle: true });
        if (!payload.lead_id && !payload.party_id) {
            throw httpError(400, "Send lead_id (a new prospect) or party_id (an existing customer)");
        }
        assertDateOrder(payload);

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        let lead = null;
        let partyId = payload.party_id ? Number(payload.party_id) : null;

        if (payload.lead_id) {
            const l = await client.query(
                `SELECT * FROM tbl_lead WHERE lead_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
                [payload.lead_id, companyId]
            );
            if (l.rows.length === 0) throw httpError(400, "lead_id does not match an existing lead");
            lead = l.rows[0];
            if (lead.status === "lost") throw httpError(400, "This lead is marked lost. Reopen it before adding an enquiry.");
            if (lead.party_id) {
                if (partyId && partyId !== Number(lead.party_id)) {
                    throw httpError(400, "party_id does not match the customer this lead was converted to");
                }
                partyId = Number(lead.party_id);
            }
        }

        if (partyId) {
            const p = await client.query(
                `SELECT party_id, party_type FROM tbl_party
                  WHERE party_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
                [partyId, companyId]
            );
            if (p.rows.length === 0) throw httpError(400, "party_id does not match an existing customer");
            if (p.rows[0].party_type === "VENDOR") throw httpError(400, "That party is a vendor, not a customer");
        }

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.ENQUIRY, companyId, userId, financialYearId, client,
        });

        const fields = pickFields(payload, ENQUIRY_FIELDS, ENQUIRY_OPTS);
        const has = (c) => fields.some(([col]) => col === c);
        const setDefault = (col, value) => { if (!has(col) && value !== undefined && value !== null) fields.push([col, value]); };

        // Carry over what we already know from the lead.
        setDefault("industry_id", lead?.industry_id);
        setDefault("lead_source_id", lead?.lead_source_id);
        setDefault("contact_name", lead?.contact_name);
        setDefault("contact_phone", lead?.phone);
        setDefault("contact_email", lead?.email);
        setDefault("assigned_to", lead?.assigned_to ?? userId);
        fields.push(
            ["enquiry_no", seriesResult.series], ["lead_id", lead?.lead_id ?? null], ["party_id", partyId],
            ["status", "new"], ["user_id", userId], ["company_id", companyId]
        );

        const result = await client.query(
            `INSERT INTO tbl_enquiry (${fields.map(([c]) => c).join(", ")})
             VALUES (${fields.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
            fields.map(([, v]) => v)
        );
        const enquiry = result.rows[0];

        // A lead that now has a concrete enquiry is, by definition, qualified.
        let leadPromoted = false;
        if (lead && ["new", "contacted"].includes(lead.status)) {
            await client.query(
                `UPDATE tbl_lead SET status = 'qualified', updated_at = CURRENT_TIMESTAMP WHERE lead_id = $1`,
                [lead.lead_id]
            );
            leadPromoted = true;
        }

        await logAudit(client, {
            module_name: "Enquiry", page_name: "Create Enquiry", table_name: "tbl_enquiry", table_id: enquiry.enquiry_id,
            action_type: "CREATE",
            action_description: `Enquiry Created Successfully :${enquiry.enquiry_no}${leadPromoted ? " (lead marked qualified)" : ""}`,
            new_value: JSON.stringify(enquiry), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Enquiry created", Enquiries: enquiry, lead_marked_qualified: leadPromoted });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "createEnquiry", err, "Failed to Create Enquiry");
    } finally {
        client?.release();
    }
}

/** lead_id and party_id are fixed at creation; everything else can be edited. */
export async function updateEnquiry(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { enquiryId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        validateEnquiryPayload(payload, { requireTitle: false });

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT *, expected_start_date::text AS start_text, expected_end_date::text AS end_text
               FROM tbl_enquiry WHERE enquiry_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [enquiryId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Enquiry not found");
        const { start_text, end_text, ...before } = existing.rows[0];
        if (["won", "cancelled"].includes(before.status)) {
            throw httpError(400, `Enquiry cannot be updated because its status is '${before.status}'`);
        }

        const pairs = pickFields(payload, ENQUIRY_FIELDS, ENQUIRY_OPTS);
        if (pairs.length === 0) throw httpError(400, "No updatable fields were sent");
        assertDateOrder({ expected_start_date: start_text, expected_end_date: end_text, ...Object.fromEntries(pairs) });
        const { setSql, values } = buildSetClause(pairs);

        const result = await client.query(
            `UPDATE tbl_enquiry SET ${setSql}, updated_at = CURRENT_TIMESTAMP
              WHERE enquiry_id = $${values.length + 1} AND company_id = $${values.length + 2}
              RETURNING *`,
            [...values, enquiryId, companyId]
        );

        await logAudit(client, {
            module_name: "Enquiry", page_name: "Update Enquiry", table_name: "tbl_enquiry", table_id: enquiryId,
            action_type: "UPDATE", action_description: "Enquiry Updated Successfully",
            old_value: JSON.stringify(before), new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Enquiry Updated", Enquiries: result.rows[0] });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "updateEnquiry", err, "Failed to Update Enquiry");
    } finally {
        client?.release();
    }
}

export async function deleteEnquiry(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { enquiryId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT enquiry_id, status FROM tbl_enquiry
              WHERE enquiry_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [enquiryId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Enquiry not found");
        if (existing.rows[0].status === "won") {
            throw httpError(409, "A won enquiry is the record behind a contract and cannot be deleted");
        }
        const q = await client.query(
            `SELECT COUNT(*)::int AS n FROM tbl_quotation
              WHERE enquiry_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [enquiryId, companyId]
        );
        if (q.rows[0].n > 0) {
            throw httpError(409, `This enquiry has ${q.rows[0].n} quotation(s) linked to it. Delete those first.`);
        }

        const result = await deleteModule(client, "tbl_enquiry", "enquiry_id", enquiryId, { company_id: companyId });
        await deleteModule(client, "tbl_crm_activity", "enquiry_id", enquiryId, { company_id: companyId });
        await deleteModule(client, "tbl_enquiry_documents", "enquiry_id", enquiryId, { company_id: companyId });

        await logAudit(client, {
            module_name: "Enquiry", page_name: "Delete Enquiry", table_name: "tbl_enquiry", table_id: enquiryId,
            action_type: "DELETE", action_description: "Enquiry Deleted Successfully",
            new_value: JSON.stringify(result.result), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Enquiry Deleted", Enquiries: result.result });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "deleteEnquiry", err, "Failed to Delete Enquiry");
    } finally {
        client?.release();
    }
}

/////////////////////////// Enquiry: status /////////////////////////////

export async function changeEnquiryStatus(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { enquiryId, status } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        if (!Object.keys(ENQUIRY_STATUS_TRANSITIONS).includes(status)) {
            throw httpError(400, `Invalid enquiry status: ${status}`);
        }
        const lostReason = cleanText(req.body?.lost_reason);
        const competitor = cleanText(req.body?.competitor_name);
        if (status === "lost" && !lostReason) {
            throw httpError(400, "lost_reason is required when marking an enquiry as lost");
        }

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT * FROM tbl_enquiry WHERE enquiry_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [enquiryId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Enquiry not found");
        const enquiry = existing.rows[0];

        if (enquiry.status === status) throw httpError(400, `Enquiry is already ${status}`);
        if (!isValidEnquiryTransition(enquiry.status, status)) {
            throw httpError(400, `Enquiry status cannot be changed from '${enquiry.status}' to '${status}'`);
        }

        if (status === "quoted" || status === "won") {
            const qs = await client.query(
                `SELECT status FROM tbl_quotation
                  WHERE enquiry_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
                [enquiryId, companyId]
            );
            if (qs.rows.length === 0) {
                throw httpError(400, `An enquiry needs a linked quotation before it can be '${status}'. Create one with this enquiry_id, or link an existing one.`);
            }
            if (status === "won" && !qs.rows.some((q) => q.status === "accepted")) {
                throw httpError(400, "To mark an enquiry as won, at least one linked quotation must be accepted by the customer.");
            }
        }

        const isTerminal = ["won", "lost", "no_bid", "cancelled"].includes(status);
        const result = await client.query(
            `UPDATE tbl_enquiry
                SET status = $3, lost_reason = $4, competitor_name = $5,
                    next_follow_up_date = CASE WHEN $6::boolean THEN NULL ELSE next_follow_up_date END,
                    updated_at = CURRENT_TIMESTAMP
              WHERE enquiry_id = $1 AND company_id = $2 RETURNING *`,
            [enquiryId, companyId, status, status === "lost" ? lostReason : null, status === "lost" ? competitor : null, isTerminal]
        );

        await logAudit(client, {
            module_name: "Enquiry", page_name: "Enquiry Status", table_name: "tbl_enquiry", table_id: enquiryId,
            action_type: "STATUS_CHANGE", action_description: `Enquiry status changed from ${enquiry.status} to ${status}`,
            old_value: JSON.stringify(enquiry), new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({
            success: true, message: `Enquiry status changed from '${enquiry.status}' to '${status}'`, Enquiries: result.rows[0],
        });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "changeEnquiryStatus", err, "Failed to change status of Enquiry");
    } finally {
        client?.release();
    }
}

/** Link an existing quotation to this enquiry (createQuotation does it automatically when enquiry_id is sent). */
export async function linkQuotation(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { enquiryId, quotationId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const { enquiry, movedToQuoted } = await linkQuotationToEnquiry(client, { enquiryId, quotationId, companyId });

        await logAudit(client, {
            module_name: "Enquiry", page_name: "Link Quotation", table_name: "tbl_enquiry", table_id: enquiryId,
            action_type: "UPDATE",
            action_description: `Quotation ${quotationId} linked to enquiry ${enquiry.enquiry_no}${movedToQuoted ? " (status -> quoted)" : ""}`,
            new_value: JSON.stringify(enquiry), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Quotation linked to enquiry", Enquiries: enquiry, moved_to_quoted: movedToQuoted });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "linkQuotation", err, "Failed to link Quotation");
    } finally {
        client?.release();
    }
}

/////////////////////////// Enquiry documents (RFQ, drawings, specs, ...) /////////////////////////////

export async function getEnquiryDocuments(req, res) {
    const { companyId } = req.user;
    const { enquiryId } = req.params;
    try {
        const companyPool = await getCompanyPool(companyId);
        const result = await companyPool.query(
            `SELECT * FROM tbl_enquiry_documents
              WHERE enquiry_id = $1 AND company_id = $2 AND is_deleted = FALSE ORDER BY created_at DESC`,
            [enquiryId, companyId]
        );
        return res.status(200).json({ success: true, message: "Documents Fetch Successfully", Documents: result.rows });
    } catch (err) {
        return sendError(res, "getEnquiryDocuments", err, "Failed to fetch Documents");
    }
}

export async function addEnquiryDocument(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { enquiryId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const p = req.body || {};
        if (!cleanText(p.document_name)) throw httpError(400, "document_name is required");
        if (!cleanText(p.file_url)) throw httpError(400, "file_url is required");
        const type = p.document_type ?? "other";
        if (!ENQUIRY_DOCUMENT_TYPES.includes(type)) {
            throw httpError(400, `document_type must be one of: ${ENQUIRY_DOCUMENT_TYPES.join(", ")}`);
        }

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const parent = await client.query(
            `SELECT enquiry_id FROM tbl_enquiry WHERE enquiry_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [enquiryId, companyId]
        );
        if (parent.rows.length === 0) throw httpError(404, "Enquiry not found");

        const result = await client.query(
            `INSERT INTO tbl_enquiry_documents (enquiry_id, document_type, document_name, file_url, remarks, uploaded_by, user_id, company_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [enquiryId, type, cleanText(p.document_name), cleanText(p.file_url), cleanText(p.remarks), userId, userId, companyId]
        );

        await logAudit(client, {
            module_name: "Enquiry", page_name: "Add Document", table_name: "tbl_enquiry_documents",
            table_id: result.rows[0].document_id, action_type: "CREATE",
            action_description: `Document '${result.rows[0].document_name}' added to enquiry ${enquiryId}`,
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Document Added", Document: result.rows[0] });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "addEnquiryDocument", err, "Failed to add Document");
    } finally {
        client?.release();
    }
}

export async function deleteEnquiryDocument(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { enquiryId, documentId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const result = await deleteModule(client, "tbl_enquiry_documents", "document_id", documentId,
            { enquiry_id: enquiryId, company_id: companyId });
        if (result.result.length === 0) throw httpError(404, "Document not found");

        await logAudit(client, {
            module_name: "Enquiry", page_name: "Delete Document", table_name: "tbl_enquiry_documents", table_id: documentId,
            action_type: "DELETE", action_description: "Document Deleted Successfully",
            new_value: JSON.stringify(result.result), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Document Deleted", Document: result.result });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "deleteEnquiryDocument", err, "Failed to delete Document");
    } finally {
        client?.release();
    }
}
