/**
 * HMAC-SHA256 helpers built on Web Crypto, so they run unchanged in Convex's
 * default runtime, in Node 20+ and in the edge-runtime used by the tests.
 *
 * Signature header format: `sha256=<lowercase hex>`.
 * Verification uses `crypto.subtle.verify`, which compares in constant time.
 */

const encoder = new TextEncoder();
const SIGNATURE_PREFIX = "sha256=";

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function importKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** Canonical string for requests that go n8n -> Convex (binds method + path). */
export function canonicalInbound(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

/** Canonical string for webhooks that go Convex -> n8n. */
export function canonicalOutbound(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

export async function sign(secret: string, message: string): Promise<string> {
  const key = await importKey(secret, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return SIGNATURE_PREFIX + toHex(new Uint8Array(sig));
}

export async function verify(secret: string, message: string, signatureHeader: string | null | undefined): Promise<boolean> {
  if (!secret || !signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;
  const bytes = fromHex(signatureHeader.slice(SIGNATURE_PREFIX.length));
  if (!bytes) return false;
  const key = await importKey(secret, "verify");
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(message));
}

/** Timestamps are unix seconds as a string. Rejects stale, future and malformed values. */
export function isTimestampFresh(timestamp: string | null | undefined, now: number = Date.now()): boolean {
  if (!timestamp || !/^\d{9,12}$/.test(timestamp)) return false;
  return Math.abs(now - Number(timestamp) * 1000) <= MAX_CLOCK_SKEW_MS;
}
