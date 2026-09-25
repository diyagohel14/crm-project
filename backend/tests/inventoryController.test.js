import test from "node:test";
import assert from "node:assert/strict";
import { parseInventoryQuantity } from "../controllers/inventoryController.js";

test("parseInventoryQuantity accepts numeric strings and numbers", () => {
  assert.equal(parseInventoryQuantity("2.5"), 2.5);
  assert.equal(parseInventoryQuantity(3), 3);
});

test("parseInventoryQuantity rejects zero, negative, and non-numeric values", () => {
  for (const value of [0, -1, "", "abc", null]) {
    assert.throws(() => parseInventoryQuantity(value), /positive quantity/i);
  }
});