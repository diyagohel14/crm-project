// routes/manpowerRoutes.js

import { Router } from "express";
import {
    getLabourTrades, createLabourTrade,
    getManpowerLogs, addManpowerLog, updateManpowerLog, deleteManpowerLog,
} from "../controllers/manpowerController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/trades", requireAuth, requirePermission("labour_trade:view"), getLabourTrades);    //245
router.post("/trades", requireAuth, requirePermission("labour_trade:create"), createLabourTrade);   //246

router.get("/:projectId/logs", requireAuth, requirePermission("manpower_log:view"), getManpowerLogs);   //247
router.post("/:projectId/logs", requireAuth, requirePermission("manpower_log:create"), addManpowerLog); //248
router.put("/:projectId/logs/:manpowerLogId", requireAuth, requirePermission("manpower_log:update"), updateManpowerLog);    //249
router.delete("/:projectId/logs/:manpowerLogId", requireAuth, requirePermission("manpower_log:delete"), deleteManpowerLog); //250

export default router;
