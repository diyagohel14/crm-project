import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";
import { optionalAdmin, requireAdmin } from "../middleware/adminMiddleware.js";
import { getAppConfig } from "../utils/env.js";
import { revokeToken } from "../utils/tokenRevocation.js";

const { jwtSecret } = getAppConfig();

function responseMock() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function requestMock(token) {
  return {
    get(name) {
      return name === "authorization" ? (token ? `Bearer ${token}` : undefined) : undefined;
    },
    session: { existing: true },
  };
}

test("requireAuth rejects missing and invalid bearer tokens", () => {
  const missingResponse = responseMock();
  requireAuth(requestMock(), missingResponse, () => assert.fail("next should not run"));
  assert.equal(missingResponse.statusCode, 401);

  const invalidResponse = responseMock();
  requireAuth(requestMock("invalid"), invalidResponse, () => assert.fail("next should not run"));
  assert.deepEqual(invalidResponse.body, { error: "Invalid token" });
});

test("requireAuth attaches verified user and protects session user", () => {
  const token = jwt.sign({ userId: 7, companyId: 3, jti: `auth-${Date.now()}` }, jwtSecret);
  const req = requestMock(token);
  let called = false;
  requireAuth(req, responseMock(), () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.user.userId, 7);
  assert.equal(req.session.user.userId, 7);
});

test("requireAuth rejects revoked tokens", () => {
  const tokenId = `revoked-${Date.now()}`;
  const token = jwt.sign({ jti: tokenId }, jwtSecret);
  revokeToken(tokenId, Math.floor(Date.now() / 1000) + 60);
  const response = responseMock();
  requireAuth(requestMock(token), response, () => assert.fail("next should not run"));
  assert.deepEqual(response.body, { error: "Token has been logged out" });
});

test("requireAdmin accepts only admin tokens", () => {
  const companyToken = jwt.sign({ tokenType: "company" }, jwtSecret);
  const response = responseMock();
  requireAdmin(requestMock(companyToken), response, () => assert.fail("next should not run"));
  assert.deepEqual(response.body, { error: "Invalid admin token" });

  const adminToken = jwt.sign({ tokenType: "admin", adminId: 1 }, jwtSecret);
  const req = requestMock(adminToken);
  let called = false;
  requireAdmin(req, responseMock(), () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.admin.adminId, 1);
});

test("optionalAdmin permits bootstrap requests but validates supplied tokens", () => {
  let called = false;
  optionalAdmin(requestMock(), responseMock(), () => { called = true; });
  assert.equal(called, true);

  const invalidResponse = responseMock();
  optionalAdmin(requestMock("invalid"), invalidResponse, () => assert.fail("next should not run"));
  assert.deepEqual(invalidResponse.body, { error: "Invalid token" });

  const token = jwt.sign({ tokenType: "admin", adminId: 2 }, jwtSecret);
  const req = requestMock(token);
  optionalAdmin(req, responseMock(), () => { called = true; });
  assert.equal(req.admin.adminId, 2);
});

test("requireRole allows configured roles and rejects others", () => {
  let allowedCalled = false;
  const next = () => { allowedCalled = true; };
  const allowedRequest = { user: { roleId: 2 } };
  requireRole([2])(allowedRequest, responseMock(), next);
  assert.equal(allowedCalled, true);

  const response = responseMock();
  requireRole([1])(allowedRequest, response, next);
  assert.equal(response.statusCode, 403);
});
