// controllers/purchaseorderController.js
import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js"
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule, priceCalculationFromDatabase, num } from "../services/allService.js"

export function resolvePurchaseOrderItemLink(insertedItemIds = [], taxDetail = {}) {
    if (!Array.isArray(insertedItemIds)) return null;

    const indexValue = taxDetail.purchase_order_item_index;
    if (indexValue !== undefined && indexValue !== null && indexValue !== "") {
        const index = Number(indexValue);
        if (Number.isInteger(index) && insertedItemIds[index] !== undefined) {
            return insertedItemIds[index];
        }
    }

    const directValue = taxDetail.purchase_order_item_id;
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
    const priced = await priceCalculationFromDatabase(client, itemsDetails, payload, "purchase");
    priced.items = priced.items.map((it, idx) => ({
        purchase_order_item_id: itemsDetails[idx]?.purchase_order_item_id || null,
        ...it,
    }));
    return priced;
}


/// status update flow
const ALLOWED_STATUS_TRANSITIONS = {
    draft: ["approved", "cancelled", "rejected"],
    approved: ["sent", "cancelled", "rejected"],
    sent: ["confirmed", "cancelled", "rejected"],
    confirmed: ["processing", "cancelled"],
    processing: ["partially_received", "received", "cancelled"],
    partially_received: ["received", "cancelled"],
    received: ["closed"],
    closed: [],
    cancelled: [],
    rejected: []
};
function isValidStatusTransition(currentStatus, newStatus) {
    return ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

///////////////////////////Purchase Order Module Start /////////////////////////////
export async function getPurchaseOrders(req, res) {
    const { companyId } = req.session.user;
    const { purchaseOrderId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    let result;

    try {
        if (purchaseOrderId) {
            const query = `SELECT po.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_purchase_order_items AS items
                 WHERE items.purchase_order_id = po.purchase_order_id AND items.company_id = po.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_purchase_order_tax_details AS tax
                 WHERE tax.purchase_order_id = po.purchase_order_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_purchase_orders AS po
            WHERE po.purchase_order_id = $1 AND po.company_id = $2 AND po.is_deleted = FALSE`;
            result = await companyPool.query(query, [purchaseOrderId, companyId]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Purchase Order not found" });
            }
        } else {
            const query = `SELECT po.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_purchase_order_items AS items
                 WHERE items.purchase_order_id = po.purchase_order_id AND items.company_id = po.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_purchase_order_tax_details AS tax
                 WHERE tax.purchase_order_id = po.purchase_order_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_purchase_orders AS po
            WHERE po.company_id = $1 AND po.is_deleted = FALSE
            ORDER BY po.purchase_order_no ASC`;
            result = await companyPool.query(query, [companyId]);
        }

        return res.status(200).json({ message: "Purchase Order Fetch Successfully", PurchaseOrders: result.rows });

    } catch (err) {
        console.error("[getPurchaseOrders]", err);
        return res.status(500).json({ error: "Failed to fetch Purchase Order List", details: err.message });
    }
}

export async function createPurchaseOrder(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.purchase_order_date) {
            return res.status(400).json({ success: false, error: "purchase_order_date is required" });
        }

        // Recompute every money figure server-side from qty/rate/discount/tax%.
        const priced = await priceItems(client, payload.itemsDetails, payload);
        const taxDetails = priced.taxDetails;

        await client.query('BEGIN');

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.PURCHASE_ORDER,
            companyId,
            userId,
            financialYearId,
            client
        });
        const purchaseOrderNo = seriesResult.series;

        const insertPurchaseOrderSql = `INSERT INTO tbl_purchase_orders (
            purchase_order_no, party_id, purchase_order_date, due_date,
            billing_address_id, shipping_address_id, payment_term_id, currency_id,
            subtotal_amount, discount_value, total_tax_amount,
            shipping_charges, round_off, total_amount, paid_amount, balance_due,
            terms_conditions, notes, status, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        RETURNING *`;

        const purchaseOrderParams = [
            purchaseOrderNo,
            payload.party_id,
            payload.purchase_order_date,
            payload.due_date || null,
            payload.billing_address_id || null,
            payload.shipping_address_id || null,
            payload.payment_term_id || null,
            payload.currency_id || null,
            priced.subtotal_amount,
            // priced.discount_type,
            priced.discount_value,
            priced.total_tax_amount,
            priced.shipping_charges,
            priced.round_off,
            priced.total_amount,
            priced.paid_amount,
            priced.balance_due,
            payload.terms_conditions || null,
            payload.notes || null,
            payload.status || 'draft',
            userId,
            companyId
        ];

        const purchaseOrderRes = await client.query(insertPurchaseOrderSql, purchaseOrderParams);
        const purchaseOrderId = purchaseOrderRes.rows[0].purchase_order_id;

        const insertedItemIds = [];
        const insertedItems = [];
        const insertItemSql = `INSERT INTO tbl_purchase_order_items (
            purchase_order_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        for (const it of priced.items) {
            const itemParams = [
                purchaseOrderId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id,
                it.unit_rate, it.total_rate, it.discount_percent, it.discount_flat,
                it.tax_percent, it.tax_amount, it.total_amount, userId, companyId
            ];
            const r = await client.query(insertItemSql, itemParams);
            insertedItemIds.push(r.rows[0].purchase_order_item_id);
            insertedItems.push(r.rows[0]);
        }

        const insertTaxSql = `INSERT INTO tbl_purchase_order_tax_details (
            purchase_order_id, purchase_order_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const insertedTaxes = [];
        for (const t of priced.taxDetails) {
            const purchaseOrderItemId = resolvePurchaseOrderItemLink(insertedItemIds, t);
            const taxParams = [
                purchaseOrderId, purchaseOrderItemId, t.tax_id || null,
                num(t.taxable_amount, null), num(t.tax_percentage, null), num(t.tax_amount, null),
                false
            ];
            const r = await client.query(insertTaxSql, taxParams);
            insertedTaxes.push(r.rows[0]);
        }

        await logAudit(client, {
            module_name: "Purchase Order",
            page_name: "Create Purchase Order",
            table_name: "tbl_purchase_orders",
            table_id: purchaseOrderId,
            action_type: "CREATE",
            action_description: `Purchase Order Created Successfully : ${purchaseOrderNo}`,
            new_value: JSON.stringify(purchaseOrderRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Purchase Order created',
            PurchaseOrders: purchaseOrderRes.rows[0],
            itemsDetails: insertedItems,
            taxDetails: insertedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createPurchaseOrder]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Purchase Order", details: err.message });

    } finally {
        client.release();
    }
}

export async function updatePurchaseOrder(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const { purchaseOrderId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.purchase_order_date) {
            return res.status(400).json({ success: false, error: "purchase_order_date is required" });
        }

        const priced = await priceItems(client, payload.itemsDetails, payload);
        const taxDetails = priced.taxDetails;

        await client.query('BEGIN');

        //Check purchase_order
        const purchaseOrderQuery = await client.query(
            `SELECT purchase_order_id, status FROM tbl_purchase_orders
             WHERE purchase_order_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [purchaseOrderId, companyId]
        );
        if (purchaseOrderQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Purchase Order not found' });
        }
        const purchase_order = purchaseOrderQuery.rows[0];
        if (purchase_order.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: `Purchase Order cannot be updated because its status is '${purchase_order.status}'` });
        }

        const updatePurchaseOrderSql = `UPDATE tbl_purchase_orders SET
            party_id = $1, purchase_order_date = $2, due_date = $3, 
            billing_address_id = $4, shipping_address_id = $5, payment_term_id = $6, currency_id = $7,
            subtotal_amount = $8, discount_value = $9, total_tax_amount = $10,
            shipping_charges = $11, round_off = $12, total_amount = $13, paid_amount = $14, balance_due = $15,
            terms_conditions = $16, notes = $17, status = $18, updated_at = CURRENT_TIMESTAMP
            WHERE purchase_order_id = $19 AND is_deleted = FALSE AND company_id = $20
            RETURNING *`;

        const purchaseOrderParams = [
            payload.party_id,
            payload.purchase_order_date,
            payload.due_date || null,
            payload.billing_address_id || null,
            payload.shipping_address_id || null,
            payload.payment_term_id || null,
            payload.currency_id || null,
            priced.subtotal_amount,
            // priced.discount_type,
            priced.discount_value,
            priced.total_tax_amount,
            priced.shipping_charges,
            priced.round_off,
            priced.total_amount,
            priced.paid_amount,
            priced.balance_due,
            payload.terms_conditions || null,
            payload.notes || null,
            payload.status || 'draft',
            purchaseOrderId,
            companyId
        ];

        const purchaseOrderRes = await client.query(updatePurchaseOrderSql, purchaseOrderParams);

        if (purchaseOrderRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Purchase Order not found" });
        }

        const existingItemsRes = await client.query(
            'SELECT purchase_order_item_id FROM tbl_purchase_order_items WHERE purchase_order_id = $1 AND is_deleted = FALSE',
            [purchaseOrderId]
        );
        const existingItemIds = existingItemsRes.rows.map(r => r.purchase_order_item_id);

        const keptItemIds = [];
        const processedItems = [];

        const insertItemSql = `INSERT INTO tbl_purchase_order_items (
            purchase_order_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        const updateItemSql = `UPDATE tbl_purchase_order_items SET
            item_id = $1, description = $2, quantity = $3, hsn_code = $4, unit_id = $5, unit_rate = $6,
            total_rate = $7, discount_percent = $8, discount_flat = $9, tax_percent = $10, tax_amount = $11,
            total_amount = $12, updated_at = CURRENT_TIMESTAMP
            WHERE purchase_order_item_id = $13 AND purchase_order_id = $14 AND company_id = $15 AND is_deleted = FALSE
            RETURNING *`;

        for (const it of priced.items) {
            if (it.purchase_order_item_id && existingItemIds.includes(it.purchase_order_item_id)) {
                const params = [
                    it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, it.purchase_order_item_id, purchaseOrderId, companyId
                ];
                const r = await client.query(updateItemSql, params);
                if (r.rowCount) {
                    keptItemIds.push(r.rows[0].purchase_order_item_id);
                    processedItems.push(r.rows[0]);
                }
            } else {
                const params = [
                    purchaseOrderId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, userId, companyId
                ];
                const r = await client.query(insertItemSql, params);
                keptItemIds.push(r.rows[0].purchase_order_item_id);
                processedItems.push(r.rows[0]);
            }
        }

        const toDelete = existingItemIds.filter(id => !keptItemIds.includes(id));
        if (toDelete.length) {
            await client.query('UPDATE tbl_purchase_order_items SET is_deleted = TRUE WHERE purchase_order_item_id = ANY($1)', [toDelete]);
        }

        const existingTaxesRes = await client.query(
            'SELECT tax_detail_id FROM tbl_purchase_order_tax_details WHERE purchase_order_id = $1 AND is_deleted = FALSE',
            [purchaseOrderId]
        );
        const existingTaxIds = existingTaxesRes.rows.map(r => r.tax_detail_id);
        const keptTaxIds = [];
        const processedTaxes = [];

        const insertTaxSql = `INSERT INTO tbl_purchase_order_tax_details (
            purchase_order_id, purchase_order_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const updateTaxSql = `UPDATE tbl_purchase_order_tax_details SET
            purchase_order_item_id = $1, tax_id = $2, taxable_amount = $3, tax_percentage = $4, tax_amount = $5, is_deleted = $6
            WHERE tax_detail_id = $7 AND purchase_order_id = $8 AND is_deleted = FALSE
            RETURNING *`;

        const itemIndexToId = processedItems.map(it => it.purchase_order_item_id);

        for (const t of priced.taxDetails) {
            const purchase_order_item_id = resolvePurchaseOrderItemLink(itemIndexToId, t);

            if (t.tax_detail_id && existingTaxIds.includes(t.tax_detail_id)) {
                const params = [
                    purchase_order_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false,
                    t.tax_detail_id, purchaseOrderId
                ];
                const r = await client.query(updateTaxSql, params);
                if (r.rowCount) {
                    keptTaxIds.push(r.rows[0].tax_detail_id);
                    processedTaxes.push(r.rows[0]);
                }
            } else {
                const params = [
                    purchaseOrderId, purchase_order_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false
                ];
                const r = await client.query(insertTaxSql, params);
                keptTaxIds.push(r.rows[0].tax_detail_id);
                processedTaxes.push(r.rows[0]);
            }
        }

        const taxesToDelete = existingTaxIds.filter(id => !keptTaxIds.includes(id));
        if (taxesToDelete.length) {
            await client.query('UPDATE tbl_purchase_order_tax_details SET is_deleted = TRUE WHERE tax_detail_id = ANY($1)', [taxesToDelete]);
        }

        await logAudit(client, {
            module_name: "Purchase Order",
            page_name: "Update Purchase Order",
            table_name: "tbl_purchase_orders",
            table_id: purchaseOrderId,
            action_type: "UPDATE",
            action_description: "Purchase Order Updated Successfully",
            new_value: JSON.stringify(purchaseOrderRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Purchase Order Updated',
            PurchaseOrders: purchaseOrderRes.rows[0],
            itemsDetails: processedItems,
            taxDetails: processedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updatePurchaseOrder]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Update Purchase Order", details: err.message });

    } finally {
        client.release();
    }
}

export async function deletePurchaseOrder(req, res) {
    const { companyId } = req.session.user;
    const { purchaseOrderId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const result = await deleteModule(client, 'tbl_purchase_orders', 'purchase_order_id', purchaseOrderId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Purchase Order not found" });
        }
        const itemsResult = await deleteModule(client, 'tbl_purchase_order_items', 'purchase_order_id', purchaseOrderId, { company_id: companyId });
        const taxResult = await deleteModule(client, 'tbl_purchase_order_tax_details', 'purchase_order_id', purchaseOrderId);

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Purchase Order Deleted',
            PurchaseOrders: result.result,
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deletePurchaseOrder]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Purchase Order", details: err.message });

    } finally {
        client.release();
    }
}

export async function deletePurchaseOrderItems(req, res) {
    const { companyId } = req.session.user;
    const { purchaseOrderId, purchaseOrderItemId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const itemsResult = await deleteModule(client, 'tbl_purchase_order_items', 'purchase_order_item_id', purchaseOrderItemId, { purchase_order_id: purchaseOrderId, company_id: companyId });

        if (itemsResult.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Purchase Order item not found" });
        }

        const taxResult = await deleteModule(client, 'tbl_purchase_order_tax_details', 'purchase_order_item_id', purchaseOrderItemId, { purchase_order_id: purchaseOrderId });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Purchase Order Item Deleted',
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deletePurchaseOrderItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Purchase Order Items", details: err.message });

    } finally {
        client.release();
    }
}

export async function changeStatus(req, res) {
    const { userId, companyId, roleId, fullName } = req.session.user;
    const { purchaseOrderId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");

        const allowedStatuses = ["draft", "approved", "sent", "confirmed", "processing", "partially_received", "received", "closed", "cancelled", "rejected"];
        if (!allowedStatuses.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid purchase order status: ${status}` });
        }

        // Get current purchase_order
        const purchaseOrderQuery = `SELECT * FROM tbl_purchase_orders WHERE purchase_order_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`;
        const purchaseOrderResult = await client.query(purchaseOrderQuery, [purchaseOrderId, companyId]);

        if (purchaseOrderResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Purchase Order not found" });
        }

        const purchase_order = purchaseOrderResult.rows[0];
        const currentStatus = purchase_order.status;
        // Same status
        if (currentStatus === status) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Purchase Order is already ${status}` });
        }

        // Check transition
        if (!isValidStatusTransition(currentStatus, status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Purchase Order status cannot be changed from '${currentStatus}' to '${status}'` });
        }

        // Get user name for audit
        const userQuery = await client.query(`SELECT first_name, last_name, email FROM users WHERE user_id = $1 AND company_id = $2`,
            [userId, companyId]
        );
        const user = userQuery.rows[0];
        const user_name = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
        const userName = user_name || user?.email || fullName || "Unknown User";

        // Update status
        const updateQuery = `UPDATE tbl_purchase_orders SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE purchase_order_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`;
        const result = await client.query(updateQuery, [purchaseOrderId, companyId, status]);
        const updatedPurchaseOrder = result.rows[0];

        await logAudit(client, {
            module_name: "Purchase Order",
            page_name: "Purchase Order Status",
            table_name: "tbl_purchase_orders",
            table_id: purchaseOrderId,
            action_type: "STATUS_CHANGE",
            action_description: `Purchase Order status changed from ${currentStatus} to ${status} by ${userName}`,
            old_value: JSON.stringify(purchase_order),
            new_value: JSON.stringify(updatedPurchaseOrder),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Purchase Order status changed from '${currentStatus}' to '${status}'`,
            PurchaseOrders: updatedPurchaseOrder
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStatus]", err);
        return res.status(500).json({
            success: false,
            error: "Failed to change status of Purchase Order",
            details: err.message
        });
    } finally {
        client.release();
    }
}

///////////////////////////Purchase Order Module End /////////////////////////////