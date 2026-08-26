// controllers/deliverychallanController.js

import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js"
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule, priceCalculation, num } from "../services/allService.js"

export function resolveDeliveryChallanItemLink(insertedItemIds = [], taxDetail = {}) {
    if (!Array.isArray(insertedItemIds)) return null;

    const indexValue = taxDetail.delivery_challan_item_index;
    if (indexValue !== undefined && indexValue !== null && indexValue !== "") {
        const index = Number(indexValue);
        if (Number.isInteger(index) && insertedItemIds[index] !== undefined) {
            return insertedItemIds[index];
        }
    }

    const directValue = taxDetail.delivery_challan_item_id;
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
        delivery_challan_item_id: itemsDetails[idx]?.delivery_challan_item_id || null,
        ...it,
    }));
    return priced;
}

/// status update flow
const ALLOWED_STATUS_TRANSITIONS = {
    draft: ["issued", "cancelled"],
    issued: ["partially_delivered", "delivered", "cancelled"],
    partially_delivered: ["delivered", "cancelled"],
    delivered: ["closed"],
    closed: [],
    cancelled: []
};

function isValidStatusTransition(currentStatus, newStatus) {
    return ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

/////////////////////////// Delivery Challan Module Start /////////////////////////////
export async function getDeliveryChallans(req, res) {
    const { companyId } = req.session.user;
    const { deliverychallanId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    let result;

    try {
        if (deliverychallanId) {
            const query = `SELECT dc.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_delivery_challan_items AS items
                 WHERE items.delivery_challan_id = dc.delivery_challan_id AND items.company_id = dc.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_delivery_challan_tax_details AS tax
                 WHERE tax.delivery_challan_id = dc.delivery_challan_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_delivery_challan AS dc
            WHERE dc.delivery_challan_id = $1 AND dc.company_id = $2 AND dc.is_deleted = FALSE`;
            result = await companyPool.query(query, [deliverychallanId, companyId]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Delivery Challan not found" });
            }
        } else {
            const query = `SELECT dc.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_delivery_challan_items AS items
                 WHERE items.delivery_challan_id = dc.delivery_challan_id AND items.company_id = dc.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_delivery_challan_tax_details AS tax
                 WHERE tax.delivery_challan_id = dc.delivery_challan_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_delivery_challan AS dc
            WHERE dc.company_id = $1 AND dc.is_deleted = FALSE
            ORDER BY dc.delivery_challan_no ASC`;
            result = await companyPool.query(query, [companyId]);
        }

        return res.status(200).json({ message: "Delivery Challan Fetch Successfully", DeliveryChallans: result.rows });

    } catch (err) {
        console.error("[getDeliveryChallans]", err);
        return res.status(500).json({ error: "Failed to fetch Delivery Challan List", details: err.message });
    }
}

export async function createDeliveryChallan(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.delivery_date) {
            return res.status(400).json({ success: false, error: "delivery_date is required" });
        }

        // Recompute every money figure server-side from qty/rate/discount/tax%.
        const priced = priceItems(payload.itemsDetails, payload);
        const taxDetails = Array.isArray(payload.taxDetails) ? payload.taxDetails : [];

        await client.query('BEGIN');

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.DELIVERY_CHALLAN,
            companyId,
            userId,
            financialYearId,
            client
        });
        const deliverychallanNo = seriesResult.series;

        const insertDeliveryChallanSql = `INSERT INTO tbl_delivery_challan (
            delivery_challan_no, party_id, delivery_date, expected_delivery_date,
            billing_address_id, shipping_address_id, currency_id,
            subtotal_amount, discount_value, total_tax_amount,
            round_off, total_amount, terms_conditions, notes, 
            status, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *`;

        const deliverychallanParams = [
            deliverychallanNo,
            payload.party_id,
            payload.delivery_date,
            payload.expected_delivery_date || null,
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

        const deliverychallanRes = await client.query(insertDeliveryChallanSql, deliverychallanParams);
        const deliverychallanId = deliverychallanRes.rows[0].delivery_challan_id;

        const insertedItemIds = [];
        const insertedItems = [];
        const insertItemSql = `INSERT INTO tbl_delivery_challan_items (
            delivery_challan_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        for (const it of priced.items) {
            const itemParams = [
                deliverychallanId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id,
                it.unit_rate, it.total_rate, it.discount_percent, it.discount_flat,
                it.tax_percent, it.tax_amount, it.total_amount, userId, companyId
            ];
            const r = await client.query(insertItemSql, itemParams);
            insertedItemIds.push(r.rows[0].delivery_challan_item_id);
            insertedItems.push(r.rows[0]);
        }

        const insertTaxSql = `INSERT INTO tbl_delivery_challan_tax_details (
            delivery_challan_id, delivery_challan_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const insertedTaxes = [];
        for (const t of taxDetails) {
            const deliverychallanItemId = resolveDeliveryChallanItemLink(insertedItemIds, t);
            const taxParams = [
                deliverychallanId, deliverychallanItemId, t.tax_id || null,
                num(t.taxable_amount, null), num(t.tax_percentage, null), num(t.tax_amount, null),
                false
            ];
            const r = await client.query(insertTaxSql, taxParams);
            insertedTaxes.push(r.rows[0]);
        }

        await logAudit(client, {
            module_name: "Delivery Challan",
            page_name: "Create Delivery Challan",
            table_name: "tbl_delivery_challan",
            table_id: deliverychallanId,
            action_type: "CREATE",
            action_description: `Delivery Challan Created Successfully :${deliverychallanNo}`,
            new_value: JSON.stringify(deliverychallanRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Delivery Challan created',
            DeliveryChallans: deliverychallanRes.rows[0],
            itemsDetails: insertedItems,
            taxDetails: insertedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createDeliveryChallan]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Delivery Challan", details: err.message });

    } finally {
        client.release();
    }
}

export async function updateDeliveryChallan(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const { deliverychallanId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.delivery_date) {
            return res.status(400).json({ success: false, error: "delivery_date is required" });
        }

        const priced = priceItems(payload.itemsDetails, payload);
        const taxDetails = Array.isArray(payload.taxDetails) ? payload.taxDetails : [];

        await client.query('BEGIN');

        //Check deliverychallan
        const deliverychallanQuery = await client.query(
            `SELECT delivery_challan_id, status FROM tbl_delivery_challan
             WHERE delivery_challan_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [deliverychallanId, companyId]
        );
        if (deliverychallanQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Delivery Challan not found' });
        }
        const deliverychallan = deliverychallanQuery.rows[0];
        if (deliverychallan.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: `Delivery Challan cannot be updated because its status is '${deliverychallan.status}'` });
        }

        const updateDeliveryChallanSql = `UPDATE tbl_delivery_challan SET
            party_id = $1, delivery_date = $2, expected_delivery_date = $3,
            billing_address_id = $4, shipping_address_id = $5, currency_id = $6,
            subtotal_amount = $7, discount_value = $8, total_tax_amount = $9,
            round_off = $10, total_amount = $11, terms_conditions = $12, notes = $13, 
            status = $14, updated_at = CURRENT_TIMESTAMP
            WHERE delivery_challan_id = $15 AND is_deleted = FALSE AND company_id = $16
            RETURNING *`;

        const deliverychallanParams = [
            payload.party_id,
            payload.delivery_date,
            payload.expected_delivery_date || null,
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
            deliverychallanId,
            companyId
        ];

        const deliverychallanRes = await client.query(updateDeliveryChallanSql, deliverychallanParams);

        if (deliverychallanRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Delivery Challan not found" });
        }

        const existingItemsRes = await client.query(
            'SELECT delivery_challan_item_id FROM tbl_delivery_challan_items WHERE delivery_challan_id = $1 AND is_deleted = FALSE',
            [deliverychallanId]
        );
        const existingItemIds = existingItemsRes.rows.map(r => r.delivery_challan_item_id);

        const keptItemIds = [];
        const processedItems = [];

        const insertItemSql = `INSERT INTO tbl_delivery_challan_items (
            delivery_challan_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        const updateItemSql = `UPDATE tbl_delivery_challan_items SET
            item_id = $1, description = $2, quantity = $3, hsn_code = $4, unit_id = $5, unit_rate = $6,
            total_rate = $7, discount_percent = $8, discount_flat = $9, tax_percent = $10, tax_amount = $11,
            total_amount = $12, updated_at = CURRENT_TIMESTAMP
            WHERE delivery_challan_item_id = $13 AND delivery_challan_id = $14 AND company_id = $15 AND is_deleted = FALSE
            RETURNING *`;

        for (const it of priced.items) {
            if (it.delivery_challan_item_id && existingItemIds.includes(it.delivery_challan_item_id)) {
                const params = [
                    it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, it.delivery_challan_item_id, deliverychallanId, companyId
                ];
                const r = await client.query(updateItemSql, params);
                if (r.rowCount) {
                    keptItemIds.push(r.rows[0].delivery_challan_item_id);
                    processedItems.push(r.rows[0]);
                }
            } else {
                const params = [
                    deliverychallanId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, userId, companyId
                ];
                const r = await client.query(insertItemSql, params);
                keptItemIds.push(r.rows[0].delivery_challan_item_id);
                processedItems.push(r.rows[0]);
            }
        }

        const toDelete = existingItemIds.filter(id => !keptItemIds.includes(id));
        if (toDelete.length) {
            await client.query('UPDATE tbl_delivery_challan_items SET is_deleted = TRUE WHERE delivery_challan_item_id = ANY($1)', [toDelete]);
        }

        const existingTaxesRes = await client.query(
            'SELECT tax_detail_id FROM tbl_delivery_challan_tax_details WHERE delivery_challan_id = $1 AND is_deleted = FALSE',
            [deliverychallanId]
        );
        const existingTaxIds = existingTaxesRes.rows.map(r => r.tax_detail_id);
        const keptTaxIds = [];
        const processedTaxes = [];

        const insertTaxSql = `INSERT INTO tbl_delivery_challan_tax_details (
            delivery_challan_id, delivery_challan_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const updateTaxSql = `UPDATE tbl_delivery_challan_tax_details SET
            delivery_challan_item_id = $1, tax_id = $2, taxable_amount = $3, tax_percentage = $4, tax_amount = $5, is_deleted = $6
            WHERE tax_detail_id = $7 AND delivery_challan_id = $8 AND is_deleted = FALSE
            RETURNING *`;

        const itemIndexToId = processedItems.map(it => it.delivery_challan_item_id);

        for (const t of taxDetails) {
            const delivery_challan_item_id = resolveDeliveryChallanItemLink(itemIndexToId, t);

            if (t.tax_detail_id && existingTaxIds.includes(t.tax_detail_id)) {
                const params = [
                    delivery_challan_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false,
                    t.tax_detail_id, deliverychallanId
                ];
                const r = await client.query(updateTaxSql, params);
                if (r.rowCount) {
                    keptTaxIds.push(r.rows[0].tax_detail_id);
                    processedTaxes.push(r.rows[0]);
                }
            } else {
                const params = [
                    deliverychallanId, delivery_challan_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false
                ];
                const r = await client.query(insertTaxSql, params);
                keptTaxIds.push(r.rows[0].tax_detail_id);
                processedTaxes.push(r.rows[0]);
            }
        }

        const taxesToDelete = existingTaxIds.filter(id => !keptTaxIds.includes(id));
        if (taxesToDelete.length) {
            await client.query('UPDATE tbl_delivery_challan_tax_details SET is_deleted = TRUE WHERE tax_detail_id = ANY($1)', [taxesToDelete]);
        }

        await logAudit(client, {
            module_name: "Delivery Challan",
            page_name: "Update Delivery Challan",
            table_name: "tbl_delivery_challan",
            table_id: deliverychallanId,
            action_type: "UPDATE",
            action_description: "Delivery Challan Updated Successfully",
            new_value: JSON.stringify(deliverychallanRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Delivery Challan Updated',
            DeliveryChallans: deliverychallanRes.rows[0],
            itemsDetails: processedItems,
            taxDetails: processedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updateDeliveryChallan]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Update Delivery Challan", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteDeliveryChallan(req, res) {
    const { companyId } = req.session.user;
    const { deliverychallanId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const result = await deleteModule(client, 'tbl_delivery_challan', 'delivery_challan_id', deliverychallanId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Delivery Challan not found" });
        }
        const itemsResult = await deleteModule(client, 'tbl_delivery_challan_items', 'delivery_challan_id', deliverychallanId, { company_id: companyId });
        const taxResult = await deleteModule(client, 'tbl_delivery_challan_tax_details', 'delivery_challan_id', deliverychallanId);

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Delivery Challan Deleted',
            DeliveryChallans: result.result,
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteDeliveryChallan]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Delivery Challan", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteDeliveryChallanItems(req, res) {
    const { companyId } = req.session.user;
    const { deliverychallanId, deliverychallanItemId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const itemsResult = await deleteModule(client, 'tbl_delivery_challan_items', 'delivery_challan_item_id', deliverychallanItemId, { delivery_challan_id: deliverychallanId, company_id: companyId });

        if (itemsResult.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Delivery Challan item not found" });
        }

        const taxResult = await deleteModule(client, 'tbl_delivery_challan_tax_details', 'delivery_challan_item_id', deliverychallanItemId, { delivery_challan_id: deliverychallanId });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Delivery Challan Item Deleted',
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteDeliveryChallanItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Delivery Challan Items", details: err.message });

    } finally {
        client.release();
    }
}

export async function changeStatus(req, res) {
    const { userId, companyId, roleId, fullName } = req.session.user;
    const { deliverychallanId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");

        const allowedStatuses = ["draft", "issued", "partially_delivered", "delivered", "closed", "cancelled"];
        if (!allowedStatuses.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid Delivery Challan status: ${status}` });
        }

        // Get current deliverychallan
        const deliverychallanQuery = `SELECT * FROM tbl_delivery_challan WHERE delivery_challan_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`;
        const deliverychallanResult = await client.query(deliverychallanQuery, [deliverychallanId, companyId]);

        if (deliverychallanResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Delivery Challan not found" });
        }

        const deliverychallan = deliverychallanResult.rows[0];
        const currentStatus = deliverychallan.status;
        // Same status
        if (currentStatus === status) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Delivery Challan is already ${status}` });
        }

        // Check transition
        if (!isValidStatusTransition(currentStatus, status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Delivery Challan status cannot be changed from '${currentStatus}' to '${status}'` });
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
        const updateQuery = `UPDATE tbl_delivery_challan SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE delivery_challan_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`;
        const result = await client.query(updateQuery, [deliverychallanId, companyId, status]);
        const updatedDeliveryChallan = result.rows[0];

        await logAudit(client, {
            module_name: "Delivery Challan",
            page_name: "Delivery Challan Status",
            table_name: "tbl_delivery_challan",
            table_id: deliverychallanId,
            action_type: "STATUS_CHANGE",
            action_description: `Delivery Challan status changed from ${currentStatus} to ${status} by ${userName}`,
            old_value: JSON.stringify(deliverychallan),
            new_value: JSON.stringify(updatedDeliveryChallan),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Delivery Challan status changed from '${currentStatus}' to '${status}'`,
            DeliveryChallans: updatedDeliveryChallan
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStatus]", err);
        return res.status(500).json({
            success: false,
            error: "Failed to change status of Delivery Challan",
            details: err.message
        });
    } finally {
        client.release();
    }
}

///////////////////////////Delivery Challan Module End /////////////////////////////