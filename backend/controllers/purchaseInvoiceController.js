// controllers/purchaseInvoiceController.js
import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js"
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule, priceCalculation, num } from "../services/allService.js"

export function resolveInvoiceItemLink(insertedItemIds = [], taxDetail = {}) {
    if (!Array.isArray(insertedItemIds)) return null;

    const indexValue = taxDetail.purchase_invoice_item_index;
    if (indexValue !== undefined && indexValue !== null && indexValue !== "") {
        const index = Number(indexValue);
        if (Number.isInteger(index) && insertedItemIds[index] !== undefined) {
            return insertedItemIds[index];
        }
    }

    const directValue = taxDetail.purchase_invoice_item_id;
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
        purchase_invoice_item_id: itemsDetails[idx]?.purchase_invoice_item_id || null,
        ...it,
    }));
    return priced;
}


/// status update flow
const PURCHASE_INVOICE_STATUS_TRANSITIONS = {
    draft: ["approved", "disputed"],
    approved: ["partially_paid", "paid", "overdue", "disputed"],
    partially_paid: ["paid", "overdue", "disputed"],
    overdue: ["partially_paid", "paid", "disputed"],
    paid: [],
    disputed: ["approved"]
};

function isValidStatusTransition(currentStatus, newStatus) {
    return PURCHASE_INVOICE_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

///////////////////////////Sales Invoice Module Start /////////////////////////////
export async function getPurchaseInvoices(req, res) {
    const { companyId } = req.session.user;
    const { invoiceId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    let result;

    try {
        if (invoiceId) {
            const query = `SELECT inv.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_purchase_invoice_items AS items
                 WHERE items.purchase_invoice_id = inv.purchase_invoice_id AND items.company_id = inv.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_purchase_invoice_tax_details AS tax
                 WHERE tax.purchase_invoice_id = inv.purchase_invoice_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_purchase_invoices AS inv
            WHERE inv.purchase_invoice_id = $1 AND inv.company_id = $2 AND inv.is_deleted = FALSE`;
            result = await companyPool.query(query, [invoiceId, companyId]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Invoice not found" });
            }
        } else {
            const query = `SELECT inv.*,
            COALESCE(
                (SELECT json_agg(items) FROM tbl_purchase_invoice_items AS items
                 WHERE items.purchase_invoice_id = inv.purchase_invoice_id AND items.company_id = inv.company_id AND items.is_deleted = FALSE),
                '[]'::json
            ) AS "itemsDetails",
            COALESCE(
                (SELECT json_agg(tax) FROM tbl_purchase_invoice_tax_details AS tax
                 WHERE tax.purchase_invoice_id = inv.purchase_invoice_id AND tax.is_deleted = FALSE),
                '[]'::json
            ) AS "taxDetails"
            FROM tbl_purchase_invoices AS inv
            WHERE inv.company_id = $1 AND inv.is_deleted = FALSE
            ORDER BY inv.pi_no ASC`;
            result = await companyPool.query(query, [companyId]);
        }

        return res.status(200).json({ message: "Invoice Fetch Successfully", Invoices: result.rows });

    } catch (err) {
        console.error("[getPurchaseInvoices]", err);
        return res.status(500).json({ error: "Failed to fetch Invoice List", details: err.message });
    }
}

export async function createPurchaseInvoice(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.pi_date) {
            return res.status(400).json({ success: false, error: "pi_date is required" });
        }

        // Recompute every money figure server-side from qty/rate/discount/tax%.
        const priced = priceItems(payload.itemsDetails, payload);
        const taxDetails = Array.isArray(payload.taxDetails) ? payload.taxDetails : [];

        await client.query('BEGIN');

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.PURCHASE_INVOICE,
            companyId,
            userId,
            financialYearId,
            client
        });
        const invoiceNo = seriesResult.series;

        const insertInvoiceSql = `INSERT INTO tbl_purchase_invoices (
            pi_no, pi_date, party_id, invoice_date, due_date, po_no, po_date,
            billing_address_id, shipping_address_id, currency_id,
            subtotal_amount, discount_value, total_tax_amount,
            round_off, total_amount, paid_amount, balance_due,
            terms_conditions, notes, status, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        RETURNING *`;

        const invoiceParams = [
            invoiceNo,
            payload.pi_date,
            payload.party_id,
            payload.invoice_date,
            payload.due_date || null,
            payload.po_no || null,
            payload.po_date || null,
            payload.billing_address_id || null,
            payload.shipping_address_id || null,
            // payload.payment_term_id || null,
            payload.currency_id || null,
            priced.subtotal_amount,
            // priced.discount_type,
            priced.discount_value,
            priced.total_tax_amount,
            // priced.shipping_charges,
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

        const invoiceRes = await client.query(insertInvoiceSql, invoiceParams);
        const invoiceId = invoiceRes.rows[0].purchase_invoice_id;

        const insertedItemIds = [];
        const insertedItems = [];
        const insertItemSql = `INSERT INTO tbl_purchase_invoice_items (
            purchase_invoice_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        for (const it of priced.items) {
            const itemParams = [
                invoiceId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id,
                it.unit_rate, it.total_rate, it.discount_percent, it.discount_flat,
                it.tax_percent, it.tax_amount, it.total_amount, userId, companyId
            ];
            const r = await client.query(insertItemSql, itemParams);
            insertedItemIds.push(r.rows[0].purchase_invoice_item_id);
            insertedItems.push(r.rows[0]);
        }

        const insertTaxSql = `INSERT INTO tbl_purchase_invoice_tax_details (
            purchase_invoice_id, purchase_invoice_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const insertedTaxes = [];
        for (const t of taxDetails) {
            const invoiceItemId = resolveInvoiceItemLink(insertedItemIds, t);
            const taxParams = [
                invoiceId, invoiceItemId, t.tax_id || null,
                num(t.taxable_amount, null), num(t.tax_percentage, null), num(t.tax_amount, null),
                false
            ];
            const r = await client.query(insertTaxSql, taxParams);
            insertedTaxes.push(r.rows[0]);
        }

        await logAudit(client, {
            module_name: "Purchase Invoice",
            page_name: "Create Purchase Invoice",
            table_name: "tbl_purchase_invoices",
            table_id: invoiceId,
            action_type: "CREATE",
            action_description: `Purchase Invoice Created Successfully :${invoiceNo}`,
            new_value: JSON.stringify(invoiceRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Purchase Invoice created',
            Invoices: invoiceRes.rows[0],
            itemsDetails: insertedItems,
            taxDetails: insertedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createPurchaseInvoice]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Purchase Invoice", details: err.message });

    } finally {
        client.release();
    }
}

export async function updatePurchaseInvoice(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const { invoiceId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.party_id) {
            return res.status(400).json({ success: false, error: "party_id is required" });
        }
        if (!payload.pi_date) {
            return res.status(400).json({ success: false, error: "pi_date is required" });
        }

        const priced = priceItems(payload.itemsDetails, payload);
        const taxDetails = Array.isArray(payload.taxDetails) ? payload.taxDetails : [];

        await client.query('BEGIN');

        //Check invoice
        const invoiceQuery = await client.query(
            `SELECT purchase_invoice_id, status FROM tbl_purchase_invoices
             WHERE purchase_invoice_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [invoiceId, companyId]
        );
        if (invoiceQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Purchase Invoice not found' });
        }
        const invoice = invoiceQuery.rows[0];
        if (invoice.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: `Purchase Invoice cannot be updated because its status is '${invoice.status}'` });
        }

        const updateInvoiceSql = `UPDATE tbl_purchase_invoices SET
            pi_date = $1, party_id = $2, invoice_date = $3, due_date = $4, po_no = $5, po_date = $6,
            billing_address_id = $7, shipping_address_id = $8, currency_id = $9,
            subtotal_amount = $10, discount_value = $11, total_tax_amount = $12,
            round_off = $13, total_amount = $14, paid_amount = $15, balance_due = $16,
            terms_conditions = $17, notes = $18, status = $19, updated_at = CURRENT_TIMESTAMP
            WHERE purchase_invoice_id = $20 AND is_deleted = FALSE AND company_id = $21
            RETURNING *`;

        const invoiceParams = [
            payload.pi_date || null,
            payload.party_id,
            payload.invoice_date,
            payload.due_date || null,
            payload.po_no || null,
            payload.po_date || null,
            payload.billing_address_id || null,
            payload.shipping_address_id || null,
            payload.currency_id || null,
            priced.subtotal_amount,
            // priced.discount_type,
            priced.discount_value,
            priced.total_tax_amount,
            // priced.shipping_charges,
            priced.round_off,
            priced.total_amount,
            priced.paid_amount,
            priced.balance_due,
            payload.terms_conditions || null,
            payload.notes || null,
            payload.status || 'draft',
            invoiceId,
            companyId
        ];

        const invoiceRes = await client.query(updateInvoiceSql, invoiceParams);

        if (invoiceRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Purchase Invoice not found" });
        }

        const existingItemsRes = await client.query(
            'SELECT purchase_invoice_item_id FROM tbl_purchase_invoice_items WHERE purchase_invoice_id = $1 AND is_deleted = FALSE',
            [invoiceId]
        );
        const existingItemIds = existingItemsRes.rows.map(r => r.purchase_invoice_item_id);

        const keptItemIds = [];
        const processedItems = [];

        const insertItemSql = `INSERT INTO tbl_purchase_invoice_items (
            purchase_invoice_id, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount,
            user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

        const updateItemSql = `UPDATE tbl_purchase_invoice_items SET
            item_id = $1, description = $2, quantity = $3, hsn_code = $4, unit_id = $5, unit_rate = $6,
            total_rate = $7, discount_percent = $8, discount_flat = $9, tax_percent = $10, tax_amount = $11,
            total_amount = $12, updated_at = CURRENT_TIMESTAMP
            WHERE purchase_invoice_item_id = $13 AND purchase_invoice_id = $14 AND company_id = $15 AND is_deleted = FALSE
            RETURNING *`;

        for (const it of priced.items) {
            if (it.purchase_invoice_item_id && existingItemIds.includes(it.purchase_invoice_item_id)) {
                const params = [
                    it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, it.purchase_invoice_item_id, invoiceId, companyId
                ];
                const r = await client.query(updateItemSql, params);
                if (r.rowCount) {
                    keptItemIds.push(r.rows[0].purchase_invoice_item_id);
                    processedItems.push(r.rows[0]);
                }
            } else {
                const params = [
                    invoiceId, it.item_id, it.description, it.quantity, it.hsn_code, it.unit_id, it.unit_rate,
                    it.total_rate, it.discount_percent, it.discount_flat, it.tax_percent, it.tax_amount,
                    it.total_amount, userId, companyId
                ];
                const r = await client.query(insertItemSql, params);
                keptItemIds.push(r.rows[0].purchase_invoice_item_id);
                processedItems.push(r.rows[0]);
            }
        }

        const toDelete = existingItemIds.filter(id => !keptItemIds.includes(id));
        if (toDelete.length) {
            await client.query('UPDATE tbl_purchase_invoice_items SET is_deleted = TRUE WHERE purchase_invoice_item_id = ANY($1)', [toDelete]);
        }

        const existingTaxesRes = await client.query(
            'SELECT tax_detail_id FROM tbl_purchase_invoice_tax_details WHERE purchase_invoice_id = $1 AND is_deleted = FALSE',
            [invoiceId]
        );
        const existingTaxIds = existingTaxesRes.rows.map(r => r.tax_detail_id);
        const keptTaxIds = [];
        const processedTaxes = [];

        const insertTaxSql = `INSERT INTO tbl_purchase_invoice_tax_details (
            purchase_invoice_id, purchase_invoice_item_id, tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

        const updateTaxSql = `UPDATE tbl_purchase_invoice_tax_details SET
            purchase_invoice_item_id = $1, tax_id = $2, taxable_amount = $3, tax_percentage = $4, tax_amount = $5, is_deleted = $6
            WHERE tax_detail_id = $7 AND purchase_invoice_id = $8 AND is_deleted = FALSE
            RETURNING *`;

        const itemIndexToId = processedItems.map(it => it.purchase_invoice_item_id);

        for (const t of taxDetails) {
            const purchase_invoice_item_id = resolveInvoiceItemLink(itemIndexToId, t);

            if (t.tax_detail_id && existingTaxIds.includes(t.tax_detail_id)) {
                const params = [
                    purchase_invoice_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false,
                    t.tax_detail_id, invoiceId
                ];
                const r = await client.query(updateTaxSql, params);
                if (r.rowCount) {
                    keptTaxIds.push(r.rows[0].tax_detail_id);
                    processedTaxes.push(r.rows[0]);
                }
            } else {
                const params = [
                    invoiceId, purchase_invoice_item_id, t.tax_id || null, num(t.taxable_amount, null),
                    num(t.tax_percentage, null), num(t.tax_amount, null), false
                ];
                const r = await client.query(insertTaxSql, params);
                keptTaxIds.push(r.rows[0].tax_detail_id);
                processedTaxes.push(r.rows[0]);
            }
        }

        const taxesToDelete = existingTaxIds.filter(id => !keptTaxIds.includes(id));
        if (taxesToDelete.length) {
            await client.query('UPDATE tbl_purchase_invoice_tax_details SET is_deleted = TRUE WHERE tax_detail_id = ANY($1)', [taxesToDelete]);
        }

        await logAudit(client, {
            module_name: "Purchase Invoice",
            page_name: "Update Purchase Invoice",
            table_name: "tbl_purchase_invoices",
            table_id: invoiceId,
            action_type: "UPDATE",
            action_description: "Purchase Invoice Updated Successfully",
            new_value: JSON.stringify(invoiceRes.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Purchase Invoice Updated',
            Invoices: invoiceRes.rows[0],
            itemsDetails: processedItems,
            taxDetails: processedTaxes
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updatePurchaseInvoice]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Update Purchase Invoice", details: err.message });

    } finally {
        client.release();
    }
}

export async function deletePurchaseInvoice(req, res) {
    const { companyId } = req.session.user;
    const { invoiceId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const result = await deleteModule(client, 'tbl_purchase_invoices', 'purchase_invoice_id', invoiceId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Purchase Invoice not found" });
        }
        const itemsResult = await deleteModule(client, 'tbl_purchase_invoice_items', 'purchase_invoice_id', invoiceId, { company_id: companyId });
        const taxResult = await deleteModule(client, 'tbl_purchase_invoice_tax_details', 'purchase_invoice_id', invoiceId);

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Purchase Invoice Deleted',
            Invoices: result.result,
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deletePurchaseInvoice]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Purchase Invoice", details: err.message });

    } finally {
        client.release();
    }
}

export async function deletePurchaseInvoiceItems(req, res) {
    const { companyId } = req.session.user;
    const { invoiceId, invoiceItemId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    try {
        await client.query('BEGIN');

        const itemsResult = await deleteModule(client, 'tbl_purchase_invoice_items', 'purchase_invoice_item_id', invoiceItemId, { purchase_invoice_id: invoiceId, company_id: companyId });

        if (itemsResult.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Purchase Invoice item not found" });
        }

        const taxResult = await deleteModule(client, 'tbl_purchase_invoice_tax_details', 'purchase_invoice_item_id', invoiceItemId, { purchase_invoice_id: invoiceId });

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Purchase Invoice Item Deleted',
            itemsDetails: itemsResult.result,
            taxDetails: taxResult.result
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deletePurchaseInvoiceItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Purchase Invoice Items", details: err.message });

    } finally {
        client.release();
    }
}

export async function changeStatus(req, res) {
    const { userId, companyId, roleId, fullName } = req.session.user;
    const { invoiceId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");

        const allowedStatuses = ["draft", "approved", "partially_paid", "paid", "overdue", "disputed"];
        if (!allowedStatuses.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid Purchase invoice status: ${status}` });
        }

        // Get current invoice
        const invoiceQuery = `SELECT * FROM tbl_purchase_invoices WHERE purchase_invoice_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`;
        const invoiceResult = await client.query(invoiceQuery, [invoiceId, companyId]);

        if (invoiceResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Purchase Invoice not found" });
        }

        const invoice = invoiceResult.rows[0];
        const currentStatus = invoice.status;
        // Same status
        if (currentStatus === status) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Purchase Invoice is already ${status}` });
        }

        // Check transition
        if (!isValidStatusTransition(currentStatus, status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Purchase Invoice status cannot be changed from '${currentStatus}' to '${status}'` });
        }

        // Get user name for audit
        const userQuery = await client.query(`SELECT first_name, last_name, email FROM users WHERE user_id = $1 AND company_id = $2`,
            [userId, companyId]
        );
        const user = userQuery.rows[0];
        const user_name = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
        const userName = user_name || user?.email || fullName || "Unknown User";

        // Update status
        const updateQuery = `UPDATE tbl_purchase_invoices SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE purchase_invoice_id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`;
        const result = await client.query(updateQuery, [invoiceId, companyId, status]);
        const updatedInvoice = result.rows[0];

        await logAudit(client, {
            module_name: "Purchase Invoice",
            page_name: "Purchase Invoice Status",
            table_name: "tbl_purchase_invoices",
            table_id: invoiceId,
            action_type: "STATUS_CHANGE",
            action_description: `Purchase Invoice status changed from ${currentStatus} to ${status} by ${userName}`,
            old_value: JSON.stringify(invoice),
            new_value: JSON.stringify(updatedInvoice),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Purchase Invoice status changed from '${currentStatus}' to '${status}'`,
            Invoices: updatedInvoice
        });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStatus]", err);
        return res.status(500).json({
            success: false,
            error: "Failed to change status of Purchase Invoice",
            details: err.message
        });
    } finally {
        client.release();
    }
}

///////////////////////////Sales Invoice Module End /////////////////////////////