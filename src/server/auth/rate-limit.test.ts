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
});
