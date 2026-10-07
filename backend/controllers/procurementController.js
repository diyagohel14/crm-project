import { getCompanyPool } from "../config/companyPoolManager.js";
import { getRequestInfo } from "../utils/crypto.js";
import { getNextSeries } from "../services/seriesService.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { logAudit } from "../services/authService.js";
import { num } from "../services/commonService.js";

function quantity(value) {
    const result = num(value, NaN);
    if (!Number.isFinite(result) || result <= 0) {
        throw Object.assign(new Error("Each item requires a positive quantity"), { status: 400 });
    }
    return result;
}

export function validateGoodsReceiptItems(items, purchaseOrderItems) {
    const purchaseOrderItemsById = new Map(
        purchaseOrderItems.map((item) => [Number(item.purchase_order_item_id), item])
    );
    const receivedQuantities = new Map();

    for (const item of items) {
        const purchaseOrderItemId = Number(item.purchase_order_item_id);
        if (!Number.isInteger(purchaseOrderItemId) || purchaseOrderItemId <= 0) {
            throw Object.assign(new Error("Each GRN item must reference a Purchase Order item"), { status: 400 });
        }
        const purchaseOrderItem = purchaseOrderItemsById.get(purchaseOrderItemId);
        if (!purchaseOrderItem) {
            throw Object.assign(new Error("GRN item is not linked to this Purchase Order"), { status: 400 });
        }
        if (Number(item.item_id) !== Number(purchaseOrderItem.item_id)) {
            throw Object.assign(new Error("GRN item does not match its Purchase Order item"), { status: 400 });
        }
        receivedQuantities.set(
            purchaseOrderItemId,
            (receivedQuantities.get(purchaseOrderItemId) || 0) + Number(item.quantity)
        );
    }

    return receivedQuantities;
}

async function validateItems(client, items, companyId) {
    if (!Array.isArray(items) || items.length === 0) {
        throw Object.assign(new Error("At least one item is required"), { status: 400 });
    }
    const itemIds = [...new Set(items.map((item) => Number(item.item_id)))];
    if (itemIds.some((itemId) => !Number.isInteger(itemId))) {
        throw Object.assign(new Error("Each item requires a valid item_id"), { status: 400 });
    }
    const result = await client.query(
        `SELECT item_id FROM tbl_items WHERE item_id = ANY($1::int[]) AND company_id = $2
         AND is_deleted = FALSE AND status = 'active'`,
        [itemIds, companyId]
    );
    if (result.rows.length !== itemIds.length) {
        throw Object.assign(new Error("One or more items are invalid or inactive"), { status: 400 });
    }
}

async function requireProject(client, projectId, companyId, allowed = ["approved", "in_progress"]) {
    const result = await client.query(
        `SELECT * FROM tbl_project WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
        [projectId, companyId]
    );
    if (!result.rows.length) throw Object.assign(new Error("Project not found"), { status: 404 });
    if (!allowed.includes(result.rows[0].status)) {
        throw Object.assign(new Error(`Project must be approved or in progress; current status is '${result.rows[0].status}'`), { status: 409 });
    }
    return result.rows[0];
}

function errorResponse(res, err, message) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: status === 400 || status === 404 || status === 409 ? err.message : message, details: err.message });
}

export async function getRequisitions(req, res) {
    const { companyId } = req.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const params = [companyId];
        const filter = req.params.requisitionId ? " AND r.requisition_id = $2" : "";
        if (filter) params.push(req.params.requisitionId);
        const result = await companyPool.query(`SELECT r.*, COALESCE((SELECT json_agg(i ORDER BY i.requisition_item_id) FROM purchase_requisition_items i WHERE i.requisition_id = r.requisition_id AND i.is_deleted = FALSE), '[]'::json) AS "itemsDetails" FROM purchase_requisitions r WHERE r.company_id = $1 AND r.is_deleted = FALSE${filter} ORDER BY r.requisition_id DESC`, params);
        if (req.params.requisitionId && !result.rows.length) return res.status(404).json({ error: "Purchase Requisition not found" });
        return res.json({ Requisitions: result.rows });
    } catch (err) { return errorResponse(res, err, "Failed to fetch requisitions"); }
}

export async function createRequisition(req, res) {
    const { companyId, userId, financialYearId, roleId } = req.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};

        if (!payload.project_id || !payload.requisition_date) throw Object.assign(new Error("project_id and requisition_date are required"), { status: 400 });
        await validateItems(client, payload.itemsDetails, companyId);
        await client.query("BEGIN");

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.REQUISITIONS,
            companyId,
            userId,
            financialYearId,
            client,
        });
        const requisitionCode = seriesResult.series;

        await requireProject(client, payload.project_id, companyId);
        const header = await client.query(`INSERT INTO purchase_requisitions 
            (requisition_no, requisition_date, project_id, required_by, notes, status, user_id, company_id) 
            VALUES ($1,$2,$3,$4,$5,'draft',$6,$7) RETURNING *`, 
            [requisitionCode, payload.requisition_date, payload.project_id, payload.required_by || null, payload.notes || null, userId, companyId]);
        const inserted = [];
        for (const item of payload.itemsDetails) {
            const row = await client.query(`INSERT INTO purchase_requisition_items 
                (requisition_id, item_id, description, quantity, unit_id, notes, user_id, company_id) 
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, 
                [header.rows[0].requisition_id, item.item_id, item.description || null, quantity(item.quantity), item.unit_id || null, item.notes || null, userId, companyId]);
            inserted.push(row.rows[0]);
        }
        await logAudit(client, {
            module_name: "Requisitions",
            page_name: "Create Requisitions",
            table_name: "purchase_requisitions",
            table_id: header.rows[0].requisition_id,
            action_type: "CREATE",
            action_description: `Requisitions Created Successfully :${requisitionCode}`,
            new_value: JSON.stringify(header.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });
        // await client.query(`UPDATE purchase_requisitions SET requisition_no = 'REQ/' || LPAD(requisition_id::text, 5, '0') WHERE requisition_id = $1`, [header.rows[0].requisition_id]);
        await client.query("COMMIT");
        return res.status(201).json({ success: true, Requisitions: header.rows[0], itemsDetails: inserted });
    } catch (err) { await client.query("ROLLBACK").catch(() => { }); return errorResponse(res, err, "Failed to create requisition"); } finally { client.release(); }
}

export async function changeRequisitionStatus(req, res) {
    const { companyId, userId, roleId } = req.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(`SELECT * FROM purchase_requisitions WHERE requisition_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`, [req.params.requisitionId, companyId]);
        if (!result.rows.length) throw Object.assign(new Error("Purchase Requisition not found"), { status: 404 });
        const current = result.rows[0].status;
        const allowed = { draft: ["approved", "cancelled"], approved: ["cancelled"], cancelled: [] };
        if (!allowed[current]?.includes(req.params.status)) throw Object.assign(new Error(`Requisition status cannot change from '${current}' to '${req.params.status}'`), { status: 400 });
        if (req.params.status === "approved") await requireProject(client, result.rows[0].project_id, companyId);
        const updated = await client.query(`UPDATE purchase_requisitions SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE requisition_id = $1 AND company_id = $2 RETURNING *`, [req.params.requisitionId, companyId, req.params.status]);
        await logAudit(client, {
            module_name: "Purchase Requisition",
            page_name: "Requisition Status",
            table_name: "purchase_requisitions",
            table_id: req.params.requisitionId,
            action_type: "STATUS_CHANGE",
            action_description: `Requisition status changed from ${current} to ${req.params.status}`,
            old_value: JSON.stringify(result.rows[0]),
            new_value: JSON.stringify(updated.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });
        await client.query("COMMIT");
        return res.json({ success: true, Requisitions: updated.rows[0] });
    } catch (err) { await client.query("ROLLBACK").catch(() => { }); return errorResponse(res, err, "Failed to change requisition status"); } finally { client.release(); }
}

export async function getGoodsReceipts(req, res) {
    const { companyId } = req.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const params = [companyId];
        const filter = req.params.grnId ? " AND g.grn_id = $2" : "";
        if (filter) params.push(req.params.grnId);
        const result = await companyPool.query(
            `SELECT g.*, COALESCE((SELECT json_agg(i ORDER BY i.grn_item_id) 
            FROM goods_receipt_items i WHERE i.grn_id = g.grn_id AND i.is_deleted = FALSE), '[]'::json) AS "itemsDetails" 
            FROM goods_receipts g WHERE g.company_id = $1 AND g.is_deleted = FALSE${filter} 
            ORDER BY g.grn_id DESC`, params);
        if (req.params.grnId && !result.rows.length) return res.status(404).json({ error: "GRN not found" });
        return res.json({ GoodsReceipts: result.rows });
    } catch (err) { return errorResponse(res, err, "Failed to fetch GRNs"); }
}

export async function createGoodsReceipt(req, res) {
    const { companyId, userId, financialYearId, roleId } = req.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};
        if (!payload.purchase_order_id || !payload.warehouse_id || !payload.grn_date) throw Object.assign(new Error("purchase_order_id, warehouse_id and grn_date are required"), { status: 400 });
        await validateItems(client, payload.itemsDetails, companyId);
        await client.query("BEGIN");
        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.GRN,
            companyId,
            userId,
            financialYearId,
            client,
        });
        const grnCode = seriesResult.series;
        const po = await client.query(`SELECT * FROM tbl_purchase_orders 
            WHERE purchase_order_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [payload.purchase_order_id, companyId]);
        if (!po.rows.length) throw Object.assign(new Error("Purchase Order not found"), { status: 404 });
        if (!["approved", "sent", "confirmed", "processing", "partially_received"].includes(po.rows[0].status)) throw Object.assign(new Error("Purchase Order is not ready for receiving"), { status: 409 });
        if (po.rows[0].project_id) await requireProject(client, po.rows[0].project_id, companyId);
        const purchaseOrderItemIds = [...new Set(payload.itemsDetails.map((item) => Number(item.purchase_order_item_id)))];
        if (purchaseOrderItemIds.some((itemId) => !Number.isInteger(itemId) || itemId <= 0)) {
            throw Object.assign(new Error("Each GRN item must reference a Purchase Order item"), { status: 400 });
        }
        const purchaseOrderItems = await client.query(
            `SELECT purchase_order_item_id, item_id FROM tbl_purchase_order_items
             WHERE purchase_order_id = $1 AND purchase_order_item_id = ANY($2::int[])
             AND is_deleted = FALSE`,
            [payload.purchase_order_id, purchaseOrderItemIds]
        );
        validateGoodsReceiptItems(payload.itemsDetails, purchaseOrderItems.rows);
        const warehouse = await client.query(`SELECT warehouse_id FROM warehouse_mst WHERE warehouse_id = $1 AND company_id = $2 AND is_deleted = FALSE AND status = 'active'`, [payload.warehouse_id, companyId]);
        if (!warehouse.rows.length) throw Object.assign(new Error("Warehouse is invalid or inactive"), { status: 400 });
        const header = await client.query(
            `INSERT INTO goods_receipts (grn_no, grn_date, purchase_order_id, project_id, warehouse_id, notes, status, user_id, company_id) 
            VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING *`,
            [grnCode, payload.grn_date, payload.purchase_order_id, po.rows[0].project_id || null, payload.warehouse_id, payload.notes || null, userId, companyId]);
        const inserted = [];
        for (const item of payload.itemsDetails) {
            const row = await client.query(
                `INSERT INTO goods_receipt_items (grn_id, purchase_order_item_id, item_id, batch_id, quantity, unit_id, rate, user_id, company_id) 
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [header.rows[0].grn_id, item.purchase_order_item_id || null, item.item_id, item.batch_id || null, quantity(item.quantity), item.unit_id || null, num(item.rate, null), userId, companyId]);
            inserted.push(row.rows[0]);
        }
        await logAudit(client, {
            module_name: "Goods Receipt",
            page_name: "Create Goods Receipt",
            table_name: "goods_receipts",
            table_id: header.rows[0].grn_id,
            action_type: "CREATE",
            action_description: `Goods Receipt Created Successfully :${grnCode}`,
            new_value: JSON.stringify(header.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });
        await client.query("COMMIT");
        return res.status(201).json({
            success: true,
            GoodsReceipts: header.rows[0],
            itemsDetails: inserted
        });
    } catch (err) { await client.query("ROLLBACK").catch(() => { }); return errorResponse(res, err, "Failed to create GRN"); } finally { client.release(); }
}

export async function approveGoodsReceipt(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const grn = await client.query(
            `SELECT * FROM goods_receipts WHERE grn_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [req.params.grnId, companyId]);
        if (!grn.rows.length) throw Object.assign(new Error("GRN not found"), { status: 404 });

        const current = grn.rows[0].status;
        const allowed = { draft: ["approved", "cancelled"], approved: ["cancelled"], cancelled: [] };
        if (!allowed[current]?.includes(status)) throw Object.assign(new Error(`GRN status cannot change from '${current}' to '${status}'`), { status: 400 });

        if (status === "approved") {
            await client.query(
                `SELECT purchase_order_id FROM tbl_purchase_orders
                 WHERE purchase_order_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
                [grn.rows[0].purchase_order_id, companyId]
            );
            const items = await client.query(`SELECT * FROM goods_receipt_items WHERE grn_id = $1 AND is_deleted = FALSE`, [req.params.grnId]);
            if (!items.rows.length) throw Object.assign(new Error("A GRN must contain at least one item"), { status: 400 });
            const purchaseOrderItemIds = [...new Set(items.rows.map((item) => Number(item.purchase_order_item_id)))];
            if (purchaseOrderItemIds.some((itemId) => !Number.isInteger(itemId) || itemId <= 0)) {
                throw Object.assign(new Error("Each GRN item must reference a Purchase Order item"), { status: 400 });
            }
            const purchaseOrderItems = await client.query(
                `SELECT purchase_order_item_id, item_id, quantity FROM tbl_purchase_order_items
                 WHERE purchase_order_id = $1 AND purchase_order_item_id = ANY($2::int[])
                 AND is_deleted = FALSE FOR UPDATE`,
                [grn.rows[0].purchase_order_id, purchaseOrderItemIds]
            );
            const receiptQuantities = validateGoodsReceiptItems(items.rows, purchaseOrderItems.rows);
            const received = await client.query(
                `SELECT gi.purchase_order_item_id, COALESCE(SUM(gi.quantity), 0) AS quantity
                 FROM goods_receipt_items gi
                 JOIN goods_receipts g ON g.grn_id = gi.grn_id
                 WHERE gi.purchase_order_item_id = ANY($1::int[]) AND g.status = 'approved'
                 AND gi.is_deleted = FALSE GROUP BY gi.purchase_order_item_id`,
                [purchaseOrderItemIds]
            );
            const alreadyReceived = new Map(received.rows.map((row) => [Number(row.purchase_order_item_id), Number(row.quantity)]));
            for (const purchaseOrderItem of purchaseOrderItems.rows) {
                const itemId = Number(purchaseOrderItem.purchase_order_item_id);
                if ((alreadyReceived.get(itemId) || 0) + receiptQuantities.get(itemId) > Number(purchaseOrderItem.quantity)) {
                    throw Object.assign(new Error("GRN quantity exceeds the Purchase Order quantity"), { status: 409 });
                }
            }
            for (const item of items.rows) {
                await client.query(`INSERT INTO stock_ledger (item_id, warehouse_id, batch_id, txn_date, txn_type, txn_source, source_id, source_item_id, quantity, unit_id, rate, remarks, user_id, company_id) VALUES ($1,$2,$3,$4,'IN','GRN',$5,$6,$7,$8,$9,$10,$11,$12)`, [item.item_id, grn.rows[0].warehouse_id, item.batch_id, grn.rows[0].grn_date, grn.rows[0].grn_id, item.grn_item_id, item.quantity, item.unit_id, item.rate, grn.rows[0].notes, userId, companyId]);
            }
            const updated = await client.query(`UPDATE goods_receipts SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE grn_id = $1 RETURNING *`, [req.params.grnId]);
            await client.query(`UPDATE tbl_purchase_orders SET status = CASE WHEN EXISTS (SELECT 1 FROM tbl_purchase_order_items poi WHERE poi.purchase_order_id = $1 AND poi.is_deleted = FALSE AND (SELECT COALESCE(SUM(gri.quantity), 0) FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.grn_id = gri.grn_id WHERE gri.purchase_order_item_id = poi.purchase_order_item_id AND gr.status = 'approved') < poi.quantity) THEN 'partially_received' ELSE 'received' END, updated_at = CURRENT_TIMESTAMP WHERE purchase_order_id = $1`, [grn.rows[0].purchase_order_id]);
            await logAudit(client, {
                module_name: "Goods Receipt",
                page_name: "Approve Goods Receipt",
                table_name: "goods_receipts",
                table_id: grn.rows[0].grn_id,
                action_type: "STATUS_CHANGE",
                action_description: `Goods Receipt status changed from ${current} to ${status}`,
                old_value: JSON.stringify(grn.rows[0]),
                new_value: JSON.stringify(updated.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId,
            });
            await client.query("COMMIT");
            return res.json({ success: true, GoodsReceipts: updated.rows[0] });
        }

        const updated = await client.query(`UPDATE goods_receipts SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE grn_id = $1 AND company_id = $2 RETURNING *`, [req.params.grnId, companyId, status]);
        await logAudit(client, {
            module_name: "Goods Receipt",
            page_name: "GRN Status",
            table_name: "goods_receipts",
            table_id: grn.rows[0].grn_id,
            action_type: "STATUS_CHANGE",
            action_description: `Goods Receipt status changed from ${current} to ${status}`,
            old_value: JSON.stringify(grn.rows[0]),
            new_value: JSON.stringify(updated.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });
        await client.query("COMMIT");
        return res.json({ success: true, GoodsReceipts: updated.rows[0] });
    } catch (err) { await client.query("ROLLBACK").catch(() => { }); return errorResponse(res, err, "Failed to change GRN status"); } finally { client.release(); }
}

export async function getSiteIssues(req, res) {
    const { companyId } = req.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const params = [companyId];
        const filter = req.params.issueId ? " AND s.issue_id = $2" : "";
        if (filter) params.push(req.params.issueId);
        const result = await companyPool.query(`SELECT s.*, COALESCE((SELECT json_agg(i ORDER BY i.issue_item_id) FROM site_issue_items i WHERE i.issue_id = s.issue_id AND i.is_deleted = FALSE), '[]'::json) AS "itemsDetails" FROM site_issues s WHERE s.company_id = $1 AND s.is_deleted = FALSE${filter} ORDER BY s.issue_id DESC`, params);
        if (req.params.issueId && !result.rows.length) return res.status(404).json({ error: "Site Issue not found" });
        return res.json({ SiteIssues: result.rows });
    } catch (err) { return errorResponse(res, err, "Failed to fetch site issues"); }
}

export async function createSiteIssue(req, res) {
    const { companyId, userId, financialYearId, roleId } = req.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};
        if (!payload.project_id || !payload.site_id || !payload.warehouse_id || !payload.issue_date) throw Object.assign(new Error("project_id, site_id, warehouse_id and issue_date are required"), { status: 400 });
        await validateItems(client, payload.itemsDetails, companyId);
        await client.query("BEGIN");
        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.SITE_ISSUE,
            companyId,
            userId,
            financialYearId,
            client,
        });
        const issueCode = seriesResult.series;
        await requireProject(client, payload.project_id, companyId, ["approved", "in_progress"]);
        const site = await client.query(`SELECT site_id FROM tbl_project_sites WHERE site_id = $1 AND project_id = $2 AND company_id = $3 AND is_deleted = FALSE AND status = 'active'`, [payload.site_id, payload.project_id, companyId]);
        if (!site.rows.length) throw Object.assign(new Error("Site does not belong to the project or is inactive"), { status: 400 });
        const warehouse = await client.query(`SELECT warehouse_id FROM warehouse_mst WHERE warehouse_id = $1 AND company_id = $2 AND is_deleted = FALSE AND status = 'active'`, [payload.warehouse_id, companyId]);
        if (!warehouse.rows.length) throw Object.assign(new Error("Warehouse is invalid or inactive"), { status: 400 });
        const header = await client.query(`INSERT INTO site_issues (issue_no, issue_date, project_id, site_id, warehouse_id, notes, status, user_id, company_id) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING *`, [issueCode, payload.issue_date, payload.project_id, payload.site_id, payload.warehouse_id, payload.notes || null, userId, companyId]);
        const inserted = [];
        for (const item of payload.itemsDetails) {
            const row = await client.query(`INSERT INTO site_issue_items (issue_id, item_id, batch_id, quantity, unit_id, boq_item_id, user_id, company_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [header.rows[0].issue_id, item.item_id, item.batch_id || null, quantity(item.quantity), item.unit_id || null, item.boq_item_id || null, userId, companyId]);
            inserted.push(row.rows[0]);
        }
        await logAudit(client, {
            module_name: "Site Issue",
            page_name: "Create Site Issue",
            table_name: "site_issues",
            table_id: header.rows[0].issue_id,
            action_type: "CREATE",
            action_description: `Site Issue Created Successfully :${issueCode}`,
            new_value: JSON.stringify(header.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });
        await client.query("COMMIT");
        return res.status(201).json({ success: true, SiteIssues: header.rows[0], itemsDetails: inserted });
    } catch (err) { await client.query("ROLLBACK").catch(() => { }); return errorResponse(res, err, "Failed to create site issue"); } finally { client.release(); }
}

async function ensureStock(client, companyId, itemId, warehouseId, batchId, requested) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`inventory:${companyId}:${itemId}:${warehouseId}:${batchId || 0}`]);
    const result = await client.query(`SELECT COALESCE(SUM(CASE WHEN txn_type = 'IN' THEN quantity ELSE -quantity END), 0) AS available FROM stock_ledger WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3 AND batch_id IS NOT DISTINCT FROM $4 AND is_deleted = FALSE`, [companyId, itemId, warehouseId, batchId || null]);
    if (Number(result.rows[0].available) < requested) throw Object.assign(new Error(`Insufficient stock for item ${itemId}; available stock: ${result.rows[0].available}`), { status: 409 });
}

export async function approveSiteIssue(req, res) {
    const { companyId, userId, roleId } = req.user;
    const { status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const issue = await client.query(`SELECT * FROM site_issues WHERE issue_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`, [req.params.issueId, companyId]);
        if (!issue.rows.length) throw Object.assign(new Error("Site Issue not found"), { status: 404 });

        const current = issue.rows[0].status;
        const allowed = { draft: ["approved", "cancelled"], approved: ["cancelled"], cancelled: [] };
        if (!allowed[current]?.includes(status)) throw Object.assign(new Error(`Site Issue status cannot change from '${current}' to '${status}'`), { status: 400 });

        if (status === "approved") {
            await requireProject(client, issue.rows[0].project_id, companyId);
            const items = await client.query(`SELECT * FROM site_issue_items WHERE issue_id = $1 AND is_deleted = FALSE`, [req.params.issueId]);
            if (!items.rows.length) throw Object.assign(new Error("A site issue must contain at least one item"), { status: 400 });
            for (const item of items.rows) {
                await ensureStock(client, companyId, item.item_id, issue.rows[0].warehouse_id, item.batch_id, Number(item.quantity));
                await client.query(`INSERT INTO stock_ledger (item_id, warehouse_id, batch_id, txn_date, txn_type, txn_source, source_id, source_item_id, quantity, unit_id, remarks, user_id, company_id) 
                    VALUES ($1,$2,$3,$4,'OUT','SITE_ISSUE',$5,$6,$7,$8,$9,$10,$11)`, 
                    [item.item_id, issue.rows[0].warehouse_id, item.batch_id, issue.rows[0].issue_date, issue.rows[0].issue_id, item.issue_item_id, item.quantity, item.unit_id, issue.rows[0].notes, userId, companyId]);
                if (item.boq_item_id) await client.query(`UPDATE tbl_project_boq_items 
                    SET consumed_quantity = consumed_quantity + $1, updated_at = CURRENT_TIMESTAMP 
                    WHERE boq_item_id = $2 AND project_id = $3 AND is_deleted = FALSE`, 
                    [item.quantity, item.boq_item_id, issue.rows[0].project_id]);
            }
            const updated = await client.query(`UPDATE site_issues SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE issue_id = $1 RETURNING *`, [req.params.issueId]);
            await logAudit(client, {
                module_name: "Site Issue",
                page_name: "Approve Site Issue",
                table_name: "site_issues",
                table_id: issue.rows[0].issue_id,
                action_type: "STATUS_CHANGE",
                action_description: `Site Issue status changed from ${current} to ${status}`,
                old_value: JSON.stringify(issue.rows[0]),
                new_value: JSON.stringify(updated.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId,
            });
            await client.query("COMMIT");
            return res.json({ success: true, SiteIssues: updated.rows[0] });
        }

        const updated = await client.query(`UPDATE site_issues SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE issue_id = $1 AND company_id = $2 RETURNING *`, [req.params.issueId, companyId, status]);
        await logAudit(client, {
            module_name: "Site Issue",
            page_name: "Site Issue Status",
            table_name: "site_issues",
            table_id: issue.rows[0].issue_id,
            action_type: "STATUS_CHANGE",
            action_description: `Site Issue status changed from ${current} to ${status}`,
            old_value: JSON.stringify(issue.rows[0]),
            new_value: JSON.stringify(updated.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId,
        });
        await client.query("COMMIT");
        return res.json({ success: true, SiteIssues: updated.rows[0] });
    } catch (err) { await client.query("ROLLBACK").catch(() => { }); return errorResponse(res, err, "Failed to change site issue status"); } finally { client.release(); }
}
