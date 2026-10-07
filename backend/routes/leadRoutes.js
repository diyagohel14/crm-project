// routes/leadRoutes.js

import { Router } from "express";
import {
    getLeads, createLead, updateLead, deleteLead, changeLeadStatus, convertLead,
} from "../controllers/leadController.js";
import { getLeadActivities, addLeadActivity } from "../controllers/crmController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

// LEAD
router.get("/", requireAuth, requirePermission("lead:view"), getLeads); //225
router.get("/:leadId", requireAuth, requirePermission("lead:view"), getLeads);  
router.post("/", requireAuth, requirePermission("lead:create"), createLead);    //226
router.put("/:leadId", requireAuth, requirePermission("lead:update"), updateLead);  //227
router.delete("/:leadId", requireAuth, requirePermission("lead:delete"), deleteLead);   //228
router.post("/:leadId/status/:status", requireAuth, requirePermission("lead:update"), changeLeadStatus);

// Converting creates a customer, so it needs the customer permission as well.
router.post("/:leadId/convert", requireAuth,
    requirePermission("lead:convert"), requirePermission("customer:create"), convertLead);

// ACTIVITIES (calls, meetings, notes...)
router.get("/:leadId/activities", requireAuth, requirePermission("lead:view"), getLeadActivities);
router.post("/:leadId/activities", requireAuth, requirePermission("lead:update"), addLeadActivity);

export default router;
