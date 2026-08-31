// constants/documentTypes.js

// use for seeding the default document types for a new company in the company database table "document_types"
export const DEFAULT_DOCUMENT_TYPES = [
  { document_type_name: "Employee", document_type_id: 1 },
  { document_type_name: "Customer", document_type_id: 2 },
  { document_type_name: "Vendor", document_type_id: 3 },
  { document_type_name: "Items", document_type_id: 4 },
  { document_type_name: "Quotation", document_type_id: 5 },
  { document_type_name: "Proforma", document_type_id: 6 },
  { document_type_name: "Purchase Order", document_type_id: 7 },
  { document_type_name: "Invoice", document_type_id: 8 },
  { document_type_name: "Purchase Invoice", document_type_id: 9 },
  { document_type_name: "Delivery Challan", document_type_id: 10 },
  { document_type_name: "Credit Note", document_type_id: 11 },
  { document_type_name: "Debit Note", document_type_id: 12 },
  { document_type_name: "Salse Order", document_type_id: 13 },

]

// use for referencing document types in the code
export const DOCUMENT_TYPES = {
  EMPLOYEE: 1,
  CUSTOMER: 2,
  VENDOR: 3,
  ITEM: 4,
  QUOTATION: 5,
  PROFORMA: 6,
  PURCHASE_ORDER: 7,
  INVOICE: 8,
  PURCHASE_INVOICE: 9,
  DELIVERY_CHALLAN: 10,
  CREDIT_NOTE: 11,
  DEBIT_NOTE: 12,
  SALES_ORDER: 13,
};

export const DOCUMENT_SERIES = [
  { document_type_id: 1, prefix: "EMP/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 2, prefix: "CUST/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 3, prefix: "VEND/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 4, prefix: "ITEM/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 5, prefix: "QUOTE/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 6, prefix: "PROFORMA/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 7, prefix: "PO/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 8, prefix: "INV/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 9, prefix: "PI/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 10, prefix: "DC/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 11, prefix: "CREDIT-NOTE/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 12, prefix: "DEBIT-NOTE/", postfix: "", financial_year_id: "", padding_length: 5 },
  { document_type_id: 13, prefix: "SO/", postfix: "", financial_year_id: "", padding_length: 5 },

]