import { describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT_MAX, AuthRequestRateLimiter } from "./rate-limit";

describe("AuthRequestRateLimiter", () => {
  it("bounds repeated auth operations and exposes a bounded Retry-After", () => {
    const limiter = new AuthRequestRateLimiter();
    for (let index = 0; index < AUTH_RATE_LIMIT_MAX; index += 1) {
      expect(limiter.take("login:loopback", 1_000)).toEqual({ allowed: true });
    }
    expect(limiter.take("login:loopback", 1_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(limiter.take("login:loopback", 60_999).retryAfterSeconds).toBe(1);
    expect(limiter.take("login:loopback", 61_000)).toEqual({ allowed: true });
  });

  it("keeps operation scopes independent", () => {
    const limiter = new AuthRequestRateLimiter();
    for (let index = 0; index < AUTH_RATE_LIMIT_MAX; index += 1) limiter.take("login", 1_000);
    expect(limiter.take("register", 1_000)).toEqual({ allowed: true });
    limiter.reset();
    expect(limiter.take("login", 1_000)).toEqual({ allowed: true });
  });

  it("fails closed for invalid input and bounds a backwards-clock retry", () => {
    const limiter = new AuthRequestRateLimiter();
    expect(limiter.take("", 1_000)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.take("login", Number.NaN)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.take("x".repeat(513), 1_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    for (let index = 0; index < AUTH_RATE_LIMIT_MAX; index += 1) {
      expect(limiter.take("login", 60_000)).toEqual({ allowed: true });
    }
    expect(limiter.take("login", 1_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("caps unique scopes and recovers capacity after the window", () => {
    const limiter = new AuthRequestRateLimiter(2);
    expect(limiter.take("login:a", 1_000)).toEqual({ allowed: true });
    expect(limiter.take("login:b", 1_000)).toEqual({ allowed: true });
    expect(limiter.take("login:c", 1_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(limiter.take("login:c", 0)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(limiter.take("login:c", 61_000)).toEqual({ allowed: true });
  });

  it("rejects invalid capacity", () => {
    expect(() => new AuthRequestRateLimiter(0)).toThrow(RangeError);
    expect(() => new AuthRequestRateLimiter(1.5)).toThrow(RangeError);
  });
});
