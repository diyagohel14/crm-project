// routes/purchaseInvoiceRoutes.js
import { Router } from "express";
import {
    getPurchaseInvoices, createPurchaseInvoice, updatePurchaseInvoice, deletePurchaseInvoice, deletePurchaseInvoiceItems, changeStatus
} from "../controllers/purchaseInvoiceController.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//PURCHASE INVOICE 
router.get("/", requireAuth, 
    requirePermission("purchase_invoice:view"), 
    getPurchaseInvoices);  //115
router.get("/:invoiceId", requireAuth, 
    requirePermission("purchase_invoice:view"), 
    getPurchaseInvoices);
router.post("/", requireAuth, 
    requirePermission("purchase_invoice:create"), 
    createPurchaseInvoice);  //116
router.put("/:invoiceId", requireAuth, 
    requirePermission("purchase_invoice:update"), 
    updatePurchaseInvoice);  //117
router.delete("/:invoiceId", requireAuth, 
    requirePermission("purchase_invoice:delete"), 
    deletePurchaseInvoice);  //118
router.delete("/:invoiceId/:invoiceItemId", requireAuth, 
    requirePermission("purchase_invoice:delete"), 
    deletePurchaseInvoiceItems);  //only delete the item and tax
router.post("/:invoiceId/:status", requireAuth, 
    requirePermission("purchase_invoice:approve"), 
    changeStatus);    //119



export default router;