// routes/enquiryRoutes.js

import { Router } from "express";
import {
    getEnquiries, createEnquiry, updateEnquiry, deleteEnquiry, changeEnquiryStatus, linkQuotation,
    getEnquiryDocuments, addEnquiryDocument, deleteEnquiryDocument,
} from "../controllers/enquiryController.js";
import { getEnquiryActivities, addEnquiryActivity } from "../controllers/crmController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

// ENQUIRY
router.get("/", requireAuth, requirePermission("enquiry:view"), getEnquiries);  //230
router.get("/:enquiryId", requireAuth, requirePermission("enquiry:view"), getEnquiries);
router.post("/", requireAuth, requirePermission("enquiry:create"), createEnquiry);  //231
router.put("/:enquiryId", requireAuth, requirePermission("enquiry:update"), updateEnquiry); //232
router.delete("/:enquiryId", requireAuth, requirePermission("enquiry:delete"), deleteEnquiry);  //233
router.post("/:enquiryId/status/:status", requireAuth, requirePermission("enquiry:update"), changeEnquiryStatus);
router.post("/:enquiryId/link-quotation/:quotationId", requireAuth, requirePermission("enquiry:update"), linkQuotation);

// ACTIVITIES
router.get("/:enquiryId/activities", requireAuth, requirePermission("enquiry:view"), getEnquiryActivities);
router.post("/:enquiryId/activities", requireAuth, requirePermission("enquiry:update"), addEnquiryActivity);

// DOCUMENTS (RFQ, drawings, specs, tender documents)
router.get("/:enquiryId/documents", requireAuth, requirePermission("enquiry_document:view"), getEnquiryDocuments);  //234
router.post("/:enquiryId/documents", requireAuth, requirePermission("enquiry_document:create"), addEnquiryDocument);    //235
router.delete("/:enquiryId/documents/:documentId", requireAuth, requirePermission("enquiry_document:delete"), deleteEnquiryDocument);   //236

export default router;
