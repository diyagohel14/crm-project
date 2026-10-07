// routes/equipmentRoutes.js

import { Router } from "express";
import {
    getEquipment, createEquipment, updateEquipment, deleteEquipment,
    getEquipmentLogs, addEquipmentLog, updateEquipmentLog, deleteEquipmentLog,
} from "../controllers/equipmentController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", requireAuth, requirePermission("equipment:view"), getEquipment);    //241
router.get("/:equipmentId", requireAuth, requirePermission("equipment:view"), getEquipment);    
router.post("/", requireAuth, requirePermission("equipment:create"), createEquipment);  //242
router.put("/:equipmentId", requireAuth, requirePermission("equipment:update"), updateEquipment);   //243
router.delete("/:equipmentId", requireAuth, requirePermission("equipment:delete"), deleteEquipment);    //244

router.get("/project/:projectId/logs", requireAuth, requirePermission("equipment_log:view"), getEquipmentLogs); //251
router.post("/project/:projectId/logs", requireAuth, requirePermission("equipment_log:create"), addEquipmentLog);   //252
router.put("/project/:projectId/logs/:equipmentLogId", requireAuth, requirePermission("equipment_log:update"), updateEquipmentLog); //253
router.delete("/project/:projectId/logs/:equipmentLogId", requireAuth, requirePermission("equipment_log:delete"), deleteEquipmentLog);  //254

export default router;
