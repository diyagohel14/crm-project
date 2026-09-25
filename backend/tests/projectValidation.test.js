import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateProjectPayload,
  validateProjectStatusTransition,
  validatePositiveId,
  validatePercentage,
} from '../controllers/projectController.js';

test('validateProjectPayload rejects incomplete project payloads', () => {
  assert.throws(() => validateProjectPayload({}), /project_name is required/i);
  assert.throws(() => validateProjectPayload({ project_name: 'Alpha' }), /party_id is required/i);
});

test('validateProjectPayload validates numeric and status fields', () => {
  const payload = {
    project_name: 'Alpha',
    party_id: 12,
    status: 'approved',
    contract_value: 1000,
    estimated_cost: 800,
    progress_percent: 42,
  };

  const normalized = validateProjectPayload(payload);
  assert.equal(normalized.project_name, 'Alpha');
  assert.equal(normalized.party_id, 12);
  assert.equal(normalized.status, 'approved');
  assert.equal(normalized.progress_percent, 42);
});

test('validateProjectStatusTransition allows only valid lifecycle moves', () => {
  assert.equal(validateProjectStatusTransition('planning', 'approved'), true);
  assert.equal(validateProjectStatusTransition('approved', 'in_progress'), true);
  assert.equal(validateProjectStatusTransition('planning', 'completed'), false);
});

test('validatePositiveId rejects non-positive values', () => {
  assert.equal(validatePositiveId('12'), 12);
  assert.throws(() => validatePositiveId('0'), /must be a positive integer/i);
  assert.throws(() => validatePositiveId('abc'), /must be a positive integer/i);
});

test('validatePercentage enforces 0 to 100 range', () => {
  assert.equal(validatePercentage(25), 25);
  assert.throws(() => validatePercentage(101), /between 0 and 100/i);
  assert.throws(() => validatePercentage(-1), /between 0 and 100/i);
});
