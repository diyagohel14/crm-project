// routes/quotationRoutes.js

import { Router } from "express";
import {
    getQuotations, createQuotation, updateQuotation, deleteQuotation, deleteQuotationItems, changeStatus
} from "../controllers/quotationController.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//QUOTAITONS 
router.get("/", requireAuth, 
    requirePermission("quotation:view"), 
    getQuotations);  //121
router.get("/:quotationId", requireAuth, 
    requirePermission("quotation:view"), 
    getQuotations);
router.post("/", requireAuth, 
    requirePermission("quotation:create"), 
    createQuotation);  //122
router.put("/:quotationId", requireAuth, 
    requirePermission("quotation:update"), 
    updateQuotation);  //123
router.delete("/:quotationId", requireAuth, 
    requirePermission("quotation:delete"), 
    deleteQuotation);  //124
router.delete("/:quotationId/:quotationItemId", requireAuth, 
    requirePermission("quotation:delete"), 
    deleteQuotationItems);  //only delete the item and tax
router.post("/:quotationId/:status", requireAuth, 
    requirePermission("quotation:approve"), 
    changeStatus);    //125



export default router;