// controllers/quotationController.js

import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js"
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule, priceCalculationFromDatabase, num } from "../services/allService.js"

export function resolveQuotationItemLink(insertedItemIds = [], taxDetail = {}) {
    if (!Array.isArray(insertedItemIds)) return null;

    const indexValue = taxDetail.quotation_item_index;
    if (indexValue !== undefined && indexValue !== null && indexValue !== "") {
        const index = Number(indexValue);
        if (Number.isInteger(index) && insertedItemIds[index] !== undefined) {
            return insertedItemIds[index];
        }
    }

    const directValue = taxDetail.quotation_item_id;
    if (directValue !== undefined && directValue !== null && directValue !== "") {
        const directId = Number(directValue);
        if (Number.isInteger(directId) && insertedItemIds.includes(directId)) {
            return directId;
        }
    }

    return null;
}

// calculate the price details for total values
async function priceItems(client, itemsDetails, payload) {
    const priced = await priceCalculationFromDatabase(client, itemsDetails, payload, "sales");
    priced.items = priced.items.map((it, idx) => ({
        quotation_item_id: itemsDetails[idx]?.quotation_item_id || null,
        ...it,
    }));
    return priced;
}

/// status update flow
const ALLOWED_STATUS_TRANSITIONS = {
    draft: ["sent"],
    sent: ["viewed", "accepted", "rejected", "expired", "revised"],
    viewed: ["accepted", "rejected", "expired", "revised"],
    accepted: [],
    rejected: [],
    expired: [],
    revised: []
};

function isValidStatusTransition(currentStatus, newStatus) {
    return ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

/////////////////////////// Quotation Module Start /////////////////////////////
export async function getQuotations(req, res) {
    const { companyId } = req.session.user;
    const { quotationId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    let result;

    try {
        if (quotationId) {
            const query = `SELECT quot.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_quotation_items AS items
                 WHERE items.quotation_id = quot.quotation_id AND items.company_id = quot.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_quotation_tax_details AS tax
                 WHERE tax.quotation_id = quot.quotation_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_quotation AS quot
            WHERE quot.quotation_id = $1 AND quot.company_id = $2 AND quot.is_deleted = FALSE`;
            result = await companyPool.query(query, [quotationId, companyId]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Quotation not found" });
            }
        } else {
            const query = `SELECT quot.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_quotation_items AS items
                 WHERE items.quotation_id = quot.quotation_id AND items.company_id = quot.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_quotation_tax_details AS tax
                 WHERE tax.quotation_id = quot.quotation_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_quotation AS quot
            WHERE quot.company_id = $1 AND quot.is_deleted = FALSE
            ORDER BY quot.quotation_no ASC`;
            result = await companyPool.query(query, [companyId]);
        }

        return res.status(200).json({ message: "Quotation Fetch Successfully", Quotations: result.rows });

    } catch (err) {
        console.error("[getQuotations]", err);
        return res.status(500).json({ error: "Failed to fetch Quotation List", details: err.message });
    }
}

export async function createQuotation(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.quotation_date) {
            return res.status(400).json({ success: false, error: "quotation_date is required" });
        }

        // Recompute every money figure server-side from qty/rate/discount/tax%.
        const priced = await priceItems(client, payload.itemsDetails, payload);
        const taxDetails = priced.taxDetails;

        await client.query('BEGIN');

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.QUOTATION,
            companyId,
            userId,
            financialYearId,
            client
        });
        const quotationNo = seriesResult.series;

        const insertQuotationSql = `INSERT INTO tbl_quotation (
            quotation_no, party_id, quotation_date, valid_until,
            billing_address_id, shipping_address_id, currency_id,
            subtotal_amount, discount_value, total_tax_amount,
            round_off, total_amount, terms_conditions, notes, 
            status, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *`;

        const quotationParams = [
            quotationNo,
            payload.party_id,
            payload.quotation_date,
            payload.valid_until || null,
            payload.billing_address_id || null,
            payload.shipping_address_id || null,
            payload.currency_id || null,
            priced.subtotal_amount,
            // priced.discount_type,
            priced.discount_value,
            priced.total_tax_amount,
            priced.round_off,
            priced.total_amount,
            payload.terms_conditions || null,
            payload.notes || null,
            payload.status || 'draft',
            userId,
            companyId
        ];

        const quotationRes = await client.query(insertQuotationSql, quotationParams);
        const quotationId = quotationRes.rows[0].quotation_id;

        const insertedItemIds = [];
        const insertedItems = [];
        const insertItemSql = `INSERT INTO tbl_quotation_items (
            quotation_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        for (const it of priced.items) {
            const itemParams = [
                quotationId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id,
                it.unit_rate, it.total_rate, it.discount_percent, it.discount_flat,
                it.tax_percent, it.tax_amount, it.total_amount, userId, companyId
            ];
            const r = await client.query(insertItemSql, itemParams);
            insertedItemIds.push(r.rows[0].quotation_item_id);
            insertedItems.push(r.rows[0]);
        }

        const insertTaxSql = `INSERT INTO tbl_quotation_tax_details (
            quotation_id, quotation_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const insertedTaxes = [];
        for (const t of priced.taxDetails) {
            const quotationItemId = resolveQuotationItemLink(insertedItemIds, t);
            const taxParams = [
                quotationId, quotationItemId, t.tax_id || null,
                num(t.taxable_amount, null), num(t.tax_percentage, null), num(t.tax_amount, null),
                false
            ];
            const r = await client.query(insertTaxSql, taxParams);
            insertedTaxes.push(r.rows[0]);
        }

        await logAudit(client, {
            module_name: "Quotation",
            page_name: "Create Quotation",
            table_name: "tbl_quotation",
            table_id: quotationId,
            action_type: "CREATE",
            action_description: `Quotation Created Successfully :${quotationNo}`,
            new_value: JSON.stringify(quotationRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Quotation created',
            Quotations: quotationRes.rows[0],
            itemsDetails: insertedItems,
            taxDetails: insertedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createQuotation]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Quotation", details: err.message });

    } finally {
        client.release();
    }
}

export async function updateQuotation(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const { quotationId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.quotation_date) {
            return res.status(400).json({ success: false, error: "quotation_date is required" });
        }

        const priced = await priceItems(client, payload.itemsDetails, payload);
        const taxDetails = priced.taxDetails;

        await client.query('BEGIN');

        //Check quotation
        const quotationQuery = await client.query(
            `SELECT quotation_id, status FROM tbl_quotation
             WHERE quotation_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [quotationId, companyId]
        );
        if (quotationQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }
        const quotation = quotationQuery.rows[0];
        if (quotation.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: `Quotation cannot be updated because its status is '${quotation.status}'` });
        }

        const updateQuotationSql = `UPDATE tbl_quotation SET
            party_id = $1, quotation_date = $2, valid_until = $3,
            billing_address_id = $4, shipping_address_id = $5, currency_id = $6,
            subtotal_amount = $7, discount_value = $8, total_tax_amount = $9,
            round_off = $10, total_amount = $11, terms_conditions = $12, notes = $13, 
            status = $14, updated_at = CURRENT_TIMESTAMP
            WHERE quotation_id = $15 AND is_deleted = FALSE AND company_id = $16
            RETURNING *`;

        const quotationParams = [
            payload.party_id,
            payload.quotation_date,
            payload.valid_until || null,
            payload.billing_address_id || null,
            payload.shipping_address_id || null,
            payload.currency_id || null,
            priced.subtotal_amount,
            // priced.discount_type,
            priced.discount_value,
            priced.total_tax_amount,
            priced.round_off,
            priced.total_amount,
            payload.terms_conditions || null,
            payload.notes || null,
            payload.status || 'draft',
            quotationId,
            companyId
        ];

        const quotationRes = await client.query(updateQuotationSql, quotationParams);

        if (quotationRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Quotation not found" });
        }

        const existingItemsRes = await client.query(
            'SELECT quotation_item_id FROM tbl_quotation_items WHERE quotation_id = $1 AND is_deleted = FALSE',
            [quotationId]
        );
        const existingItemIds = existingItemsRes.rows.map(r => r.quotation_item_id);

        const keptItemIds = [];
        const processedItems = [];

        const insertItemSql = `INSERT INTO tbl_quotation_items (
            quotation_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        const updateItemSql = `UPDATE tbl_quotation_items SET
            item_id = $1, description = $2, quantity = $3, hsn_code = $4, unit_id = $5, unit_rate = $6,
            total_rate = $7, discount_percent = $8, discount_flat = $9, tax_percent = $10, tax_amount = $11,
            total_amount = $12, updated_at = CURRENT_TIMESTAMP
            WHERE quotation_item_id = $13 AND quotation_id = $14 AND company_id = $15 AND is_deleted = FALSE
            RETURNING *`;

        for (const it of priced.items) {
            if (it.quotation_item_id && existingItemIds.includes(it.quotation_item_id)) {
                const params = [
                    it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, it.quotation_item_id, quotationId, companyId
                ];
                const r = await client.query(updateItemSql, params);
                if (r.rowCount) {
                    keptItemIds.push(r.rows[0].quotation_item_id);
                    processedItems.push(r.rows[0]);
                }
            } else {
                const params = [
                    quotationId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, userId, companyId
                ];
                const r = await client.query(insertItemSql, params);
                keptItemIds.push(r.rows[0].quotation_item_id);
                processedItems.push(r.rows[0]);
            }
        }

        const toDelete = existingItemIds.filter(id => !keptItemIds.includes(id));
        if (toDelete.length) {
            await client.query('UPDATE tbl_quotation_items SET is_deleted = TRUE WHERE quotation_item_id = ANY($1)', [toDelete]);
        }

        const existingTaxesRes = await client.query(
            'SELECT tax_detail_id FROM tbl_quotation_tax_details WHERE quotation_id = $1 AND is_deleted = FALSE',
            [quotationId]
        );
        const existingTaxIds = existingTaxesRes.rows.map(r => r.tax_detail_id);
        const keptTaxIds = [];
        const processedTaxes = [];

        const insertTaxSql = `INSERT INTO tbl_quotation_tax_details (
            quotation_id, quotation_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const updateTaxSql = `UPDATE tbl_quotation_tax_details SET
            quotation_item_id = $1, tax_id = $2, taxable_amount = $3, tax_percentage = $4, tax_amount = $5, is_deleted = $6
            WHERE tax_detail_id = $7 AND quotation_id = $8 AND is_deleted = FALSE
            RETURNING *`;

        const itemIndexToId = processedItems.map(it => it.quotation_item_id);

        for (const t of priced.taxDetails) {
            const quotation_item_id = resolveQuotationItemLink(itemIndexToId, t);

            if (t.tax_detail_id && existingTaxIds.includes(t.tax_detail_id)) {
                const params = [
                    quotation_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false,
                    t.tax_detail_id, quotationId
                ];
                const r = await client.query(updateTaxSql, params);
                if (r.rowCount) {
                    keptTaxIds.push(r.rows[0].tax_detail_id);
                    processedTaxes.push(r.rows[0]);
                }
            } else {
                const params = [
                    quotationId, quotation_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false
                ];
                const r = await client.query(insertTaxSql, params);
                keptTaxIds.push(r.rows[0].tax_detail_id);
                processedTaxes.push(r.rows[0]);
            }
        }

        const taxesToDelete = existingTaxIds.filter(id => !keptTaxIds.includes(id));
        if (taxesToDelete.length) {
            await client.query('UPDATE tbl_quotation_tax_details SET is_deleted = TRUE WHERE tax_detail_id = ANY($1)', [taxesToDelete]);
        }

        await logAudit(client, {
            module_name: "Quotation",
            page_name: "Update Quotation",
            table_name: "tbl_quotation",
            table_id: quotationId,
            action_type: "UPDATE",
            action_description: "Quotation Updated Successfully",
            new_value: JSON.stringify(quotationRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Quotation Updated',
            Quotations: quotationRes.rows[0],
            itemsDetails: processedItems,
            taxDetails: processedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updateQuotation]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Update Quotation", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteQuotation(req, res) {
    const { companyId } = req.session.user;
    const { quotationId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const result = await deleteModule(client, 'tbl_quotation', 'quotation_id', quotationId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Quotation not found" });
        }
        const itemsResult = await deleteModule(client, 'tbl_quotation_items', 'quotation_id', quotationId, { company_id: companyId });
        const taxResult = await deleteModule(client, 'tbl_quotation_tax_details', 'quotation_id', quotationId);

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Quotation Deleted',
            Quotations: result.result,
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteQuotation]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Quotation", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteQuotationItems(req, res) {
    const { companyId } = req.session.user;
    const { quotationId, quotationItemId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const itemsResult = await deleteModule(client, 'tbl_quotation_items', 'quotation_item_id', quotationItemId, { quotation_id: quotationId, company_id: companyId });

        if (itemsResult.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Quotation item not found" });
        }

        const taxResult = await deleteModule(client, 'tbl_quotation_tax_details', 'quotation_item_id', quotationItemId, { quotation_id: quotationId });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Quotation Item Deleted',
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteQuotationItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Quotation Items", details: err.message });

    } finally {
        client.release();
    }
}

export async function changeStatus(req, res) {
    const { userId, companyId, roleId, fullName } = req.session.user;
    const { quotationId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");

        const allowedStatuses = ["draft", "sent", "viewed", "accepted", "rejected", "expired", "revised"];
        if (!allowedStatuses.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid quotation status: ${status}` });
        }

        // Get current quotation
        const quotationQuery = `SELECT * FROM tbl_quotation WHERE quotation_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`;
        const quotationResult = await client.query(quotationQuery, [quotationId, companyId]);

        if (quotationResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Quotation not found" });
        }

        const quotation = quotationResult.rows[0];
        const currentStatus = quotation.status;
        // Same status
        if (currentStatus === status) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Quotation is already ${status}` });
        }

        // Check transition
        if (!isValidStatusTransition(currentStatus, status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Quotation status cannot be changed from '${currentStatus}' to '${status}'` });
        }

        // Get user name for audit
        const userQuery = await client.query(
            `SELECT first_name, last_name, email FROM users WHERE user_id = $1 AND company_id = $2`,
            [userId, companyId]
        );
        const user = userQuery.rows[0];
        const user_name = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
        const userName = user_name || user?.email || fullName || "Unknown User";

        // Update status
        const updateQuery = `UPDATE tbl_quotation SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE quotation_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`;
        const result = await client.query(updateQuery, [quotationId, companyId, status]);
        const updatedQuotation = result.rows[0];

        await logAudit(client, {
            module_name: "Quotation",
            page_name: "Quotation Status",
            table_name: "tbl_quotation",
            table_id: quotationId,
            action_type: "STATUS_CHANGE",
            action_description:`Quotation status changed from ${currentStatus} to ${status} by ${userName}`,
            old_value: JSON.stringify(quotation),
            new_value: JSON.stringify(updatedQuotation),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Quotation status changed from '${currentStatus}' to '${status}'`,
            Quotations: updatedQuotation
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStatus]", err);
        return res.status(500).json({
            success: false,
            error: "Failed to change status of Quotation",
            details: err.message
        });
    } finally {
        client.release();
    }
}

///////////////////////////Quotation Module End /////////////////////////////