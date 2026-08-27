import { Router } from "express";
import {
    getCreditNotes, createCreditNote, updateCreditNote, deleteCreditNote, changeCreditNoteStatus,
} from "../controllers/creditNoteController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", requireAuth, /*requirePermission("credit_notes:view"),*/ getCreditNotes);
router.get("/:noteId", requireAuth, /*requirePermission("credit_notes:view"),*/ getCreditNotes);
router.post("/", requireAuth, /*requirePermission("credit_notes:create"),*/ createCreditNote);
router.put("/:noteId", requireAuth, /*requirePermission("credit_notes:update"),*/ updateCreditNote);
router.delete("/:noteId", requireAuth, /*requirePermission("credit_notes:delete"),*/ deleteCreditNote);
router.post("/:noteId/:status", requireAuth, /*requirePermission("credit_notes:approve"),*/ changeCreditNoteStatus);

export default router;
