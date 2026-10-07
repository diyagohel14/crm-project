import test from "node:test";
import assert from "node:assert/strict";
import { validateGoodsReceiptItems } from "../controllers/procurementController.js";

const purchaseOrderItems = [
  { purchase_order_item_id: 10, item_id: 4, quantity: 20 },
  { purchase_order_item_id: 11, item_id: 5, quantity: 8 },
];

test("validateGoodsReceiptItems aggregates repeated PO lines", () => {
  const quantities = validateGoodsReceiptItems([
    { purchase_order_item_id: 10, item_id: 4, quantity: 6 },
    { purchase_order_item_id: 10, item_id: 4, quantity: 3 },
    { purchase_order_item_id: 11, item_id: 5, quantity: 2 },
  ], purchaseOrderItems);

  assert.equal(quantities.get(10), 9);
  assert.equal(quantities.get(11), 2);
});

test("validateGoodsReceiptItems requires a PO line reference", () => {
  assert.throws(
    () => validateGoodsReceiptItems([{ item_id: 4, quantity: 2 }], purchaseOrderItems),
    /must reference a Purchase Order item/i
  );
});

test("validateGoodsReceiptItems rejects lines outside the PO", () => {
  assert.throws(
    () => validateGoodsReceiptItems([{ purchase_order_item_id: 99, item_id: 4, quantity: 2 }], purchaseOrderItems),
    /not linked to this Purchase Order/i
  );
});

test("validateGoodsReceiptItems rejects an item that differs from the PO line", () => {
  assert.throws(
    () => validateGoodsReceiptItems([{ purchase_order_item_id: 10, item_id: 5, quantity: 2 }], purchaseOrderItems),
    /does not match its Purchase Order item/i
  );
});