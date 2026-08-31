// controllers/salesorderController.js
import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js"
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule, priceCalculationFromDatabase, num } from "../services/commonService.js"

export function resolveSalesOrderItemLink(insertedItemIds = [], taxDetail = {}) {
    if (!Array.isArray(insertedItemIds)) return null;

    const indexValue = taxDetail.sales_order_item_index;
    if (indexValue !== undefined && indexValue !== null && indexValue !== "") {
        const index = Number(indexValue);
        if (Number.isInteger(index) && insertedItemIds[index] !== undefined) {
            return insertedItemIds[index];
        }
    }

    const directValue = taxDetail.sales_order_item_id;
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
        sales_order_item_id: itemsDetails[idx]?.sales_order_item_id || null,
        ...it,
    }));
    return priced;
}


/// status update flow
const ALLOWED_STATUS_TRANSITIONS = {
    draft: ["approved", "cancelled", "rejected"],

    approved: ["confirmed", "cancelled", "rejected"],

    confirmed: ["processing", "cancelled"],

    processing: ["partially_delivered", "delivered", "cancelled"],

    partially_delivered: ["delivered", "cancelled"],

    delivered: ["closed"],

    closed: [],

    cancelled: [],

    rejected: []
};

function isValidStatusTransition(currentStatus, newStatus) {
    return ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

///////////////////////////Sales Order Module Start /////////////////////////////
export async function getSalesOrders(req, res) {
    const { companyId } = req.session.user;
    const { salesOrderId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    let result;

    try {
        if (salesOrderId) {
            const query = `SELECT so.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_sales_order_items AS items
                 WHERE items.sales_order_id = so.sales_order_id AND items.company_id = so.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_sales_order_tax_details AS tax
                 WHERE tax.sales_order_id = so.sales_order_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_sales_order AS so
            WHERE so.sales_order_id = $1 AND so.company_id = $2 AND so.is_deleted = FALSE`;
            result = await companyPool.query(query, [salesOrderId, companyId]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Sales Order not found" });
            }
        } else {
            const query = `SELECT so.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_sales_order_items AS items
                 WHERE items.sales_order_id = so.sales_order_id AND items.company_id = so.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_sales_order_tax_details AS tax
                 WHERE tax.sales_order_id = so.sales_order_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_sales_order AS so
            WHERE so.company_id = $1 AND so.is_deleted = FALSE
            ORDER BY so.sales_order_no ASC`;
            result = await companyPool.query(query, [companyId]);
        }

        return res.status(200).json({ message: "Sales Order Fetch Successfully", SalesOrders: result.rows });

    } catch (err) {
        console.error("[getSalesOrders]", err);
        return res.status(500).json({ error: "Failed to fetch Sales Order List", details: err.message });
    }
}

export async function createSalesOrder(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.sales_order_date) {
            return res.status(400).json({ success: false, error: "sales_order_date is required" });
        }

        // Recompute every money figure server-side from qty/rate/discount/tax%.
        const priced = await priceItems(client, payload.itemsDetails, payload);
        const taxDetails = priced.taxDetails;

        await client.query('BEGIN');

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.SALES_ORDER,
            companyId,
            userId,
            financialYearId,
            client
        });
        const salesOrderNo = seriesResult.series;

        const insertSalesOrderSql = `INSERT INTO tbl_sales_order (
            sales_order_no, party_id, sales_order_date, expected_delivery_date, quotation_id, quotation_no, customer_po_no, customer_po_date, 
            billing_address_id, shipping_address_id, payment_term_id, currency_id,
            subtotal_amount, discount_value, total_tax_amount,
            shipping_charges, round_off, total_amount, paid_amount, balance_due,
            terms_conditions, notes, status, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
        RETURNING *`;

        const salesOrderParams = [
            salesOrderNo,
            payload.party_id,
            payload.sales_order_date,
            payload.expected_delivery_date || null,
            payload.quotation_id || null,
            payload.quotation_no || null,
            payload.customer_po_no || null,
            payload.customer_po_date || null,
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

        const salesOrderRes = await client.query(insertSalesOrderSql, salesOrderParams);
        const salesOrderId = salesOrderRes.rows[0].sales_order_id;

        const insertedItemIds = [];
        const insertedItems = [];
        const insertItemSql = `INSERT INTO tbl_sales_order_items (
            sales_order_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        for (const it of priced.items) {
            const itemParams = [
                salesOrderId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id,
                it.unit_rate, it.total_rate, it.discount_percent, it.discount_flat,
                it.tax_percent, it.tax_amount, it.total_amount, userId, companyId
            ];
            const r = await client.query(insertItemSql, itemParams);
            insertedItemIds.push(r.rows[0].sales_order_item_id);
            insertedItems.push(r.rows[0]);
        }

        const insertTaxSql = `INSERT INTO tbl_sales_order_tax_details (
            sales_order_id, sales_order_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const insertedTaxes = [];
        for (const t of priced.taxDetails) {
            const salesOrderItemId = resolveSalesOrderItemLink(insertedItemIds, t);
            const taxParams = [
                salesOrderId, salesOrderItemId, t.tax_id || null,
                num(t.taxable_amount, null), num(t.tax_percentage, null), num(t.tax_amount, null),
                false
            ];
            const r = await client.query(insertTaxSql, taxParams);
            insertedTaxes.push(r.rows[0]);
        }

        await logAudit(client, {
            module_name: "Sales Order",
            page_name: "Create Sales Order",
            table_name: "tbl_sales_order",
            table_id: salesOrderId,
            action_type: "CREATE",
            action_description: `Sales Order Created Successfully :${salesOrderNo}`,
            new_value: JSON.stringify(salesOrderRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Sales Order created',
            SalesOrders: salesOrderRes.rows[0],
            itemsDetails: insertedItems,
            taxDetails: insertedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createSalesOrder]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Sales Order", details: err.message });

    } finally {
        client.release();
    }
}

export async function updateSalesOrder(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const { salesOrderId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.sales_order_date) {
            return res.status(400).json({ success: false, error: "sales_order_date is required" });
        }

        const priced = await priceItems(client, payload.itemsDetails, payload);
        const taxDetails = priced.taxDetails;

        await client.query('BEGIN');

        //Check sales_order
        const salesOrderQuery = await client.query(
            `SELECT sales_order_id, status FROM tbl_sales_order
             WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [salesOrderId, companyId]
        );
        if (salesOrderQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Sales Order not found' });
        }
        const sales_order = salesOrderQuery.rows[0];
        if (sales_order.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: `Sales Order cannot be updated because its status is '${sales_order.status}'` });
        }

        const updateSalesOrderSql = `UPDATE tbl_sales_order SET
            party_id = $1, sales_order_date = $2, expected_delivery_date = $3, quotation_id = $4, quotation_no = $5, customer_po_no = $6, customer_po_date = $7,
            billing_address_id = $8, shipping_address_id = $9, payment_term_id = $10, currency_id = $11,
            subtotal_amount = $12, discount_value = $13, total_tax_amount = $14,
            shipping_charges = $15, round_off = $16, total_amount = $17, paid_amount = $18, balance_due = $19,
            terms_conditions = $20, notes = $21, status = $22, updated_at = CURRENT_TIMESTAMP
            WHERE sales_order_id = $23 AND is_deleted = FALSE AND company_id = $24
            RETURNING *`;

        const salesOrderParams = [
            payload.party_id,
            payload.sales_order_date,
            payload.expected_delivery_date || null,
            payload.quotation_id || null,
            payload.quotation_no || null,
            payload.customer_po_no || null,
            payload.customer_po_date || null,
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
            salesOrderId,
            companyId
        ];

        const salesOrderRes = await client.query(updateSalesOrderSql, salesOrderParams);

        if (salesOrderRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Sales Order not found" });
        }

        const existingItemsRes = await client.query(
            'SELECT sales_order_item_id FROM tbl_sales_order_items WHERE sales_order_id = $1 AND is_deleted = FALSE',
            [salesOrderId]
        );
        const existingItemIds = existingItemsRes.rows.map(r => r.sales_order_item_id);

        const keptItemIds = [];
        const processedItems = [];

        const insertItemSql = `INSERT INTO tbl_sales_order_items (
            sales_order_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        const updateItemSql = `UPDATE tbl_sales_order_items SET
            item_id = $1, description = $2, quantity = $3, hsn_code = $4, unit_id = $5, unit_rate = $6,
            total_rate = $7, discount_percent = $8, discount_flat = $9, tax_percent = $10, tax_amount = $11,
            total_amount = $12, updated_at = CURRENT_TIMESTAMP
            WHERE sales_order_item_id = $13 AND sales_order_id = $14 AND company_id = $15 AND is_deleted = FALSE
            RETURNING *`;

        for (const it of priced.items) {
            if (it.sales_order_item_id && existingItemIds.includes(it.sales_order_item_id)) {
                const params = [
                    it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, it.sales_order_item_id, salesOrderId, companyId
                ];
                const r = await client.query(updateItemSql, params);
                if (r.rowCount) {
                    keptItemIds.push(r.rows[0].sales_order_item_id);
                    processedItems.push(r.rows[0]);
                }
            } else {
                const params = [
                    salesOrderId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, userId, companyId
                ];
                const r = await client.query(insertItemSql, params);
                keptItemIds.push(r.rows[0].sales_order_item_id);
                processedItems.push(r.rows[0]);
            }
        }

        const toDelete = existingItemIds.filter(id => !keptItemIds.includes(id));
        if (toDelete.length) {
            await client.query('UPDATE tbl_sales_order_items SET is_deleted = TRUE WHERE sales_order_item_id = ANY($1)', [toDelete]);
        }

        const existingTaxesRes = await client.query(
            'SELECT tax_detail_id FROM tbl_sales_order_tax_details WHERE sales_order_id = $1 AND is_deleted = FALSE',
            [salesOrderId]
        );
        const existingTaxIds = existingTaxesRes.rows.map(r => r.tax_detail_id);
        const keptTaxIds = [];
        const processedTaxes = [];

        const insertTaxSql = `INSERT INTO tbl_sales_order_tax_details (
            sales_order_id, sales_order_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const updateTaxSql = `UPDATE tbl_sales_order_tax_details SET
            sales_order_item_id = $1, tax_id = $2, taxable_amount = $3, tax_percentage = $4, tax_amount = $5, is_deleted = $6
            WHERE tax_detail_id = $7 AND sales_order_id = $8 AND is_deleted = FALSE
            RETURNING *`;

        const itemIndexToId = processedItems.map(it => it.sales_order_item_id);

        for (const t of priced.taxDetails) {
            const sales_order_item_id = resolveSalesOrderItemLink(itemIndexToId, t);

            if (t.tax_detail_id && existingTaxIds.includes(t.tax_detail_id)) {
                const params = [
                    sales_order_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false,
                    t.tax_detail_id, salesOrderId
                ];
                const r = await client.query(updateTaxSql, params);
                if (r.rowCount) {
                    keptTaxIds.push(r.rows[0].tax_detail_id);
                    processedTaxes.push(r.rows[0]);
                }
            } else {
                const params = [
                    salesOrderId, sales_order_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false
                ];
                const r = await client.query(insertTaxSql, params);
                keptTaxIds.push(r.rows[0].tax_detail_id);
                processedTaxes.push(r.rows[0]);
            }
        }

        const taxesToDelete = existingTaxIds.filter(id => !keptTaxIds.includes(id));
        if (taxesToDelete.length) {
            await client.query('UPDATE tbl_sales_order_tax_details SET is_deleted = TRUE WHERE tax_detail_id = ANY($1)', [taxesToDelete]);
        }

        await logAudit(client, {
            module_name: "Sales Order",
            page_name: "Update Sales Order",
            table_name: "tbl_sales_order",
            table_id: salesOrderId,
            action_type: "UPDATE",
            action_description: "Sales Order Updated Successfully",
            new_value: JSON.stringify(salesOrderRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Sales Order Updated',
            SalesOrders: salesOrderRes.rows[0],
            itemsDetails: processedItems,
            taxDetails: processedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updateSalesOrder]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Update Sales Order", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteSalesOrder(req, res) {
    const { companyId } = req.session.user;
    const { salesOrderId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const result = await deleteModule(client, 'tbl_sales_order', 'sales_order_id', salesOrderId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Sales Order not found" });
        }
        const itemsResult = await deleteModule(client, 'tbl_sales_order_items', 'sales_order_id', salesOrderId, { company_id: companyId });
        const taxResult = await deleteModule(client, 'tbl_sales_order_tax_details', 'sales_order_id', salesOrderId);

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Sales Order Deleted',
            SalesOrders: result.result,
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteSalesOrder]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Sales Order", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteSalesOrderItems(req, res) {
    const { companyId } = req.session.user;
    const { salesOrderId, salesOrderItemId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const itemsResult = await deleteModule(client, 'tbl_sales_order_items', 'sales_order_item_id', salesOrderItemId, { sales_order_id: salesOrderId, company_id: companyId });

        if (itemsResult.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Sales Order item not found" });
        }

        const taxResult = await deleteModule(client, 'tbl_sales_order_tax_details', 'sales_order_item_id', salesOrderItemId, { sales_order_id: salesOrderId });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Sales Order Item Deleted',
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteSalesOrderItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Sales Order Items", details: err.message });

    } finally {
        client.release();
    }
}

export async function changeStatus(req, res) {
    const { userId, companyId, roleId, fullName } = req.session.user;
    const { salesOrderId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");

        const allowedStatuses = ["draft", "approved", "confirmed", "processing", "partially_delivered", "delivered", "closed", "cancelled", "rejected"];
        if (!allowedStatuses.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid sales order status: ${status}` });
        }

        // Get current sales_order
        const salesOrderQuery = `SELECT * FROM tbl_sales_order WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`;
        const salesOrderResult = await client.query(salesOrderQuery, [salesOrderId, companyId]);

        if (salesOrderResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Sales Order not found" });
        }

        const sales_order = salesOrderResult.rows[0];
        const currentStatus = sales_order.status;
        // Same status
        if (currentStatus === status) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Sales Order is already ${status}` });
        }

        // Check transition
        if (!isValidStatusTransition(currentStatus, status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Sales Order status cannot be changed from '${currentStatus}' to '${status}'` });
        }

        // Get user name for audit
        const userQuery = await client.query(`SELECT first_name, last_name, email FROM users WHERE user_id = $1 AND company_id = $2`,
            [userId, companyId]
        );
        const user = userQuery.rows[0];
        const user_name = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
        const userName = user_name || user?.email || fullName || "Unknown User";

        // Update status
        const updateQuery = `UPDATE tbl_sales_order SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`;
        const result = await client.query(updateQuery, [salesOrderId, companyId, status]);
        const updatedSalesOrder = result.rows[0];

        await logAudit(client, {
            module_name: "Sales Order",
            page_name: "Sales Order Status",
            table_name: "tbl_sales_order",
            table_id: salesOrderId,
            action_type: "STATUS_CHANGE",
            action_description: `Sales Order status changed from ${currentStatus} to ${status} by ${userName}`,
            old_value: JSON.stringify(sales_order),
            new_value: JSON.stringify(updatedSalesOrder),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Sales Order status changed from '${currentStatus}' to '${status}'`,
            SalesOrders: updatedSalesOrder
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStatus]", err);
        return res.status(500).json({
            success: false,
            error: "Failed to change status of Sales Order",
            details: err.message
        });
    } finally {
        client.release();
    }
}

///////////////////////////Sales Order Module End /////////////////////////////