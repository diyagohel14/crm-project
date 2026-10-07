import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidLeadTransition,
  isValidEnquiryTransition,
  cleanText,
  normalizePhone,
  normalizeEmail,
  isValidEmail,
  isValidDateOnly,
  assertCommonFields,
  pickFields,
  buildSetClause,
  mapDbError,
  parsePaging,
} from "../services/crmService.js";

test("CRM status helpers allow valid transitions and reject invalid ones", () => {
  assert.equal(isValidLeadTransition("new", "contacted"), true);
  assert.equal(isValidLeadTransition("converted", "new"), false);
  assert.equal(isValidEnquiryTransition("quoted", "won"), true);
  assert.equal(isValidEnquiryTransition("won", "quoted"), false);
});

test("CRM normalization helpers clean text, phone numbers, and email", () => {
  assert.equal(cleanText("  Alpha  "), "Alpha");
  assert.equal(cleanText("   "), null);
  assert.equal(normalizePhone("+91 (98765) 43210"), "9876543210");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidDateOnly("2024-02-29"), true);
  assert.equal(isValidDateOnly("2025-02-29"), false);
});

test("assertCommonFields reports invalid dates, enums, emails, and amounts", () => {
  assert.doesNotThrow(() => assertCommonFields({ email: "a@b.com", estimated_value: 0 }, {
    dateFields: ["due_date"],
    enumChecks: { priority: ["low", "high"] },
  }));
  assert.throws(() => assertCommonFields({ due_date: "2025-02-29" }, { dateFields: ["due_date"] }), /YYYY-MM-DD/);
  assert.throws(() => assertCommonFields({ priority: "urgent" }, { enumChecks: { priority: ["low", "high"] } }), /priority/);
  assert.throws(() => assertCommonFields({ email: "bad" }), /email/);
  assert.throws(() => assertCommonFields({ estimated_value: -1 }), /zero or greater/);
});

test("pickFields and buildSetClause preserve allow-list order", () => {
  const pairs = pickFields(
    { name: "  Alpha ", enabled: 0, email: "USER@EXAMPLE.COM", ignored: "x" },
    ["name", "enabled", "email"],
    { textColumns: ["name"], boolColumns: ["enabled"], transforms: { email: normalizeEmail } },
  );
  assert.deepEqual(pairs, [["name", "Alpha"], ["enabled", false], ["email", "user@example.com"]]);
  assert.deepEqual(buildSetClause(pairs), {
    setSql: "name = $1, enabled = $2, email = $3",
    values: ["Alpha", false, "user@example.com"],
  });
});

test("CRM database errors map to stable HTTP responses", () => {
  assert.deepEqual(mapDbError({ code: "23505" }), { status: 409, message: "That record already exists" });
  assert.deepEqual(mapDbError({ code: "22P02" }), { status: 400, message: "A field has an invalid value" });
  assert.deepEqual(mapDbError({ status: 418, message: "custom" }), { status: 418, message: "custom" });
  assert.equal(mapDbError({ code: "UNKNOWN" }), null);
});

test("parsePaging clamps invalid, negative, and oversized values", () => {
  assert.deepEqual(parsePaging({ limit: "5000", offset: "-5" }, { maxLimit: 100 }), { limit: 100, offset: 0 });
  assert.deepEqual(parsePaging({ limit: "nope", offset: "12" }), { limit: 200, offset: 12 });
});
