// routes/inventoryRoutes.js
import { Router } from "express";
import {
    viewWarehouseList, viewWarehouse, createWarehouse, updateWarehouse, deleteWarehouse,
    viewBatchList, createBatch, updateBatch, deleteBatch,
    getStockSummary, getStockLedger,
    getStockTransfers, createStockTransfer, deleteStockTransfer, changeStockTransferStatus,
    getStockAdjustments, createStockAdjustment, deleteStockAdjustment, changeStockAdjustmentStatus
} from "../controllers/inventoryController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

// Warehouse Master
router.get("/warehouse", requireAuth, requirePermission("warehouse:view"), viewWarehouseList);  //163
router.get("/warehouse/:warehouseId", requireAuth, requirePermission("warehouse:view"), viewWarehouse);
router.post("/warehouse", requireAuth, requirePermission("warehouse:create"), createWarehouse); //164
router.put("/warehouse/:warehouseId", requireAuth, requirePermission("warehouse:update"), updateWarehouse); //165
router.delete("/warehouse/:warehouseId", requireAuth, requirePermission("warehouse:delete"), deleteWarehouse);  //166

// Item Batch Master
router.get("/batch", requireAuth, requirePermission("item_batches:view"), viewBatchList);   //167
router.post("/batch", requireAuth, requirePermission("item_batches:create"), createBatch);  //168
router.put("/batch/:batchId", requireAuth, requirePermission("item_batches:update"), updateBatch);  //169
router.delete("/batch/:batchId", requireAuth, requirePermission("item_batches:delete"), deleteBatch);   //170

// Stock View
router.get("/stock/summary", requireAuth, requirePermission("stock:view"), getStockSummary);    //171
router.get("/stock/ledger", requireAuth, requirePermission("stock:view"), getStockLedger); 

// Stock Transfer
router.get("/transfer", requireAuth, requirePermission("stock_transfer:view"), getStockTransfers);  //172
router.get("/transfer/:transferId", requireAuth, requirePermission("stock_transfer:view"), getStockTransfers);
router.post("/transfer", requireAuth, requirePermission("stock_transfer:create"), createStockTransfer); //173
router.delete("/transfer/:transferId", requireAuth, requirePermission("stock_transfer:delete"), deleteStockTransfer);   //175
router.post("/transfer/:transferId/:status", requireAuth, requirePermission("stock_transfer:approve"), changeStockTransferStatus);  //176

// Stock Adjustment
router.get("/adjustment", requireAuth, requirePermission("stock_adjustment:view"), getStockAdjustments);    //177
router.get("/adjustment/:adjustmentId", requireAuth, requirePermission("stock_adjustment:view"), getStockAdjustments);
router.post("/adjustment", requireAuth, requirePermission("stock_adjustment:create"), createStockAdjustment);   //178
router.delete("/adjustment/:adjustmentId", requireAuth, requirePermission("stock_adjustment:delete"), deleteStockAdjustment);   //180
router.post("/adjustment/:adjustmentId/:status", requireAuth, requirePermission("stock_adjustment:approve"), changeStockAdjustmentStatus);  //181


export default router;
