import jwt from "jsonwebtoken";
import { getAppConfig } from "../utils/env.js";
import { isTokenRevoked } from "../utils/tokenRevocation.js";

const config = getAppConfig();

export function requireAdmin(req, res, next) {
  const authorization = req.get("authorization");
  const [scheme, token] = authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Bearer token required" });
  }

  try {
    const admin = jwt.verify(token, config.jwtSecret);

    if (admin.tokenType !== "admin") {
      return res.status(401).json({ error: "Invalid admin token" });
    }

    if (isTokenRevoked(admin.jti)) {
      return res.status(401).json({ error: "Token has been logged out" });
    }

    req.admin = admin;
    req.authToken = token;
  } catch (err) {
    return res.status(401).json({
      error: err.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
    });
  }

  next();
}

export function optionalAdmin(req, res, next) {
  if (!req.get("authorization")) {
    return next();
  }

  return requireAdmin(req, res, next);
}
