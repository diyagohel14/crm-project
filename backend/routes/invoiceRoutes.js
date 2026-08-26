// routes/invoiceRoutes.js
import { Router } from "express";
import {
    getSalesInvoices, createSalesInvoice, updateSalesInvoice, deleteSalesInvoice, deleteSalesInvoiceItems, changeStatus
} from "../controllers/invoiceController.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//SALES INVOICE 
router.get("/", requireAuth, 
    requirePermission("invoice:view"), 
    getSalesInvoices);  //109
router.get("/:invoiceId", requireAuth, 
    requirePermission("invoice:view"), 
    getSalesInvoices);
router.post("/", requireAuth, 
    requirePermission("invoice:create"), 
    createSalesInvoice);  //110
router.put("/:invoiceId", requireAuth, 
    requirePermission("invoice:update"), 
    updateSalesInvoice);  //111
router.delete("/:invoiceId", requireAuth, 
    requirePermission("invoice:delete"), 
    deleteSalesInvoice);  //112  
router.delete("/:invoiceId/:invoiceItemId", requireAuth, 
    requirePermission("invoice:delete"), 
    deleteSalesInvoiceItems);  //only delete the item and tax
router.post("/:invoiceId/:status", requireAuth, 
    requirePermission("invoice:approve"), 
    changeStatus);    //113



export default router;