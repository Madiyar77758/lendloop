import { describe, expect, it } from "vitest";
import { canonicalInbound, canonicalOutbound, isTimestampFresh, sign, verify } from "../convex/lib/hmac";

describe("hmac", () => {
  it("matches the published HMAC-SHA256 test vector", async () => {
    const sig = await sign("key", "The quick brown fox jumps over the lazy dog");
    expect(sig).toBe("sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("verifies a good signature and rejects a tampered body", async () => {
    const message = canonicalOutbound("1700000000", '{"a":1}');
    const sig = await sign("s3cret", message);
    expect(await verify("s3cret", message, sig)).toBe(true);
    expect(await verify("s3cret", canonicalOutbound("1700000000", '{"a":2}'), sig)).toBe(false);
  });

  it("rejects a wrong secret, a missing header and malformed headers", async () => {
    const message = "hello";
    const sig = await sign("right", message);
    expect(await verify("wrong", message, sig)).toBe(false);
    expect(await verify("right", message, null)).toBe(false);
    expect(await verify("right", message, "")).toBe(false);
    expect(await verify("right", message, sig.replace("sha256=", ""))).toBe(false);
    expect(await verify("right", message, "sha256=zz")).toBe(false);
    expect(await verify("right", message, "sha256=abc")).toBe(false);
    expect(await verify("", message, sig)).toBe(false);
  });

  it("binds method and path for inbound requests", async () => {
    const sig = await sign("k", canonicalInbound("1700000000", "POST", "/automation/reminders", "{}"));
    expect(await verify("k", canonicalInbound("1700000000", "POST", "/automation/reminders", "{}"), sig)).toBe(true);
    expect(await verify("k", canonicalInbound("1700000000", "POST", "/automation/errors", "{}"), sig)).toBe(false);
    expect(await verify("k", canonicalInbound("1700000000", "GET", "/automation/reminders", "{}"), sig)).toBe(false);
  });

  it("accepts only fresh timestamps", () => {
    const now = 1_700_000_000_000;
    expect(isTimestampFresh("1700000000", now)).toBe(true);
    expect(isTimestampFresh(String(1_700_000_000 - 299), now)).toBe(true);
    expect(isTimestampFresh(String(1_700_000_000 - 301), now)).toBe(false); // too old
    expect(isTimestampFresh(String(1_700_000_000 + 301), now)).toBe(false); // from the future
    expect(isTimestampFresh("not-a-number", now)).toBe(false);
    expect(isTimestampFresh("", now)).toBe(false);
    expect(isTimestampFresh(null, now)).toBe(false);
  });
});
