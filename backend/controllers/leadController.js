// controllers/leadController.js
//
// A LEAD is a prospective client that is not yet in tbl_party.
//   new -> contacted -> qualified -> (convert) -> converted   [creates a CUSTOMER]
//                     \-> lost  (with a reason; can be reopened)
//
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { addParty } from "../services/partyService.js";
import { deleteModule } from "../services/commonService.js";
import {
    LEAD_RATINGS, LEAD_STATUS_TRANSITIONS,
    assertCommonFields, buildSetClause, cleanText, httpError, isValidLeadTransition,
    normalizeEmail, normalizePhone, parsePaging, pickFields, sendError,
} from "../services/crmService.js";

// Columns a client may set through POST / PUT. Status, lead_no, party_id and
// the conversion fields are controlled by the server only.
const LEAD_FIELDS = [
    "company_name", "contact_name", "designation", "phone", "email", "website", "gst_no",
    "industry_id", "lead_source_id", "referred_by",
    "address_line1", "address_line2", "city_id", "state_id", "country_id", "pincode",
    "assigned_to", "rating", "estimated_value", "next_follow_up_date", "notes",
];
const LEAD_TEXT = [
    "company_name", "contact_name", "designation", "phone", "website", "referred_by",
    "address_line1", "address_line2", "pincode", "notes",
];
const LEAD_TRANSFORMS = {
    email: normalizeEmail,
    gst_no: (v) => cleanText(v)?.toUpperCase() ?? null,
};
const LEAD_OPTS = { textColumns: LEAD_TEXT, transforms: LEAD_TRANSFORMS };

function validateLeadPayload(p, { requireName }) {
    if (requireName && !cleanText(p.company_name)) {
        throw httpError(400, "company_name is required");
    }
    if (!requireName && "company_name" in p && !cleanText(p.company_name)) {
        throw httpError(400, "company_name cannot be empty");
    }
    assertCommonFields(p, {
        dateFields: ["next_follow_up_date"],
        enumChecks: { rating: LEAD_RATINGS },
    });
}

const LEAD_SELECT = `
    l.*,
    NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS assigned_to_name,
    ls.source_name AS lead_source_name,
    ind.industry_name,
    (SELECT COUNT(*) FROM tbl_enquiry e
      WHERE e.lead_id = l.lead_id AND e.is_deleted = FALSE)::int AS enquiry_count`;

const LEAD_JOINS = `
    FROM tbl_lead l
    LEFT JOIN users u ON u.user_id = l.assigned_to
    LEFT JOIN lead_sources ls ON ls.lead_source_id = l.lead_source_id
    LEFT JOIN industries ind ON ind.industry_id = l.industry_id`;

const LEAD_DETAIL_SUBQUERIES = `,
    COALESCE((SELECT json_agg(a ORDER BY a.activity_date DESC) FROM (
        SELECT activity_id, activity_type, activity_date, subject, outcome, next_follow_up_date, done_by
          FROM tbl_crm_activity
         WHERE lead_id = l.lead_id AND is_deleted = FALSE) a), '[]'::json) AS activities,
    COALESCE((SELECT json_agg(e ORDER BY e.enquiry_id DESC) FROM (
        SELECT enquiry_id, enquiry_no, enquiry_title, status, submission_due_date
          FROM tbl_enquiry
         WHERE lead_id = l.lead_id AND is_deleted = FALSE) e), '[]'::json) AS enquiries`;

/** Existing leads / customers that look like the same company. */
async function findDuplicates(db, companyId, { phone, email, gst_no }, excludeLeadId = null) {
    const p = normalizePhone(phone);
    const e = normalizeEmail(email);
    const g = cleanText(gst_no)?.toUpperCase() ?? null;
    if (!p && !e && !g) return { leads: [], parties: [] };

    const leads = await db.query(
        `SELECT lead_id, lead_no, company_name, status
           FROM tbl_lead
          WHERE company_id = $1 AND is_deleted = FALSE AND lead_id <> COALESCE($5, -1)
            AND ( ($2::text IS NOT NULL AND right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = $2)
               OR ($3::text IS NOT NULL AND LOWER(email) = $3)
               OR ($4::text IS NOT NULL AND UPPER(gst_no) = $4) )
          LIMIT 5`,
        [companyId, p, e, g, excludeLeadId]
    );
    const parties = await db.query(
        `SELECT party_id, party_code, party_name, party_type
           FROM tbl_party
          WHERE company_id = $1 AND is_deleted = FALSE
            AND ( ($2::text IS NOT NULL AND right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = $2)
               OR ($3::text IS NOT NULL AND LOWER(email) = $3)
               OR ($4::text IS NOT NULL AND UPPER(gst_no) = $4) )
          LIMIT 5`,
        [companyId, p, e, g]
    );
    return { leads: leads.rows, parties: parties.rows };
}

/////////////////////////// Lead: read /////////////////////////////

export async function getLeads(req, res) {
    const { companyId } = req.user;
    const { leadId } = req.params;
    try {
        const companyPool = await getCompanyPool(companyId);

        if (leadId) {
            const result = await companyPool.query(
                `SELECT ${LEAD_SELECT} ${LEAD_DETAIL_SUBQUERIES} ${LEAD_JOINS}
                  WHERE l.lead_id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE`,
                [leadId, companyId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Lead not found" });
            }
            return res.status(200).json({ success: true, message: "Lead Fetch Successfully", Leads: result.rows });
        }

        const { status, assignedTo, rating, search, followUp } = req.query;
        const conditions = ["l.company_id = $1", "l.is_deleted = FALSE"];
        const params = [companyId];
        const add = (sql, value) => { params.push(value); conditions.push(sql.replace("?", `$${params.length}`)); };

        if (status) add("l.status = ?", status);
        if (assignedTo) add("l.assigned_to = ?", assignedTo);
        if (rating) add("l.rating = ?", rating);
        if (search) {
            params.push(`%${search}%`);
            const i = params.length;
            conditions.push(`(l.company_name ILIKE $${i} OR l.contact_name ILIKE $${i} OR l.phone ILIKE $${i}
                              OR l.email ILIKE $${i} OR l.lead_no ILIKE $${i})`);
        }
        if (followUp === "overdue") {
            conditions.push(`l.next_follow_up_date < CURRENT_DATE AND l.status IN ('new','contacted','qualified')`);
        } else if (followUp === "today") {
            conditions.push(`l.next_follow_up_date = CURRENT_DATE AND l.status IN ('new','contacted','qualified')`);
        }

        const { limit, offset } = parsePaging(req.query);
        params.push(limit, offset);

        const result = await companyPool.query(
            `SELECT ${LEAD_SELECT}, COUNT(*) OVER()::int AS total_count ${LEAD_JOINS}
              WHERE ${conditions.join(" AND ")}
              ORDER BY l.lead_id DESC
              LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        const total = result.rows[0]?.total_count ?? 0;
        const rows = result.rows.map(({ total_count, ...row }) => row);

        return res.status(200).json({ success: true, message: "Lead Fetch Successfully", Leads: rows, total, limit, offset });
    } catch (err) {
        return sendError(res, "getLeads", err, "Failed to fetch Leads");
    }
}

/////////////////////////// Lead: create / update / delete /////////////////////////////

export async function createLead(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.user;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        validateLeadPayload(payload, { requireName: true });

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        if (payload.allow_duplicate !== true) {
            const dupes = await findDuplicates(client, companyId, payload);
            if (dupes.leads.length || dupes.parties.length) {
                throw httpError(409,
                    "A lead or customer with the same phone, email or GSTIN already exists. Send allow_duplicate: true to create it anyway.",
                    { duplicates: dupes });
            }
        }

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.LEAD, companyId, userId, financialYearId, client,
        });

        const fields = pickFields(payload, LEAD_FIELDS, LEAD_OPTS);
        if (!fields.some(([c]) => c === "assigned_to")) fields.push(["assigned_to", userId]);
        if (!fields.some(([c]) => c === "rating")) fields.push(["rating", "warm"]);
        fields.push(["lead_no", seriesResult.series], ["status", "new"], ["user_id", userId], ["company_id", companyId]);

        const result = await client.query(
            `INSERT INTO tbl_lead (${fields.map(([c]) => c).join(", ")})
             VALUES (${fields.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
            fields.map(([, v]) => v)
        );
        const lead = result.rows[0];

        await logAudit(client, {
            module_name: "Lead", page_name: "Create Lead", table_name: "tbl_lead", table_id: lead.lead_id,
            action_type: "CREATE", action_description: `Lead Created Successfully :${lead.lead_no}`,
            new_value: JSON.stringify(lead), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(201).json({ success: true, message: "Lead created", Leads: lead });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "createLead", err, "Failed to Create Lead");
    } finally {
        client?.release();
    }
}

export async function updateLead(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { leadId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        validateLeadPayload(payload, { requireName: false });

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT * FROM tbl_lead WHERE lead_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [leadId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Lead not found");
        if (existing.rows[0].status === "converted") {
            throw httpError(400, "This lead is already a customer. Edit the customer record instead.");
        }

        const pairs = pickFields(payload, LEAD_FIELDS, LEAD_OPTS);
        if (pairs.length === 0) throw httpError(400, "No updatable fields were sent");
        const { setSql, values } = buildSetClause(pairs);

        const result = await client.query(
            `UPDATE tbl_lead SET ${setSql}, updated_at = CURRENT_TIMESTAMP
              WHERE lead_id = $${values.length + 1} AND company_id = $${values.length + 2}
              RETURNING *`,
            [...values, leadId, companyId]
        );

        await logAudit(client, {
            module_name: "Lead", page_name: "Update Lead", table_name: "tbl_lead", table_id: leadId,
            action_type: "UPDATE", action_description: "Lead Updated Successfully",
            old_value: JSON.stringify(existing.rows[0]), new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Lead Updated", Leads: result.rows[0] });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "updateLead", err, "Failed to Update Lead");
    } finally {
        client?.release();
    }
}

export async function deleteLead(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { leadId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT lead_id, status FROM tbl_lead WHERE lead_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [leadId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Lead not found");
        if (existing.rows[0].status === "converted") {
            throw httpError(409, "A converted lead is the history of a customer and cannot be deleted");
        }

        const enq = await client.query(
            `SELECT COUNT(*)::int AS n FROM tbl_enquiry WHERE lead_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [leadId, companyId]
        );
        if (enq.rows[0].n > 0) {
            throw httpError(409, `This lead has ${enq.rows[0].n} enquiry(ies). Delete or move them first.`);
        }

        const result = await deleteModule(client, "tbl_lead", "lead_id", leadId, { company_id: companyId });
        await deleteModule(client, "tbl_crm_activity", "lead_id", leadId, { company_id: companyId });

        await logAudit(client, {
            module_name: "Lead", page_name: "Delete Lead", table_name: "tbl_lead", table_id: leadId,
            action_type: "DELETE", action_description: "Lead Deleted Successfully",
            new_value: JSON.stringify(result.result), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: "Lead Deleted", Leads: result.result });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "deleteLead", err, "Failed to Delete Lead");
    } finally {
        client?.release();
    }
}

/////////////////////////// Lead: status /////////////////////////////

export async function changeLeadStatus(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { leadId, status } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        if (status === "converted") {
            throw httpError(400, "Use POST /lead/:leadId/convert to convert a lead. That is what creates the customer.");
        }
        if (!Object.keys(LEAD_STATUS_TRANSITIONS).includes(status)) {
            throw httpError(400, `Invalid lead status: ${status}`);
        }
        const lostReason = cleanText(req.body?.lost_reason);
        if (status === "lost" && !lostReason) {
            throw httpError(400, "lost_reason is required when marking a lead as lost");
        }

        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT * FROM tbl_lead WHERE lead_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [leadId, companyId]
        );
        if (existing.rows.length === 0) throw httpError(404, "Lead not found");
        const lead = existing.rows[0];

        if (lead.status === status) throw httpError(400, `Lead is already ${status}`);
        if (!isValidLeadTransition(lead.status, status)) {
            throw httpError(400, `Lead status cannot be changed from '${lead.status}' to '${status}'`);
        }

        const result = await client.query(
            `UPDATE tbl_lead
                SET status = $3,
                    lost_reason = $4,
                    next_follow_up_date = CASE WHEN $5::boolean THEN NULL ELSE next_follow_up_date END,
                    updated_at = CURRENT_TIMESTAMP
              WHERE lead_id = $1 AND company_id = $2 RETURNING *`,
            [leadId, companyId, status, status === "lost" ? lostReason : null, status === "lost"]
        );

        await logAudit(client, {
            module_name: "Lead", page_name: "Lead Status", table_name: "tbl_lead", table_id: leadId,
            action_type: "STATUS_CHANGE", action_description: `Lead status changed from ${lead.status} to ${status}`,
            old_value: JSON.stringify(lead), new_value: JSON.stringify(result.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({
            success: true, message: `Lead status changed from '${lead.status}' to '${status}'`, Leads: result.rows[0],
        });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "changeLeadStatus", err, "Failed to change status of Lead");
    } finally {
        client?.release();
    }
}

/////////////////////////// Lead: convert to customer /////////////////////////////

/**
 * Turns a lead into a customer (tbl_party, type CUSTOMER) and hands its
 * enquiries over to that customer, which is what makes them quotable.
 *
 * Body (all optional):
 *   party_id          link to an EXISTING customer instead of creating one
 *   party             overrides for the new customer: party_name, gst_no,
 *                     pan_no, currency_id, addresses[], contactPersons[]
 *   allow_duplicate   create even if the GSTIN already exists
 */
export async function convertLead(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.user;
    const { leadId } = req.params;
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let client;
    try {
        const payload = req.body || {};
        const companyPool = await getCompanyPool(companyId);
        client = await companyPool.connect();
        await client.query("BEGIN");

        const leadRes = await client.query(
            `SELECT * FROM tbl_lead WHERE lead_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [leadId, companyId]
        );
        if (leadRes.rows.length === 0) throw httpError(404, "Lead not found");
        const lead = leadRes.rows[0];

        if (lead.status === "converted") {
            throw httpError(400, "This lead is already converted", { party_id: lead.party_id });
        }
        if (lead.status === "lost") {
            throw httpError(400, "This lead is marked lost. Reopen it before converting.");
        }

        let partyId;
        let createdParty = null;

        if (payload.party_id) {
            const p = await client.query(
                `SELECT party_id, party_type FROM tbl_party
                  WHERE party_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
                [payload.party_id, companyId]
            );
            if (p.rows.length === 0) throw httpError(400, "party_id does not match an existing customer");
            if (p.rows[0].party_type === "VENDOR") {
                throw httpError(400, "That party is a vendor only. Change its type to BOTH first, or create a new customer.");
            }
            partyId = p.rows[0].party_id;
        } else {
            const o = payload.party || {};
            const gst = cleanText(o.gst_no ?? lead.gst_no)?.toUpperCase() ?? null;

            if (gst && payload.allow_duplicate !== true) {
                const dup = await client.query(
                    `SELECT party_id, party_code, party_name, party_type FROM tbl_party
                      WHERE company_id = $1 AND is_deleted = FALSE AND UPPER(gst_no) = $2 LIMIT 5`,
                    [companyId, gst]
                );
                if (dup.rows.length) {
                    throw httpError(409,
                        "A party with this GSTIN already exists. Send its id as party_id to link to it, or allow_duplicate: true to create a new one.",
                        { existing_parties: dup.rows });
                }
            }

            const leadAddress = lead.address_line1 ? [{
                address_type: "both", address_label: "Head office",
                address_line1: lead.address_line1, address_line2: lead.address_line2,
                city_id: lead.city_id, state_id: lead.state_id, country_id: lead.country_id, pincode: lead.pincode,
            }] : [];
            const leadContact = lead.contact_name
                ? [{ name: lead.contact_name, email: lead.email, phone: lead.phone }] : [];
// ?? o.contact_name
            createdParty = await addParty({
                party_type: "CUSTOMER",
                party_name: cleanText(o.party_name) ?? lead.company_name,
                email: o.email ?? lead.email,
                phone: o.phone ?? lead.phone,
                gst_no: gst,
                pan_no: o.pan_no ?? null,
                website: o.website ?? lead.website,
                notes: o.notes ?? lead.notes,
                currency_id: o.currency_id ?? null,
                addresses: Array.isArray(o.addresses) ? o.addresses : leadAddress,
                contactPersons: Array.isArray(o.contactPersons) ? o.contactPersons : leadContact,
            }, companyId, userId, financialYearId, { client });
            partyId = createdParty.basic.party_id;
        }

        const upd = await client.query(
            `UPDATE tbl_lead
                SET status = 'converted', party_id = $3, converted_at = CURRENT_TIMESTAMP,
                    lost_reason = NULL, next_follow_up_date = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE lead_id = $1 AND company_id = $2 RETURNING *`,
            [leadId, companyId, partyId]
        );
        const handedOver = await client.query(
            `UPDATE tbl_enquiry SET party_id = $3, updated_at = CURRENT_TIMESTAMP
              WHERE lead_id = $1 AND company_id = $2 AND is_deleted = FALSE AND party_id IS NULL
              RETURNING enquiry_id, enquiry_no`,
            [leadId, companyId, partyId]
        );

        await logAudit(client, {
            module_name: "Lead", page_name: "Convert Lead", table_name: "tbl_lead", table_id: leadId,
            action_type: "STATUS_CHANGE",
            action_description: `Lead ${lead.lead_no} converted to customer (party_id ${partyId}${createdParty ? ", created" : ", linked"})`,
            old_value: JSON.stringify(lead), new_value: JSON.stringify(upd.rows[0]),
            user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId,
        });

        await client.query("COMMIT");
        return res.status(200).json({
            success: true,
            message: createdParty ? "Lead converted to a new customer" : "Lead linked to the existing customer",
            Leads: upd.rows[0],
            party_id: partyId,
            Party: createdParty?.basic ?? null,
            enquiries_moved_to_customer: handedOver.rows,
        });
    } catch (err) {
        if (client) await client.query("ROLLBACK").catch(() => { });
        return sendError(res, "convertLead", err, "Failed to convert Lead");
    } finally {
        client?.release();
    }
}
