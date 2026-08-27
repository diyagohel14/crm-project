// routes/purchaseorderRoutes.js
import { Router } from "express";
import {
    getPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder, deletePurchaseOrderItems, changeStatus
} from "../controllers/purchaseorderController.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//SALES INVOICE 
router.get("/", requireAuth, 
    requirePermission("purchase_order:view"), 
    getPurchaseOrders);  //133
router.get("/:purchaseOrderId", requireAuth, 
    requirePermission("purchase_order:view"), 
    getPurchaseOrders);
router.post("/", requireAuth, 
    requirePermission("purchase_order:create"), 
    createPurchaseOrder);  //134
router.put("/:purchaseOrderId", requireAuth, 
    requirePermission("purchase_order:update"), 
    updatePurchaseOrder);  //135
router.delete("/:purchaseOrderId", requireAuth, 
    requirePermission("purchase_order:delete"), 
    deletePurchaseOrder);  //136
router.delete("/:purchaseOrderId/:purchaseOrderItemId", requireAuth, 
    requirePermission("purchase_order:delete"), 
    deletePurchaseOrderItems);  //only delete the item and tax
router.post("/:purchaseOrderId/:status", requireAuth, 
    requirePermission("purchase_order:approve"), 
    changeStatus);    //137



export default router;