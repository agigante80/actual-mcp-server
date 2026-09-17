// src/lib/oidc-error-cause.ts
//
// #463: the cause attached to a bearer-auth 401 must not carry the presented token's
// decoded claims.
//
// customJwtVerify wraps a failed jose verification as
// MCPAuthTokenVerificationError('invalid_token', cause). Outside NODE_ENV=production the
// server passes showErrorDetails=true and mcp-auth serialises that cause into the 401
// body with JSON.stringify, which emits every OWN ENUMERABLE property. jose's
// JWTClaimValidationFailed and JWTExpired both carry `payload`, the decoded token, as
// exactly such a property, so the body reflected `sub`, `email` and `aud` back to the
// caller. A Node system error from a failed JWKS fetch would reflect `address`, `port`
// and `syscall` the same way.
//
// This helper is STRUCTURAL rather than a list of jose classes: two classes carry the
// payload today, a third would be missed by any instanceof list, and plain objects keep
// it unit-testable without importing jose. It copies an allowlist (`code`, `claim`,
// `reason`, all strings) plus the message, and nothing else, so `Object.keys` of the
// serialised cause is always a subset of those three. The claim name stays because it
// is what an operator debugging an audience mismatch needs (#245); the payload goes.
//
// Pure: no imports, no logger, no config. Never log the original error whole either:
// `payload` is not a key the redaction format recognises.

const COPIED_KEYS = ['code', 'claim', 'reason'] as const;

/**
 * A fresh Error carrying only the message and the string-valued `code`, `claim` and
 * `reason` of the thrown value, or undefined when the thrown value is not an object.
 */
export function stripJoseCause(err: unknown): Error | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const source = err as Record<string, unknown>;
  const stripped = new Error(typeof source.message === 'string' ? source.message : undefined);
  for (const key of COPIED_KEYS) {
    const value = source[key];
    if (typeof value === 'string') (stripped as unknown as Record<string, unknown>)[key] = value;
  }
  return stripped;
}
