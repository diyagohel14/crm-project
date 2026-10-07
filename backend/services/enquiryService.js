// services/enquiryService.js
//
// The one place that ties a quotation to the enquiry it answers.
// Used by quotationController (when a quotation is created with an
// enquiry_id) and by POST /api/enquiry/:id/link-quotation/:quotationId.
//
// Must be called inside the caller's transaction (pass its `client`).

import { ENQUIRY_CLOSED_STATUSES, ENQUIRY_PRE_QUOTE_STATUSES, httpError } from "./crmService.js";

/**
 * @returns {Promise<{ enquiry: object, movedToQuoted: boolean }>}
 */
export async function linkQuotationToEnquiry(client, { enquiryId, quotationId, companyId }) {
    const enqRes = await client.query(
        `SELECT * FROM tbl_enquiry
          WHERE enquiry_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
        [enquiryId, companyId]
    );
    if (enqRes.rows.length === 0) throw httpError(404, "Enquiry not found");
    const enquiry = enqRes.rows[0];

    const qRes = await client.query(
        `SELECT quotation_id, party_id, enquiry_id FROM tbl_quotation
          WHERE quotation_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
        [quotationId, companyId]
    );
    if (qRes.rows.length === 0) throw httpError(404, "Quotation not found");
    const quotation = qRes.rows[0];

    if (quotation.enquiry_id && Number(quotation.enquiry_id) !== Number(enquiryId)) {
        throw httpError(409, "This quotation is already linked to a different enquiry");
    }
    if (!enquiry.party_id) {
        throw httpError(400, "This enquiry is still attached to a lead. Convert the lead to a customer before quoting.");
    }
    if (Number(enquiry.party_id) !== Number(quotation.party_id)) {
        throw httpError(400, "The quotation's customer is different from the enquiry's customer");
    }
    if (ENQUIRY_CLOSED_STATUSES.includes(enquiry.status)) {
        throw httpError(400, `Enquiry is '${enquiry.status}'. Reopen it before linking a quotation.`);
    }

    await client.query(
        `UPDATE tbl_quotation SET enquiry_id = $1, updated_at = CURRENT_TIMESTAMP WHERE quotation_id = $2`,
        [enquiryId, quotationId]
    );

    let updated = enquiry;
    let movedToQuoted = false;
    if (ENQUIRY_PRE_QUOTE_STATUSES.includes(enquiry.status)) {
        const upd = await client.query(
            `UPDATE tbl_enquiry SET status = 'quoted', updated_at = CURRENT_TIMESTAMP
              WHERE enquiry_id = $1 RETURNING *`,
            [enquiryId]
        );
        updated = upd.rows[0];
        movedToQuoted = true;
    }

    return { enquiry: updated, movedToQuoted };
}
