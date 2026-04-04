// URL signing for EPUB downloads — uses Web Crypto API (no "use node" needed)

async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSignedToken(
  issueId: string,
  secret: string,
  expiryMs: number = 3600000
): Promise<string> {
  const expires = Date.now() + expiryMs;
  const message = `${issueId}:${expires}`;
  const sig = await hmacSign(secret, message);
  // token format: issueId.expires.signature
  return `${issueId}.${expires}.${sig}`;
}

export async function verifySignedToken(
  token: string,
  secret: string
): Promise<{ issueId: string; valid: boolean }> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { issueId: "", valid: false };
  }
  const [issueId, expiresStr, providedSig] = parts;
  const expires = parseInt(expiresStr, 10);

  if (isNaN(expires) || Date.now() > expires) {
    return { issueId, valid: false };
  }

  const message = `${issueId}:${expires}`;
  const expectedSig = await hmacSign(secret, message);

  if (expectedSig !== providedSig) {
    return { issueId, valid: false };
  }

  return { issueId, valid: true };
}
