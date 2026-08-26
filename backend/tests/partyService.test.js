import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePartySeriesDocumentType } from '../services/partyService.js';

test('maps customer party type to the customer document series', () => {
  assert.equal(resolvePartySeriesDocumentType('CUSTOMER'), 2);
});

test('maps vendor party type to the vendor document series', () => {
  assert.equal(resolvePartySeriesDocumentType('VENDOR'), 3);
});

test('rejects unsupported party types', () => {
  assert.throws(() => resolvePartySeriesDocumentType('OTHER'), /Unsupported party type/i);
});
