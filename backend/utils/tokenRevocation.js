const revokedTokens = new Map();

function removeExpiredTokens(now = Date.now()) {
  for (const [tokenId, expiresAt] of revokedTokens) {
    if (expiresAt <= now) revokedTokens.delete(tokenId);
  }
}

export function revokeToken(tokenId, expiresAt) {
  if (!tokenId || !expiresAt) return;

  removeExpiredTokens();
  revokedTokens.set(tokenId, expiresAt * 1000);
}

export function isTokenRevoked(tokenId) {
  removeExpiredTokens();
  return Boolean(tokenId && revokedTokens.has(tokenId));
}
