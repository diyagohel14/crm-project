// controllers/inventoryController.js
import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";
import { deleteModule, num } from "../services/allService.js";

///////////////////// Warehouse Master Start /////////////////////////////
export async function viewWarehouseList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM warehouse_mst WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch Warehouse List", warehouseList: result.rows });
    } catch (err) {
        console.error("[viewWarehouseList]", err);
        return res.status(500).json({ error: "Failed to fetch Warehouse List", details: err.message });
    }
}

export async function viewWarehouse(req, res) {
    const { warehouseId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM warehouse_mst WHERE warehouse_id=$1 AND is_deleted=FALSE`, [warehouseId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Warehouse not found" });
        return res.status(200).json({ message: "Warehouse Fetch Successfully", warehouse: result.rows[0] });
    } catch (err) {
        console.error("[viewWarehouse]", err);
        return res.status(500).json({ error: "Failed to Get Warehouse", details: err.message });
    }
}

export async function createWarehouse(req, res) {
    const { warehouse_name, address, status } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        if (!warehouse_name) return res.status(400).json({ error: "warehouse_name is required" });
        const result = await companyPool.query(
            `INSERT INTO warehouse_mst (warehouse_name, address, status, user_id, company_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [warehouse_name, address || null, status || 'active', userId, companyId]
        );
        await logAudit(companyPool, {
            module_name: "Warehouse Master",
            page_name: "Warehouse Create",
            table_name: "warehouse_mst",
            table_id: result.rows[0].warehouse_id,
            action_type: "CREATE",
            action_description: "Warehouse Created Successfully",
            new_value: JSON.stringify(result.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });
        return res.status(201).json({ message: "Warehouse Created Successfully", warehouse: result.rows[0] });
    } catch (err) {
        console.error("[createWarehouse]", err);
        return res.status(500).json({ error: "Failed to Create Warehouse", details: err.message });
    }
}

export async function updateWarehouse(req, res) {
    const { warehouse_name, address, status } = req.body;
    const { warehouseId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE warehouse_mst SET warehouse_name=$1, address=$2, status=$3, updated_at=CURRENT_TIMESTAMP
             WHERE warehouse_id=$4 AND company_id=$5 AND is_deleted=FALSE RETURNING *`,
            [warehouse_name, address || null, status || 'active', warehouseId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Warehouse not found" });
        await logAudit(companyPool, {
            module_name: "Warehouse Master", 
            page_name: "Warehouse Update", 
            table_name: "warehouse_mst",
            table_id: result.rows[0].warehouse_id, 
            action_type: "UPDATE", 
            action_description: "Warehouse Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });
        return res.status(200).json({ message: "Warehouse Updated Successfully", warehouse: result.rows[0] });
    } catch (err) {
        console.error("[updateWarehouse]", err);
        return res.status(500).json({ error: "Failed to Update Warehouse", details: err.message });
    }
}

export async function deleteWarehouse(req, res) {
    const { warehouseId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE warehouse_mst SET is_deleted=TRUE, status='inactive' WHERE warehouse_id=$1 AND company_id=$2 AND is_deleted=FALSE RETURNING *`,
            [warehouseId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Warehouse not found" });
        await logAudit(companyPool, {
            module_name: "Warehouse Master", 
            page_name: "Warehouse Deleted", 
            table_name: "warehouse_mst",
            table_id: result.rows[0].warehouse_id, 
            action_type: "DELETE", 
            action_description: "Warehouse Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });
        return res.status(200).json({ message: "Warehouse Deleted Successfully", warehouse: result.rows[0] });
    } catch (err) {
        console.error("[deleteWarehouse]", err);
        return res.status(500).json({ error: "Failed to Delete Warehouse", details: err.message });
    }
}
///////////////////////Warehouse Master End///////////////////////////


///////////////////////Item Batch Master Start///////////////////////////
export async function viewBatchList(req, res) {
    const { companyId } = req.session.user;
    const { itemId } = req.query;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = itemId
            ? await companyPool.query(`SELECT * FROM item_batches WHERE item_id=$1 AND is_deleted=FALSE`, [itemId])
            : await companyPool.query(`SELECT * FROM item_batches WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch Batch List", batchList: result.rows });
    } catch (err) {
        console.error("[viewBatchList]", err);
        return res.status(500).json({ error: "Failed to fetch Batch List", details: err.message });
    }
}

export async function createBatch(req, res) {
    const { item_id, batch_no, mfg_date, expiry_date, status } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        if (!item_id || !batch_no) return res.status(400).json({ error: "item_id and batch_no are required" });
        const result = await companyPool.query(
            `INSERT INTO item_batches (item_id, batch_no, mfg_date, expiry_date, status, user_id, company_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [item_id, batch_no, mfg_date || null, expiry_date || null, status || 'active', userId, companyId]
        );
        await logAudit(companyPool, {
            module_name: "Batch Master", 
            page_name: "Batch Create", 
            table_name: "item_batches",
            table_id: result.rows[0].batch_id, 
            action_type: "CREATE", 
            action_description: "Batch Created Successfully",
            new_value: JSON.stringify(result.rows[0]), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });
        return res.status(201).json({ message: "Batch Created Successfully", batch: result.rows[0] });
    } catch (err) {
        console.error("[createBatch]", err);
        if (err.code === '23505') return res.status(409).json({ error: "This batch_no already exists for this item" });
        return res.status(500).json({ error: "Failed to Create Batch", details: err.message });
    }
}

export async function updateBatch(req, res) {
    const { batch_no, mfg_date, expiry_date, status } = req.body;
    const { batchId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE item_batches SET batch_no=$1, mfg_date=$2, expiry_date=$3, status=$4, updated_at=CURRENT_TIMESTAMP
             WHERE batch_id=$5 AND company_id=$6 AND is_deleted=FALSE RETURNING *`,
            [batch_no, mfg_date || null, expiry_date || null, status || 'active', batchId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Batch not found" });
        await logAudit(companyPool, {
            module_name: "Batch Master", 
            page_name: "Batch Update", 
            table_name: "item_batches",
            table_id: result.rows[0].batch_id, 
            action_type: "UPDATE", 
            action_description: "Batch Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });
        return res.status(200).json({ message: "Batch Updated Successfully", batch: result.rows[0] });
    } catch (err) {
        console.error("[updateBatch]", err);
        return res.status(500).json({ error: "Failed to Update Batch", details: err.message });
    }
}

export async function deleteBatch(req, res) {
    const { batchId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE item_batches SET is_deleted=TRUE, status='inactive' WHERE batch_id=$1 AND company_id=$2 AND is_deleted=FALSE RETURNING *`,
            [batchId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Batch not found" });
        await logAudit(companyPool, {
            module_name: "Batch Master", 
            page_name: "Batch Deleted", 
            table_name: "item_batches",
            table_id: result.rows[0].batch_id, 
            action_type: "DELETE", 
            action_description: "Batch Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });
        return res.status(200).json({ message: "Batch Deleted Successfully", batch: result.rows[0] });
    } catch (err) {
        console.error("[deleteBatch]", err);
        return res.status(500).json({ error: "Failed to Delete Batch", details: err.message });
    }
}
///////////////////////Item Batch Master End///////////////////////////


///////////////////////Stock View (read-only) Start///////////////////////////
// Current on-hand stock per item / warehouse / batch, derived live from the
// ledger (SUM of IN minus SUM of OUT). Pass ?item_id=&warehouse_id= to filter.
export async function getStockSummary(req, res) {
    const { companyId } = req.session.user;
    const { itemId, warehouseId } = req.query;
    const companyPool = await getCompanyPool(companyId);
    try {
        const conditions = ["sl.company_id = $1", "sl.is_deleted = FALSE"];
        const params = [companyId];
        if (itemId) {
            params.push(itemId);
            conditions.push(`sl.item_id = $${params.length}`);
        }
        if (warehouseId) {
            params.push(warehouseId);
            conditions.push(`sl.warehouse_id = $${params.length}`);
        }

        const query = `
            SELECT sl.item_id, it.item_name, it.item_code, sl.warehouse_id, wh.warehouse_name,
                   sl.batch_id, ib.batch_no,
                   SUM(CASE WHEN sl.txn_type = 'IN' THEN sl.quantity ELSE -sl.quantity END) AS current_stock
            FROM stock_ledger sl
            JOIN tbl_items it ON it.item_id = sl.item_id
            JOIN warehouse_mst wh ON wh.warehouse_id = sl.warehouse_id
            LEFT JOIN item_batches ib ON ib.batch_id = sl.batch_id
            WHERE ${conditions.join(" AND ")}
            GROUP BY sl.item_id, it.item_name, it.item_code, sl.warehouse_id, wh.warehouse_name, sl.batch_id, ib.batch_no
            ORDER BY it.item_name ASC`;
        const result = await companyPool.query(query, params);
        return res.status(200).json({ message: "Stock Summary Fetch Successfully", stockSummary: result.rows });
    } catch (err) {
        console.error("[getStockSummary]", err);
        return res.status(500).json({ error: "Failed to fetch Stock Summary", details: err.message });
    }
}

// Raw movement history, most recent first. Same optional filters as above.
export async function getStockLedger(req, res) {
    const { companyId } = req.session.user;
    const { itemId, warehouseId } = req.query;
    const companyPool = await getCompanyPool(companyId);
    try {
        const conditions = ["sl.company_id = $1", "sl.is_deleted = FALSE"];
        const params = [companyId];
        if (itemId) {
            params.push(itemId);
            conditions.push(`sl.item_id = $${params.length}`);
        }
        if (warehouseId) {
            params.push(warehouseId);
            conditions.push(`sl.warehouse_id = $${params.length}`);
        }

        const query = `
            SELECT sl.*, it.item_name, wh.warehouse_name, ib.batch_no
            FROM stock_ledger sl
            JOIN tbl_items it ON it.item_id = sl.item_id
            JOIN warehouse_mst wh ON wh.warehouse_id = sl.warehouse_id
            LEFT JOIN item_batches ib ON ib.batch_id = sl.batch_id
            WHERE ${conditions.join(" AND ")}
            ORDER BY sl.txn_date DESC, sl.stock_ledger_id DESC`;
        const result = await companyPool.query(query, params);
        return res.status(200).json({ message: "Stock Ledger Fetch Successfully", stockLedger: result.rows });
    } catch (err) {
        console.error("[getStockLedger]", err);
        return res.status(500).json({ error: "Failed to fetch Stock Ledger", details: err.message });
    }
}
///////////////////////Stock View End///////////////////////////


///////////////////////Stock Transfer Module Start///////////////////////////
const TRANSFER_STATUS_TRANSITIONS = {
    draft: ["in_transit", "cancelled"],
    in_transit: ["completed", "cancelled"],
    completed: [],
    cancelled: []
};

export async function getStockTransfers(req, res) {
    const { companyId } = req.session.user;
    const { transferId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    try {
        const base = `SELECT st.*,
            COALESCE((SELECT json_agg(i) FROM stock_transfer_items i
                WHERE i.stock_transfer_id = st.stock_transfer_id AND i.is_deleted = FALSE), '[]'::json) AS "itemsDetails"
            FROM stock_transfer st WHERE st.company_id = $1 AND st.is_deleted = FALSE`;

        let result;
        if (transferId) {
            result = await companyPool.query(`${base} AND st.stock_transfer_id = $2`, [companyId, transferId]);
            if (result.rows.length === 0) return res.status(404).json({ error: "Stock Transfer not found" });
        } else {
            result = await companyPool.query(`${base} ORDER BY st.transfer_no ASC`, [companyId]);
        }
        return res.status(200).json({ message: "Stock Transfer Fetch Successfully", StockTransfers: result.rows });
    } catch (err) {
        console.error("[getStockTransfers]", err);
        return res.status(500).json({ error: "Failed to fetch Stock Transfer List", details: err.message });
    }
}

export async function createStockTransfer(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};
        if (!payload.from_warehouse_id || !payload.to_warehouse_id) {
            return res.status(400).json({ success: false, error: "from_warehouse_id and to_warehouse_id are required" });
        }
        if (payload.from_warehouse_id === payload.to_warehouse_id) {
            return res.status(400).json({ success: false, error: "from_warehouse_id and to_warehouse_id cannot be the same" });
        }
        if (!payload.transfer_date) {
            return res.status(400).json({ success: false, error: "transfer_date is required" });
        }
        const items = Array.isArray(payload.itemsDetails) ? payload.itemsDetails : [];
        if (items.length === 0) {
            return res.status(400).json({ success: false, error: "At least one item is required" });
        }

        await client.query('BEGIN');

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.STOCK_TRANSFER, companyId, userId, financialYearId, client
        });
        const transferNo = seriesResult.series;

        const headerRes = await client.query(
            `INSERT INTO stock_transfer (transfer_no, transfer_date, from_warehouse_id, to_warehouse_id, status, notes, user_id, company_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [transferNo, payload.transfer_date, payload.from_warehouse_id, payload.to_warehouse_id,
                payload.status || 'draft', payload.notes || null, userId, companyId]
        );
        const transferId = headerRes.rows[0].stock_transfer_id;

        const insertedItems = [];
        for (const it of items) {
            const qty = num(it.quantity, NaN);
            if (!Number.isFinite(qty) || qty <= 0) {
                throw Object.assign(new Error("Each item requires a positive quantity"), { status: 400 });
            }
            const r = await client.query(
                `INSERT INTO stock_transfer_items (stock_transfer_id, item_id, batch_id, quantity, unit_id, user_id, company_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [transferId, it.item_id, it.batch_id || null, qty, it.unit_id || null, userId, companyId]
            );
            insertedItems.push(r.rows[0]);
        }

        await logAudit(client, {
            module_name: "Stock Transfer", 
            page_name: "Create Stock Transfer", 
            table_name: "stock_transfer",
            table_id: transferId, 
            action_type: "CREATE", 
            action_description: `Stock Transfer Created Successfully :${transferNo}`,
            new_value: JSON.stringify(headerRes.rows[0]), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(201).json({ success: true, message: 'Stock Transfer created', StockTransfers: headerRes.rows[0], itemsDetails: insertedItems });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createStockTransfer]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Stock Transfer", details: err.message });
    } finally {
        client.release();
    }
}

export async function deleteStockTransfer(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const { transferId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    
    try {
        await client.query('BEGIN');
        const result = await deleteModule(client, 'stock_transfer', 'stock_transfer_id', transferId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Stock Transfer not found" });
        }
        const itemsResult = await deleteModule(client, 'stock_transfer_items', 'stock_transfer_id', transferId, { company_id: companyId });
        await logAudit(client, {
            module_name: "Stock Transfer", 
            page_name: "Delete Stock Transfer", 
            table_name: "stock_transfer",
            table_id: transferId, 
            action_type: "DELETE", 
            action_description: `Stock Transfer Deleted Successfully`,
            new_value: JSON.stringify(result.result), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });
        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Stock Transfer Deleted', StockTransfers: result.result, Items: itemsResult.result });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteStockTransfer]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Stock Transfer", details: err.message });
    } finally {
        client.release();
    }
}

// Moving to 'completed' is what actually posts two stock_ledger rows per item
// (an OUT from the source warehouse, an IN to the destination warehouse) so
// that getStockSummary() reflects the movement.
export async function changeStockTransferStatus(req, res) {
    const { userId, companyId, roleId } = req.session.user;
    const { transferId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");

        const allowedStatuses = ["draft", "in_transit", "completed", "cancelled"];
        if (!allowedStatuses.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid stock transfer status: ${status}` });
        }

        const headerRes = await client.query(
            `SELECT * FROM stock_transfer WHERE stock_transfer_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [transferId, companyId]
        );
        if (headerRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Stock Transfer not found" });
        }
        const transfer = headerRes.rows[0];
        const currentStatus = transfer.status;

        if (currentStatus === status) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Stock Transfer is already ${status}` });
        }
        if (!TRANSFER_STATUS_TRANSITIONS[currentStatus]?.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Stock Transfer status cannot be changed from '${currentStatus}' to '${status}'` });
        }

        if (status === 'completed') {
            const itemsRes = await client.query(
                `SELECT * FROM stock_transfer_items WHERE stock_transfer_id = $1 AND is_deleted = FALSE`,
                [transferId]
            );
            for (const it of itemsRes.rows) {
                await client.query(
                    `INSERT INTO stock_ledger (item_id, warehouse_id, batch_id, txn_date, txn_type, txn_source, source_id, source_item_id, quantity, unit_id, user_id, company_id)
                     VALUES ($1,$2,$3,CURRENT_DATE,'OUT','STOCK_TRANSFER_OUT',$4,$5,$6,$7,$8,$9)`,
                    [it.item_id, transfer.from_warehouse_id, it.batch_id, transfer.stock_transfer_id, it.stock_transfer_item_id, it.quantity, it.unit_id, userId, companyId]
                );
                await client.query(
                    `INSERT INTO stock_ledger (item_id, warehouse_id, batch_id, txn_date, txn_type, txn_source, source_id, source_item_id, quantity, unit_id, user_id, company_id)
                     VALUES ($1,$2,$3,CURRENT_DATE,'IN','STOCK_TRANSFER_IN',$4,$5,$6,$7,$8,$9)`,
                    [it.item_id, transfer.to_warehouse_id, it.batch_id, transfer.stock_transfer_id, it.stock_transfer_item_id, it.quantity, it.unit_id, userId, companyId]
                );
            }
        }

        const updateRes = await client.query(
            `UPDATE stock_transfer SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE stock_transfer_id = $1 AND company_id = $2 RETURNING *`,
            [transferId, companyId, status]
        );

        await logAudit(client, {
            module_name: "Stock Transfer", 
            page_name: "Stock Transfer Status", 
            table_name: "stock_transfer",
            table_id: transferId, 
            action_type: "STATUS_CHANGE",
            action_description: `Stock Transfer status changed from ${currentStatus} to ${status}`,
            old_value: JSON.stringify(transfer), 
            new_value: JSON.stringify(updateRes.rows[0]),
            user_id: userId, 
            role_id: roleId, 
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: `Stock Transfer status changed from '${currentStatus}' to '${status}'`, StockTransfers: updateRes.rows[0] });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStockTransferStatus]", err);
        return res.status(500).json({ success: false, error: "Failed to change status of Stock Transfer", details: err.message });
    } finally {
        client.release();
    }
}
///////////////////////Stock Transfer Module End///////////////////////////


///////////////////////Stock Adjustment Module Start///////////////////////////
const ADJUSTMENT_STATUS_TRANSITIONS = {
    draft: ["approved", "cancelled"],
    approved: [],
    cancelled: []
};

export async function getStockAdjustments(req, res) {
    const { companyId } = req.session.user;
    const { adjustmentId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    try {
        const base = `SELECT sa.*,
            COALESCE((SELECT json_agg(i) FROM stock_adjustment_items i
                WHERE i.stock_adjustment_id = sa.stock_adjustment_id AND i.is_deleted = FALSE), '[]'::json) AS "itemsDetails"
            FROM stock_adjustment sa WHERE sa.company_id = $1 AND sa.is_deleted = FALSE`;

        let result;
        if (adjustmentId) {
            result = await companyPool.query(`${base} AND sa.stock_adjustment_id = $2`, [companyId, adjustmentId]);
            if (result.rows.length === 0) return res.status(404).json({ error: "Stock Adjustment not found" });
        } else {
            result = await companyPool.query(`${base} ORDER BY sa.adjustment_no ASC`, [companyId]);
        }
        return res.status(200).json({ message: "Stock Adjustment Fetch Successfully", StockAdjustments: result.rows });
    } catch (err) {
        console.error("[getStockAdjustments]", err);
        return res.status(500).json({ error: "Failed to fetch Stock Adjustment List", details: err.message });
    }
}

export async function createStockAdjustment(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const payload = req.body || {};
        if (!payload.warehouse_id) return res.status(400).json({ success: false, error: "warehouse_id is required" });
        if (!payload.adjustment_date) return res.status(400).json({ success: false, error: "adjustment_date is required" });
        const items = Array.isArray(payload.itemsDetails) ? payload.itemsDetails : [];
        if (items.length === 0) return res.status(400).json({ success: false, error: "At least one item is required" });

        await client.query('BEGIN');

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.STOCK_ADJUSTMENT, companyId, userId, financialYearId, client
        });
        const adjustmentNo = seriesResult.series;

        const headerRes = await client.query(
            `INSERT INTO stock_adjustment (adjustment_no, adjustment_date, warehouse_id, reason, status, notes, user_id, company_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [adjustmentNo, payload.adjustment_date, payload.warehouse_id, payload.reason || null,
                payload.status || 'draft', payload.notes || null, userId, companyId]
        );
        const adjustmentId = headerRes.rows[0].stock_adjustment_id;

        const insertedItems = [];
        for (const it of items) {
            const qty = num(it.quantity, NaN);
            if (!Number.isFinite(qty) || qty <= 0) {
                throw Object.assign(new Error("Each item requires a positive quantity"), { status: 400 });
            }
            if (!['increase', 'decrease'].includes(it.adjustment_type)) {
                throw Object.assign(new Error("Each item requires adjustment_type of 'increase' or 'decrease'"), { status: 400 });
            }
            const r = await client.query(
                `INSERT INTO stock_adjustment_items (stock_adjustment_id, item_id, batch_id, adjustment_type, quantity, unit_id, user_id, company_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
                [adjustmentId, it.item_id, it.batch_id || null, it.adjustment_type, qty, it.unit_id || null, userId, companyId]
            );
            insertedItems.push(r.rows[0]);
        }

        await logAudit(client, {
            module_name: "Stock Adjustment", 
            page_name: "Create Stock Adjustment", 
            table_name: "stock_adjustment",
            table_id: adjustmentId, 
            action_type: "CREATE", 
            action_description: `Stock Adjustment Created Successfully :${adjustmentNo}`,
            new_value: JSON.stringify(headerRes.rows[0]), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(201).json({ success: true, message: 'Stock Adjustment created', StockAdjustments: headerRes.rows[0], itemsDetails: insertedItems });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createStockAdjustment]", err);
        const status = err.status || 500;
        return res.status(status).json({ success: false, error: status === 400 ? err.message : "Failed to Create Stock Adjustment", details: err.message });
    } finally {
        client.release();
    }
}

export async function deleteStockAdjustment(req, res) {
    const { userId, roleId, companyId } = req.session.user;
    const { adjustmentId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query('BEGIN');
        const result = await deleteModule(client, 'stock_adjustment', 'stock_adjustment_id', adjustmentId, { company_id: companyId });
        if (result.result.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Stock Adjustment not found" });
        }
        const itemsResult = await deleteModule(client, 'stock_adjustment_items', 'stock_adjustment_id', adjustmentId, { company_id: companyId });
        
        await logAudit(client, {
            module_name: "Stock Adjustment", 
            page_name: "Delete Stock Adjustment", 
            table_name: "stock_adjustment",
            table_id: adjustmentId, 
            action_type: "DELETE", 
            action_description: `Stock Adjustment Deleted Successfully`,
            new_value: JSON.stringify(result.result), 
            user_id: userId, 
            role_id: roleId,
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Stock Adjustment Deleted', StockAdjustments: result.result, Items: itemsResult.result });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteStockAdjustment]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Stock Adjustment", details: err.message });
    } finally {
        client.release();
    }
}

// Moving to 'approved' posts the stock_ledger rows (IN for increase, OUT for decrease).
export async function changeStockAdjustmentStatus(req, res) {
    const { userId, companyId, roleId } = req.session.user;
    const { adjustmentId, status } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");

        const allowedStatuses = ["draft", "approved", "cancelled"];
        if (!allowedStatuses.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Invalid stock adjustment status: ${status}` });
        }

        const headerRes = await client.query(
            `SELECT * FROM stock_adjustment WHERE stock_adjustment_id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
            [adjustmentId, companyId]
        );
        if (headerRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Stock Adjustment not found" });
        }
        const adjustment = headerRes.rows[0];
        const currentStatus = adjustment.status;

        if (currentStatus === status) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Stock Adjustment is already ${status}` });
        }
        if (!ADJUSTMENT_STATUS_TRANSITIONS[currentStatus]?.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: `Stock Adjustment status cannot be changed from '${currentStatus}' to '${status}'` });
        }

        if (status === 'approved') {
            const itemsRes = await client.query(
                `SELECT * FROM stock_adjustment_items WHERE stock_adjustment_id = $1 AND is_deleted = FALSE`,
                [adjustmentId]
            );
            for (const it of itemsRes.rows) {
                const txnType = it.adjustment_type === 'increase' ? 'IN' : 'OUT';
                await client.query(
                    `INSERT INTO stock_ledger (item_id, warehouse_id, batch_id, txn_date, txn_type, txn_source, source_id, source_item_id, quantity, unit_id, remarks, user_id, company_id)
                     VALUES ($1,$2,$3,CURRENT_DATE,$4,'STOCK_ADJUSTMENT',$5,$6,$7,$8,$9,$10,$11)`,
                    [it.item_id, adjustment.warehouse_id, it.batch_id, txnType, adjustment.stock_adjustment_id, it.stock_adjustment_item_id, it.quantity, it.unit_id, adjustment.reason, userId, companyId]
                );
            }
        }

        const updateRes = await client.query(
            `UPDATE stock_adjustment SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE stock_adjustment_id = $1 AND company_id = $2 RETURNING *`,
            [adjustmentId, companyId, status]
        );

        await logAudit(client, {
            module_name: "Stock Adjustment", 
            page_name: "Stock Adjustment Status", 
            table_name: "stock_adjustment",
            table_id: adjustmentId, 
            action_type: "STATUS_CHANGE",
            action_description: `Stock Adjustment status changed from ${currentStatus} to ${status}`,
            old_value: JSON.stringify(adjustment), 
            new_value: JSON.stringify(updateRes.rows[0]),
            user_id: userId, 
            role_id: roleId, 
            ip_address: ipAddress, 
            device_info: deviceInfo, 
            company_id: companyId
        });

        await client.query("COMMIT");
        return res.status(200).json({ success: true, message: `Stock Adjustment status changed from '${currentStatus}' to '${status}'`, StockAdjustments: updateRes.rows[0] });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[changeStockAdjustmentStatus]", err);
        return res.status(500).json({ success: false, error: "Failed to change status of Stock Adjustment", details: err.message });
    } finally {
        client.release();
    }
}
///////////////////////Stock Adjustment Module End///////////////////////////
