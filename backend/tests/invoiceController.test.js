// import test from "node:test";
// import assert from "node:assert/strict";
// import { resolveInvoiceItemLink } from "../controllers/invoiceController.js";

// test("resolveInvoiceItemLink maps tax rows to the generated invoice item ids by index", () => {
//   const insertedItemIds = [101, 202, 303];

//   assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_id: 1 }), 202);
//   assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_id: "2" }), 303);
//   assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_index: 0 }), 101);
//   assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_index: "1" }), 202);
// });

import test from "node:test";
import assert from "node:assert/strict";
import { priceCalculation } from "../services/allService.js";
import { resolveInvoiceItemLink } from "../controllers/invoiceController.js";

// --- shared helper: resolveInvoiceItemLink (services/allService.js) ------------
// Used by every document type's tax-details table (invoice, PO, purchase
// invoice, quotation, proforma, delivery challan, ...).

test("resolveInvoiceItemLink maps by explicit index", () => {
  const insertedItemIds = [101, 202, 303];
  assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_index: 0 }), 101);
  assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_index: "1" }), 202);
});

test("resolveInvoiceItemLink accepts a real generated id", () => {
  const insertedItemIds = [101, 202, 303];
  assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_id: 202 }), 202);
});

test("resolveInvoiceItemLink no longer guesses an id is secretly an index", () => {
  // 1 is not one of the real generated ids below, so this must NOT
  // silently resolve to insertedItemIds[1] (202) — that was the old,
  // dangerous behavior. It should come back null (document-level tax).
  const insertedItemIds = [101, 202, 303];
  assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_id: 1 }), null);
});

test("resolveInvoiceItemLink returns null for an unmatched id/index", () => {
  const insertedItemIds = [101, 202, 303];
  assert.equal(resolveInvoiceItemLink(insertedItemIds, {}), null);
  assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_index: 9 }), null);
});

// invoiceController re-exports the same function under the
// invoice_item_id / invoice_item_index field names it's always used.
test("resolveInvoiceItemLink (invoiceController re-export) behaves the same way", () => {
  const insertedItemIds = [101, 202, 303];
  assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_index: 0 }), 101);
  assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_id: 303 }), 303);
  assert.equal(resolveInvoiceItemLink(insertedItemIds, { invoice_item_id: 1 }), null);
});

// --- shared helper: priceCalculation (services/allService.js) ---------------
// Same pricing engine invoice/PO/purchase-invoice/quotation/proforma/
// delivery-challan controllers should all call.

test("priceCalculation computes line and document totals from qty/rate/discount/tax", () => {
  const result = priceCalculation(
    [
      { quantity: 2, unit_rate: 100, discount_percent: 10, tax_percent: 18 }, // 200 -20 = 180 taxable, tax 32.4, total 212.4
      { quantity: 1, unit_rate: 50, tax_percent: 5 },                          // 50 taxable, tax 2.5, total 52.5
    ],
    { shipping_charges: 10, round_off: 0, paid_amount: 100 }
  );

  assert.equal(result.items[0].total_amount, 212.4);
  assert.equal(result.items[1].total_amount, 52.5);
  assert.equal(result.subtotal_amount, 230); // 180 + 50
  assert.equal(result.total_tax_amount, 34.9); // 32.4 + 2.5
  assert.equal(result.total_amount, 274.9); // 230 + 34.9 + 10 shipping
  assert.equal(result.balance_due, 174.9); // 274.9 - 100 paid
});

test("priceCalculation works for document types with no paid_amount/shipping (e.g. quotation)", () => {
  const result = priceCalculation(
    [{ quantity: 3, unit_rate: 20, tax_percent: 12 }],
    {} // quotations have no shipping_charges/round_off/paid_amount columns
  );
  assert.equal(result.subtotal_amount, 60);
  assert.equal(result.total_tax_amount, 7.2);
  assert.equal(result.total_amount, 67.2);
  assert.equal(result.balance_due, 67.2); // no payment against it yet
});

test("priceCalculation rejects an empty item list", () => {
  assert.throws(() => priceCalculation([], {}), /at least one item/i);
});

test("priceCalculation rejects a non-positive quantity", () => {
  assert.throws(
    () => priceCalculation([{ quantity: 0, unit_rate: 10 }], {}),
    /quantity must be a positive number/i
  );
});