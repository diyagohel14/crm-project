import { Router } from "express";
import {
    getDebitNotes, createDebitNote, updateDebitNote, deleteDebitNote, changeDebitNoteStatus,
} from "../controllers/debitNoteController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", requireAuth, requirePermission("debit_notes:view"), getDebitNotes);
router.get("/:noteId", requireAuth, requirePermission("debit_notes:view"), getDebitNotes);
router.post("/", requireAuth, requirePermission("debit_notes:create"), createDebitNote);
router.put("/:noteId", requireAuth, requirePermission("debit_notes:update"), updateDebitNote);
router.delete("/:noteId", requireAuth, requirePermission("debit_notes:delete"), deleteDebitNote);
router.post("/:noteId/:status", requireAuth, requirePermission("debit_notes:approve"), changeDebitNoteStatus);

export default router;
