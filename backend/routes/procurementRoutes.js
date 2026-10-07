// routes/procurementRoutes.js
import { Router } from "express";
import {
    getRequisitions, createRequisition, changeRequisitionStatus,
    getGoodsReceipts, createGoodsReceipt, approveGoodsReceipt,
    getSiteIssues, createSiteIssue, approveSiteIssue,
} from "../controllers/procurementController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/requisition", requireAuth, requirePermission("requisition:view"), getRequisitions);    //210
router.get("/requisition/:requisitionId", requireAuth, requirePermission("requisition:view"), getRequisitions);
router.post("/requisition", requireAuth, requirePermission("requisition:create"), createRequisition);   //211
router.post("/requisition/:requisitionId/:status", requireAuth, requirePermission("requisition:approve"), changeRequisitionStatus); //214

router.get("/grn", requireAuth, requirePermission("grn:view"), getGoodsReceipts);   //215
router.get("/grn/:grnId", requireAuth, requirePermission("grn:view"), getGoodsReceipts);
router.post("/grn", requireAuth, requirePermission("grn:create"), createGoodsReceipt);  //216
router.post("/grn/:grnId/:status", requireAuth, requirePermission("grn:approve"), approveGoodsReceipt); //219

router.get("/site-issue", requireAuth, requirePermission("site_issue:view"), getSiteIssues);    //220
router.get("/site-issue/:issueId", requireAuth, requirePermission("site_issue:view"), getSiteIssues);
router.post("/site-issue", requireAuth, requirePermission("site_issue:create"), createSiteIssue);   //221
router.post("/site-issue/:issueId/:status", requireAuth, requirePermission("site_issue:approve"), approveSiteIssue);    //224

export default router;