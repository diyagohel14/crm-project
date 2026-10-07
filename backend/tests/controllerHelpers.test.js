import test from "node:test";
import assert from "node:assert/strict";
import { resolveInvoiceItemLink } from "../controllers/invoiceController.js";
import { resolveProformaItemLink } from "../controllers/proformaController.js";
import { resolveInvoiceItemLink as resolvePurchaseInvoiceItemLink } from "../controllers/purchaseInvoiceController.js";
import { resolvePurchaseOrderItemLink } from "../controllers/purchaseorderController.js";
import { resolveQuotationItemLink } from "../controllers/quotationController.js";
import { resolveSalesOrderItemLink } from "../controllers/salesorderController.js";
import { resolveDeliveryChallanItemLink } from "../controllers/deliverychallanController.js";
import { parseInventoryQuantity } from "../controllers/inventoryController.js";
import { validateGoodsReceiptItems } from "../controllers/procurementController.js";

test("document tax details resolve linked item indexes and IDs", () => {
  const ids = [101, 202];
  const helpers = [
    [resolveInvoiceItemLink, "invoice_item_index", "invoice_item_id"],
    [resolveProformaItemLink, "proforma_item_index", "proforma_item_id"],
    [resolvePurchaseInvoiceItemLink, "purchase_invoice_item_index", "purchase_invoice_item_id"],
    [resolvePurchaseOrderItemLink, "purchase_order_item_index", "purchase_order_item_id"],
    [resolveQuotationItemLink, "quotation_item_index", "quotation_item_id"],
    [resolveSalesOrderItemLink, "sales_order_item_index", "sales_order_item_id"],
    [resolveDeliveryChallanItemLink, "delivery_challan_item_index", "delivery_challan_item_id"],
  ];
  for (const [resolveItemLink, indexField, idField] of helpers) {
    assert.equal(resolveItemLink(ids, { [indexField]: "1" }), 202);
    assert.equal(resolveItemLink(ids, { [idField]: "101" }), 101);
    assert.equal(resolveItemLink(ids, { [indexField]: "99", [idField]: "999" }), null);
    assert.equal(resolveItemLink(null, {}), null);
  }
});

test("inventory quantity accepts positive finite values only", () => {
  assert.equal(parseInventoryQuantity("12.50"), 12.5);
  assert.throws(() => parseInventoryQuantity("0"), /positive/);
  assert.throws(() => parseInventoryQuantity("invalid"), /positive/);
});

test("goods receipt validation links items to the purchase order", () => {
  const purchaseOrderItems = [
    { purchase_order_item_id: 10, item_id: 4 },
    { purchase_order_item_id: 11, item_id: 5 },
  ];
  const quantities = validateGoodsReceiptItems([
    { purchase_order_item_id: "10", item_id: "4", quantity: 3 },
    { purchase_order_item_id: 10, item_id: 4, quantity: 2 },
  ], purchaseOrderItems);
  assert.deepEqual([...quantities.entries()], [[10, 5]]);
  assert.throws(() => validateGoodsReceiptItems([
    { purchase_order_item_id: 10, item_id: 99, quantity: 1 },
  ], purchaseOrderItems), /does not match/);
  assert.throws(() => validateGoodsReceiptItems([
    { purchase_order_item_id: 999, item_id: 4, quantity: 1 },
  ], purchaseOrderItems), /not linked/);
});
