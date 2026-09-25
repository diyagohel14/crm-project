// routes/procurementRoutes.js
import { Router } from "express";
import {
    getRequisitions, createRequisition, changeRequisitionStatus,
    getGoodsReceipts, createGoodsReceipt, approveGoodsReceipt,
    getSiteIssues, createSiteIssue, approveSiteIssue,
} from "../controllers/procurementController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/requisition", requireAuth, /*requirePermission("requisition:view"),*/ getRequisitions);
router.get("/requisition/:requisitionId", requireAuth, /*requirePermission("requisition:view"),*/ getRequisitions);
router.post("/requisition", requireAuth, /*requirePermission("requisition:create"),*/ createRequisition);
router.post("/requisition/:requisitionId/:status", requireAuth, /*requirePermission("requisition:approve"),*/ changeRequisitionStatus);

router.get("/grn", requireAuth, /*requirePermission("grn:view"),*/ getGoodsReceipts);
router.get("/grn/:grnId", requireAuth, /*requirePermission("grn:view"),*/ getGoodsReceipts);
router.post("/grn", requireAuth, /*requirePermission("grn:create"),*/ createGoodsReceipt);
router.post("/grn/:grnId/:status", requireAuth, /*requirePermission("grn:approve"),*/ approveGoodsReceipt);

router.get("/site-issue", requireAuth, /*requirePermission("site_issue:view"),*/ getSiteIssues);
router.get("/site-issue/:issueId", requireAuth, /*requirePermission("site_issue:view"),*/ getSiteIssues);
router.post("/site-issue", requireAuth, /*requirePermission("site_issue:create"),*/ createSiteIssue);
router.post("/site-issue/:issueId/:status", requireAuth, /*requirePermission("site_issue:approve"),*/ approveSiteIssue);

export default router;