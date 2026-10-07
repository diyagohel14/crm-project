import { Router } from "express";
import {
    getCreditNotes, createCreditNote, updateCreditNote, deleteCreditNote, changeCreditNoteStatus,
} from "../controllers/creditNoteController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", requireAuth, requirePermission("credit_notes:view"), getCreditNotes);   //151
router.get("/:noteId", requireAuth, requirePermission("credit_notes:view"), getCreditNotes);
router.post("/", requireAuth, requirePermission("credit_notes:create"), createCreditNote);  //152
router.put("/:noteId", requireAuth, requirePermission("credit_notes:update"), updateCreditNote);    //153
router.delete("/:noteId", requireAuth, requirePermission("credit_notes:delete"), deleteCreditNote); //154
router.post("/:noteId/:status", requireAuth, requirePermission("credit_notes:approve"), changeCreditNoteStatus);    //155

export default router;
