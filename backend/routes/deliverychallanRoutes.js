// routes/deliverychallanRoutes.js

import { Router } from "express";
import {
    getDeliveryChallans, createDeliveryChallan, updateDeliveryChallan, deleteDeliveryChallan, deleteDeliveryChallanItems, changeStatus
} from "../controllers/deliverychallanController.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//QUOTAITONS 
router.get("/", requireAuth, 
    requirePermission("delivery_challan:view"), 
    getDeliveryChallans);  //145
router.get("/:deliverychallanId", requireAuth, 
    requirePermission("delivery_challan:view"), 
    getDeliveryChallans);
router.post("/", requireAuth, 
    requirePermission("delivery_challan:create"), 
    createDeliveryChallan);  //146
router.put("/:deliverychallanId", requireAuth, 
    requirePermission("delivery_challan:update"), 
    updateDeliveryChallan);  //147
router.delete("/:deliverychallanId", requireAuth, 
    requirePermission("delivery_challan:delete"), 
    deleteDeliveryChallan);  //148
router.delete("/:deliverychallanId/:deliverychallanItemId", requireAuth, 
    requirePermission("delivery_challan:delete"), 
    deleteDeliveryChallanItems);  //only delete the item and tax
router.post("/:deliverychallanId/:status", requireAuth, 
    requirePermission("delivery_challan:approve"), 
    changeStatus);    //149



export default router;