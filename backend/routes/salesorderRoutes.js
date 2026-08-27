// routes/salesorderRoutes.js
import { Router } from "express";
import {
    getSalesOrders, createSalesOrder, updateSalesOrder, deleteSalesOrder, deleteSalesOrderItems, changeStatus
} from "../controllers/salesorderController.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//SALES INVOICE 
router.get("/", requireAuth, 
    requirePermission("sales_order:view"), 
    getSalesOrders);  //127
router.get("/:salesOrderId", requireAuth, 
    requirePermission("sales_order:view"), 
    getSalesOrders);
router.post("/", requireAuth, 
    requirePermission("sales_order:create"), 
    createSalesOrder);  //128
router.put("/:salesOrderId", requireAuth, 
    requirePermission("sales_order:update"), 
    updateSalesOrder);  //129
router.delete("/:salesOrderId", requireAuth, 
    requirePermission("sales_order:delete"), 
    deleteSalesOrder);  //130
router.delete("/:salesOrderId/:salesOrderItemId", requireAuth, 
    requirePermission("sales_order:delete"), 
    deleteSalesOrderItems);  //only delete the item and tax
router.post("/:salesOrderId/:status", requireAuth, 
    requirePermission("sales_order:approve"), 
    changeStatus);    //131



export default router;