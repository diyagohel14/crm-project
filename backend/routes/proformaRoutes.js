// routes/proformaRoutes.js

import { Router } from "express";
import {
    getProformas, createProforma, updateProforma, deleteProforma, deleteProformaItems, changeStatus
} from "../controllers/proformaController.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//QUOTAITONS 
router.get("/", requireAuth, 
    requirePermission("proforma:view"), 
    getProformas);  //139
router.get("/:proformaId", requireAuth, 
    requirePermission("proforma:view"), 
    getProformas);
router.post("/", requireAuth, 
    requirePermission("proforma:create"), 
    createProforma);  //140
router.put("/:proformaId", requireAuth, 
    requirePermission("proforma:update"), 
    updateProforma);  //141
router.delete("/:proformaId", requireAuth, 
    requirePermission("proforma:delete"), 
    deleteProforma);  //142
router.delete("/:proformaId/:proformaItemId", requireAuth, 
    requirePermission("proforma:delete"), 
    deleteProformaItems);  //only delete the item and tax
router.post("/:proformaId/:status", requireAuth, 
    requirePermission("proforma:approve"), 
    changeStatus);    //143



export default router;