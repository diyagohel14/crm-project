// controllers/proformaController.js

import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js"
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule, priceCalculation, num } from "../services/allService.js"

export function resolveProformaItemLink(insertedItemIds = [], taxDetail = {}) {
    if (!Array.isArray(insertedItemIds)) return null;

    const indexValue = taxDetail.proforma_item_index;
    if (indexValue !== undefined && indexValue !== null && indexValue !== "") {
        const index = Number(indexValue);
        if (Number.isInteger(index) && insertedItemIds[index] !== undefined) {
            return insertedItemIds[index];
        }
    }

    const directValue = taxDetail.proforma_item_id;
    if (directValue !== undefined && directValue !== null && directValue !== "") {
        const directId = Number(directValue);
        if (Number.isInteger(directId) && insertedItemIds.includes(directId)) {
            return directId;
        }
    }

    return null;
}

// calculate the price details for total values
function priceItems(itemsDetails, payload) {
    const priced = priceCalculation(itemsDetails, payload);
    priced.items = priced.items.map((it, idx) => ({
        proforma_item_id: itemsDetails[idx]?.proforma_item_id || null,
        ...it,
    }));
    return priced;
}

/// status update flow
const ALLOWED_STATUS_TRANSITIONS = {
    draft: ["sent", "revised"],
    sent: ["viewed", "accepted", "rejected", "expired", "revised"],
    viewed: ["accepted", "rejected", "expired", "revised"],
    accepted: ["revised"],
    rejected: ["revised"],
    expired: ["revised"],
    revised: []
};

function isValidStatusTransition(currentStatus, newStatus) {
    return ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

/////////////////////////// Proforma Module Start /////////////////////////////
export async function getProformas(req, res) {
    const { companyId } = req.session.user;
    const { proformaId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    let result;

    try {
        if (proformaId) {
            const query = `SELECT prof.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_proforma_items AS items
                 WHERE items.proforma_id = prof.proforma_id AND items.company_id = prof.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_proforma_tax_details AS tax
                 WHERE tax.proforma_id = prof.proforma_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_proforma AS prof
            WHERE prof.proforma_id = $1 AND prof.company_id = $2 AND prof.is_deleted = FALSE`;
            result = await companyPool.query(query, [proformaId, companyId]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Proforma not found" });
            }
        } else {
            const query = `SELECT prof.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_proforma_items AS items
                 WHERE items.proforma_id = prof.proforma_id AND items.company_id = prof.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_proforma_tax_details AS tax
                 WHERE tax.proforma_id = prof.proforma_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_proforma AS prof
            WHERE prof.company_id = $1 AND prof.is_deleted = FALSE
            ORDER BY prof.proforma_no ASC`;
            result = await companyPool.query(query, [companyId]);
        }

        return res.status(200).json({ message: "Proforma Fetch Successfully", Proformas: result.rows });

    } catch (err) {
        console.error("[getProformas]", err);
        return res.status(500).json({ error: "Failed to fetch Proforma List", details: err.message });
    }
}

export async function createProforma(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.proforma_date) {
            return res.status(400).json({ success: false, error: "proforma_date is required" });
        }

        // Recompute every money figure server-side from qty/rate/discount/tax%.
        const priced = priceItems(payload.itemsDetails, payload);
        const taxDetails = Array.isArray(payload.taxDetails) ? payload.taxDetails : [];

        await client.query('BEGIN');

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.PROFORMA,
            companyId,
            userId,
            financialYearId,
            client
        });
        const proformaNo = seriesResult.series;

        const insertProformaSql = `INSERT INTO tbl_proforma (
            proforma_no, party_id, proforma_date, valid_until,
            billing_address_id, shipping_address_id, currency_id,
            subtotal_amount, discount_value, total_tax_amount,
            round_off, total_amount, terms_conditions, notes, 
            status, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *`;

        const proformaParams = [
            proformaNo,
            payload.party_id,
            payload.proforma_date,
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

        const proformaRes = await client.query(insertProformaSql, proformaParams);
        const proformaId = proformaRes.rows[0].proforma_id;

        const insertedItemIds = [];
        const insertedItems = [];
        const insertItemSql = `INSERT INTO tbl_proforma_items (
            proforma_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        for (const it of priced.items) {
            const itemParams = [
                proformaId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id,
                it.unit_rate, it.total_rate, it.discount_percent, it.discount_flat,
                it.tax_percent, it.tax_amount, it.total_amount, userId, companyId
            ];
            const r = await client.query(insertItemSql, itemParams);
            insertedItemIds.push(r.rows[0].proforma_item_id);
            insertedItems.push(r.rows[0]);
        }

        const insertTaxSql = `INSERT INTO tbl_proforma_tax_details (
            proforma_id, proforma_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const insertedTaxes = [];
        for (const t of taxDetails) {
            const proformaItemId = resolveProformaItemLink(insertedItemIds, t);
            const taxParams = [
                proformaId, proformaItemId, t.tax_id || null,
                num(t.taxable_amount, null), num(t.tax_percentage, null), num(t.tax_amount, null),
                false
            ];
            const r = await client.query(insertTaxSql, taxParams);
            insertedTaxes.push(r.rows[0]);
        }

        await logAudit(client, {
            module_name: "Proforma",
            page_name: "Create Proforma",
            table_name: "tbl_proforma",
            table_id: proformaId,
            action_type: "CREATE",
            action_description: `Proforma Created Successfully :${proformaNo}`,
            new_value: JSON.stringify(proformaRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Proforma created',
            Proformas: proformaRes.rows[0],
            itemsDetails: insertedItems,
            taxDetails: insertedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createProforma]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Proforma", details: err.message });

    } finally {
        client.release();
    }
}

export async function updateProforma(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const { proformaId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.proforma_date) {
            return res.status(400).json({ success: false, error: "proforma_date is required" });
        }

        const priced = priceItems(payload.itemsDetails, payload);
        const taxDetails = Array.isArray(payload.taxDetails) ? payload.taxDetails : [];

        await client.query('BEGIN');

        //Check proforma
        const proformaQuery = await client.query(
            `SELECT proforma_id, status FROM tbl_proforma
             WHERE proforma_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [proformaId, companyId]
        );
        if (proformaQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Proforma not found' });
        }
        const proforma = proformaQuery.rows[0];
        if (proforma.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: `Proforma cannot be updated because its status is '${proforma.status}'` });
        }

        const updateProformaSql = `UPDATE tbl_proforma SET
            party_id = $1, proforma_date = $2, valid_until = $3,
            billing_address_id = $4, shipping_address_id = $5, currency_id = $6,
            subtotal_amount = $7, discount_value = $8, total_tax_amount = $9,
            round_off = $10, total_amount = $11, terms_conditions = $12, notes = $13, 
            status = $14, updated_at = CURRENT_TIMESTAMP
            WHERE proforma_id = $15 AND is_deleted = FALSE AND company_id = $16
            RETURNING *`;

        const proformaParams = [
            payload.party_id,
            payload.proforma_date,
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
            proformaId,
            companyId
        ];

        const proformaRes = await client.query(updateProformaSql, proformaParams);

        if (proformaRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Proforma not found" });
        }

        const existingItemsRes = await client.query(
            'SELECT proforma_item_id FROM tbl_proforma_items WHERE proforma_id = $1 AND is_deleted = FALSE',
            [proformaId]
        );
        const existingItemIds = existingItemsRes.rows.map(r => r.proforma_item_id);

        const keptItemIds = [];
        const processedItems = [];

        const insertItemSql = `INSERT INTO tbl_proforma_items (
            proforma_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        const updateItemSql = `UPDATE tbl_proforma_items SET
            item_id = $1, description = $2, quantity = $3, hsn_code = $4, unit_id = $5, unit_rate = $6,
            total_rate = $7, discount_percent = $8, discount_flat = $9, tax_percent = $10, tax_amount = $11,
            total_amount = $12, updated_at = CURRENT_TIMESTAMP
            WHERE proforma_item_id = $13 AND proforma_id = $14 AND company_id = $15 AND is_deleted = FALSE
            RETURNING *`;

        for (const it of priced.items) {
            if (it.proforma_item_id && existingItemIds.includes(it.proforma_item_id)) {
                const params = [
                    it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, it.proforma_item_id, proformaId, companyId
                ];
                const r = await client.query(updateItemSql, params);
                if (r.rowCount) {
                    keptItemIds.push(r.rows[0].proforma_item_id);
                    processedItems.push(r.rows[0]);
                }
            } else {
                const params = [
                    proformaId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, userId, companyId
                ];
                const r = await client.query(insertItemSql, params);
                keptItemIds.push(r.rows[0].proforma_item_id);
                processedItems.push(r.rows[0]);
            }
        }

        const toDelete = existingItemIds.filter(id => !keptItemIds.includes(id));
        if (toDelete.length) {
            await client.query('UPDATE tbl_proforma_items SET is_deleted = TRUE WHERE proforma_item_id = ANY($1)', [toDelete]);
        }

        const existingTaxesRes = await client.query(
            'SELECT tax_detail_id FROM tbl_proforma_tax_details WHERE proforma_id = $1 AND is_deleted = FALSE',
            [proformaId]
        );
        const existingTaxIds = existingTaxesRes.rows.map(r => r.tax_detail_id);
        const keptTaxIds = [];
        const processedTaxes = [];

        const insertTaxSql = `INSERT INTO tbl_proforma_tax_details (
            proforma_id, proforma_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const updateTaxSql = `UPDATE tbl_proforma_tax_details SET
            proforma_item_id = $1, tax_id = $2, taxable_amount = $3, tax_percentage = $4, tax_amount = $5, is_deleted = $6
            WHERE tax_detail_id = $7 AND proforma_id = $8 AND is_deleted = FALSE
            RETURNING *`;

        const itemIndexToId = processedItems.map(it => it.proforma_item_id);

        for (const t of taxDetails) {
            const proforma_item_id = resolveProformaItemLink(itemIndexToId, t);

            if (t.tax_detail_id && existingTaxIds.includes(t.tax_detail_id)) {
                const params = [
                    proforma_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false,
                    t.tax_detail_id, proformaId
                ];
                const r = await client.query(updateTaxSql, params);
                if (r.rowCount) {
                    keptTaxIds.push(r.rows[0].tax_detail_id);
                    processedTaxes.push(r.rows[0]);
                }
            } else {
                const params = [
                    proformaId, proforma_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false
                ];
                const r = await client.query(insertTaxSql, params);
                keptTaxIds.push(r.rows[0].tax_detail_id);
                processedTaxes.push(r.rows[0]);
            }
        }

        const taxesToDelete = existingTaxIds.filter(id => !keptTaxIds.includes(id));
        if (taxesToDelete.length) {
            await client.query('UPDATE tbl_proforma_tax_details SET is_deleted = TRUE WHERE tax_detail_id = ANY($1)', [taxesToDelete]);
        }

        await logAudit(client, {
            module_name: "Proforma",
            page_name: "Update Proforma",
            table_name: "tbl_proforma",
            table_id: proformaId,
            action_type: "UPDATE",
            action_description: "Proforma Updated Successfully",
            new_value: JSON.stringify(proformaRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Proforma Updated',
            Proformas: proformaRes.rows[0],
            itemsDetails: processedItems,
            taxDetails: processedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updateProforma]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Update Proforma", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteProforma(req, res) {
    const { companyId } = req.session.user;
    const { proformaId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const result = await deleteModule(client, 'tbl_proforma', 'proforma_id', proformaId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Proforma not found" });
        }
        const itemsResult = await deleteModule(client, 'tbl_proforma_items', 'proforma_id', proformaId, { company_id: companyId });
        const taxResult = await deleteModule(client, 'tbl_proforma_tax_details', 'proforma_id', proformaId);

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Proforma Deleted',
            Proformas: result.result,
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteProforma]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Proforma", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteProformaItems(req, res) {
    const { companyId } = req.session.user;
    const { proformaId, proformaItemId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const itemsResult = await deleteModule(client, 'tbl_proforma_items', 'proforma_item_id', proformaItemId, { proforma_id: proformaId, company_id: companyId });

        if (itemsResult.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Proforma item not found" });
        }

        const taxResult = await deleteModule(client, 'tbl_proforma_tax_details', 'proforma_item_id', proformaItemId, { proforma_id: proformaId });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Proforma Item Deleted',
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteProformaItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Proforma Items", details: err.message });

    } finally {
        client.release();
    }
}

export async function changeStatus(req, res) {
    const { userId, companyId, roleId, fullName } = req.session.user;
    const { proformaId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");

        const allowedStatuses = ["draft", "sent", "viewed", "accepted", "rejected", "expired", "revised"];
        if (!allowedStatuses.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid proforma status: ${status}` });
        }

        // Get current proforma
        const proformaQuery = `SELECT * FROM tbl_proforma WHERE proforma_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`;
        const proformaResult = await client.query(proformaQuery, [proformaId, companyId]);

        if (proformaResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Proforma not found" });
        }

        const proforma = proformaResult.rows[0];
        const currentStatus = proforma.status;
        // Same status
        if (currentStatus === status) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Proforma is already ${status}` });
        }

        // Check transition
        if (!isValidStatusTransition(currentStatus, status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Proforma status cannot be changed from '${currentStatus}' to '${status}'` });
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
        const updateQuery = `UPDATE tbl_proforma SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE proforma_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`;
        const result = await client.query(updateQuery, [proformaId, companyId, status]);
        const updatedProforma = result.rows[0];

        await logAudit(client, {
            module_name: "Proforma",
            page_name: "Proforma Status",
            table_name: "tbl_proforma",
            table_id: proformaId,
            action_type: "STATUS_CHANGE",
            action_description: `Proforma status changed from ${currentStatus} to ${status} by ${userName}`,
            old_value: JSON.stringify(proforma),
            new_value: JSON.stringify(updatedProforma),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Proforma status changed from '${currentStatus}' to '${status}'`,
            Proformas: updatedProforma
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStatus]", err);
        return res.status(500).json({
            success: false,
            error: "Failed to change status of Proforma",
            details: err.message
        });
    } finally {
        client.release();
    }
}

///////////////////////////Proforma Module End /////////////////////////////