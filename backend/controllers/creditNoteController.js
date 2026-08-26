import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { createDocumentNoteController } from "./documentNoteController.js";

const controller = createDocumentNoteController({
    kind: "credit",
    documentTypeId: DOCUMENT_TYPES.CREDIT_NOTE,
    table: "credit_notes",
    itemTable: "credit_note_items",
    taxTable: "credit_note_tax_details",
    noteIdColumn: "credit_note_id",
    noteNoColumn: "credit_note_no",
    dateColumn: "credit_date",
    sourceTable: "tbl_invoice",
    sourceIdColumn: "invoice_id",
    sourceItemTable: "tbl_invoice_items",
    sourceItemIdColumn: "invoice_item_id",
    permissionPrefix: "credit_notes",
});

export const {
    getNotes: getCreditNotes,
    createNote: createCreditNote,
    updateNote: updateCreditNote,
    deleteNote: deleteCreditNote,
    changeStatus: changeCreditNoteStatus,
} = controller;
