export function requireAdmin(req, res, next) {
  if (!req.session?.admin) {
    return res.status(401).json({ error: "Not Admin authenticated" });
  }
  next();
}
