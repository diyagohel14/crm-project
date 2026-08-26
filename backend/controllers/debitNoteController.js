import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { createDocumentNoteController } from "./documentNoteController.js";

const controller = createDocumentNoteController({
    kind: "debit",
    documentTypeId: DOCUMENT_TYPES.DEBIT_NOTE,
    table: "debit_notes",
    itemTable: "debit_note_items",
    taxTable: "debit_note_tax_details",
    noteIdColumn: "debit_note_id",
    noteNoColumn: "debit_note_no",
    dateColumn: "debit_date",
    sourceTable: "tbl_purchase_invoices",
    sourceIdColumn: "purchase_invoice_id",
    sourceItemTable: "tbl_purchase_invoice_items",
    sourceItemIdColumn: "purchase_invoice_item_id",
    permissionPrefix: "debit_notes",
});

export const {
    getNotes: getDebitNotes,
    createNote: createDebitNote,
    updateNote: updateDebitNote,
    deleteNote: deleteDebitNote,
    changeStatus: changeDebitNoteStatus,
} = controller;
