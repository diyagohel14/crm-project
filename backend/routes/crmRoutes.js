// routes/crmRoutes.js  (mounted at /api/crm)

import { Router } from "express";
import {
    getLeadSources, createLeadSource, getIndustries, createIndustry, getFollowUps,
} from "../controllers/crmController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

// Follow-ups: what needs chasing today. Shows both leads and enquiries, so
// the caller needs to be allowed to see both.
router.get("/follow-ups", requireAuth,
    requirePermission("lead:view"), requirePermission("enquiry:view"), getFollowUps);

// MASTERS
router.get("/lead_sources", requireAuth, requirePermission("lead_source:view"), getLeadSources);    //237
router.post("/lead_sources", requireAuth, requirePermission("lead_source:create"), createLeadSource);   //238
router.get("/industries", requireAuth, requirePermission("industry:view"), getIndustries);  //239
router.post("/industries", requireAuth, requirePermission("industry:create"), createIndustry);  //240

export default router;
