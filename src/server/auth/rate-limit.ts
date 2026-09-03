export const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
export const AUTH_RATE_LIMIT_MAX = 10;

type Counter = { startedAt: number; count: number };

export class AuthRequestRateLimiter {
  readonly #counters = new Map<string, Counter>();

  take(
    scope: string,
    now = Date.now(),
  ): Readonly<{ allowed: boolean; retryAfterSeconds?: number }> {
    const current = this.#counters.get(scope);
    if (!current || now - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.#counters.set(scope, { startedAt: now, count: 1 });
      return { allowed: true };
    }
    if (current.count >= AUTH_RATE_LIMIT_MAX) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.startedAt + AUTH_RATE_LIMIT_WINDOW_MS - now) / 1_000),
        ),
      };
    }
    current.count += 1;
    return { allowed: true };
  }

  reset(): void {
    this.#counters.clear();
  }
}

export const selfHostedAuthRateLimiter = new AuthRequestRateLimiter();
